import { notify, recordAudit, withTransaction, type Queryable } from '@tradutor/core/db';
import { AppError } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import {
  classifyNotification,
  deliveryIntervalMs,
  notificationCatalog,
  recommendedCategories,
  NOTIFICATION_CATEGORIES,
  type DeliveryMode,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationFrequency,
  type NotificationPreferencesPatch,
  type NotificationProfile,
} from './policy.js';

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  team_id: string | null;
  team_name: string | null;
  batch_id: string | null;
  document_id: string | null;
  translation_id: string | null;
  created_at: Date;
  read_at: Date | null;
}

interface PreferenceRow {
  notifications_enabled: boolean;
  notification_frequency: NotificationFrequency;
  profile: NotificationProfile;
  delivery_mode: DeliveryMode | null;
  category_channels: Partial<Record<NotificationCategory, Partial<{ inApp: boolean; browser: boolean }>>> | null;
  last_operational_scan_at: Date | null;
}

export interface NotificationQuery {
  unread?: boolean;
  kind?: string[];
  category?: NotificationCategory;
  limit: number;
  cursor?: string;
}

// Reavalia papel/equipes atuais, inclusive após redirecionar a remessa; não basta ter recebido o evento no passado.
const accessSql = `EXISTS (
  SELECT 1 FROM users current_account WHERE current_account.id=$1 AND current_account.status='active' AND (
    current_account.org_role='director'
    OR (n.team_id IS NULL AND n.batch_id IS NULL AND n.document_id IS NULL AND n.translation_id IS NULL)
    OR EXISTS (
      SELECT 1 FROM team_memberships membership WHERE membership.user_id=$1
      AND membership.team_id = CASE
        WHEN n.batch_id IS NOT NULL OR n.document_id IS NOT NULL OR n.translation_id IS NOT NULL THEN (
          SELECT batch.team_id FROM batches batch WHERE batch.id=coalesce(n.batch_id,
            (SELECT document.batch_id FROM documents document WHERE document.id=coalesce(n.document_id,
              (SELECT job.document_id FROM translation_jobs job WHERE job.id=n.translation_id))))
        ) ELSE n.team_id END
    )
  )
)`;
const categorySql = `CASE
 WHEN n.kind IN ('translation_ready','translation_approved') THEN 'workflow'
 WHEN n.kind IN ('translation_submitted','translation_returned','pattern_unknown','approval_waiting') THEN 'review'
 WHEN n.kind IN ('translation_failed','review_blocked','processing_stalled','download_waiting') THEN 'failures'
 WHEN n.kind IN ('batch_assigned','translation_assigned','unassigned_work') THEN 'assignments'
 WHEN n.kind ~ '^(numbering_|quota_)' THEN 'numbering'
 ELSE 'administration' END`;
const selectNotification = `SELECT n.*,t.name::text AS team_name FROM notifications n LEFT JOIN teams t ON t.id=n.team_id`;
const relevantReminderSql = `(n.dedupe_key IS NULL OR EXISTS (
  SELECT 1 FROM translation_jobs reminder_job WHERE reminder_job.id=n.translation_id AND reminder_job.annulled_at IS NULL AND (
    (n.kind='review_blocked' AND reminder_job.consecutive_rejections>=3 AND reminder_job.status IN ('in_review','awaiting_approval'))
    OR (n.kind='translation_failed' AND reminder_job.status='failed')
    OR (n.kind='processing_stalled' AND reminder_job.status IN ('queued','processing')
        AND reminder_job.updated_at<=$4::timestamptz-interval '30 minutes'
        AND (reminder_job.status='processing' OR reminder_job.run_after<=$4::timestamptz))
    OR (n.kind='approval_waiting' AND reminder_job.status='awaiting_approval')
    OR (n.kind='download_waiting' AND reminder_job.status='approved' AND reminder_job.first_downloaded_at IS NULL)
    OR (n.kind='unassigned_work' AND reminder_job.status='in_review' AND reminder_job.assignee_id IS NULL)
  )
))`;
const toItem = (row: NotificationRow) => ({
  id: String(row.id),
  kind: row.kind,
  title: row.title,
  body: row.body,
  ...classifyNotification(row.kind),
  team: row.team_id ? { id: row.team_id, name: row.team_name ?? '' } : null,
  batchId: row.batch_id,
  documentId: row.document_id,
  translationId: row.translation_id,
  createdAt: row.created_at.toISOString(),
  readAt: row.read_at?.toISOString() ?? null,
});

/** Histórico individual e avisos com preferências, agrupamento e cursores compartilhados por canal. */
export function createNotificationService({ pool, now = () => new Date() }: ServiceDeps) {
  async function loadPreferences(db: Queryable, userId: string, lock = false) {
    const result = await db.query<PreferenceRow>(
      `SELECT u.notifications_enabled,u.notification_frequency,p.delivery_mode,p.category_channels,p.last_operational_scan_at,
         CASE WHEN u.org_role='director' THEN 'director'
              WHEN EXISTS(SELECT 1 FROM team_memberships m WHERE m.user_id=u.id AND m.role='leader') THEN 'leader'
              ELSE 'operator' END AS profile
       FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id
       WHERE u.id=$1 AND u.status='active' ${lock ? 'FOR UPDATE OF u' : ''}`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(401, 'UNAUTHENTICATED', 'Sessão ausente ou expirada');
    const categories = recommendedCategories(row.profile);
    for (const category of NOTIFICATION_CATEGORIES) Object.assign(categories[category], row.category_channels?.[category]);
    const mode = row.delivery_mode ?? 'digest';
    return {
      row,
      value: {
        notificationsEnabled: row.notifications_enabled,
        notificationFrequency: row.notification_frequency,
        deliveryMode: mode,
        profile: row.profile,
        categories,
        catalog: notificationCatalog(row.profile),
        delivery: {
          minimumIntervalSeconds: deliveryIntervalMs(row.notification_frequency, mode) / 1000,
          maxIndividualItems: 10,
          onlineOnly: true,
          browserRequiresPermission: true,
          windowsManagedByBrowser: true,
        },
      },
    };
  }

  async function getPreferences(ctx: AuthenticatedContext) {
    return (await loadPreferences(pool, ctx.actor.id)).value;
  }

  async function updatePreferences(ctx: AuthenticatedContext, input: NotificationPreferencesPatch) {
    return withTransaction(pool, async (db) => {
      const current = await loadPreferences(db, ctx.actor.id, true);
      const overrides = input.resetToRecommended ? {} : structuredClone(current.row.category_channels ?? {});
      for (const category of NOTIFICATION_CATEGORIES) {
        const patch = input.categories?.[category];
        if (!patch) continue;
        const next = { ...overrides[category] };
        if (patch.inApp !== undefined) next.inApp = patch.inApp;
        if (patch.browser !== undefined) next.browser = patch.browser;
        overrides[category] = next;
      }
      await db.query(
        `UPDATE users SET notifications_enabled=coalesce($2,notifications_enabled),
          notification_frequency=coalesce($3,notification_frequency),updated_at=$4 WHERE id=$1`,
        [ctx.actor.id, input.notificationsEnabled ?? null, input.notificationFrequency ?? null, now()],
      );
      await db.query(
        `INSERT INTO notification_preferences(user_id,delivery_mode,category_channels,updated_at) VALUES($1,$2,$3,$4)
         ON CONFLICT(user_id) DO UPDATE SET delivery_mode=excluded.delivery_mode,category_channels=excluded.category_channels,updated_at=excluded.updated_at`,
        [ctx.actor.id, input.deliveryMode ?? current.value.deliveryMode, JSON.stringify(overrides), now()],
      );
      // Uma escolha nova não reproduz o acervo antigo como uma enxurrada de avisos.
      await db.query(
        `UPDATE notification_delivery_state SET cursor_id=coalesce((SELECT max(id) FROM notifications WHERE user_id=$1),0),
           initialized_at=$2,last_delivered_at=NULL WHERE user_id=$1`,
        [ctx.actor.id, now()],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'notifications.preferences_updated',
        targetType: 'user',
        targetId: ctx.actor.id,
        correlationId: ctx.correlationId,
        metadata: input,
      });
      return (await loadPreferences(db, ctx.actor.id)).value;
    });
  }

  async function list(ctx: AuthenticatedContext, query: NotificationQuery) {
    const before = decodeCursor(query.cursor, ([id]) => !!id && /^\d{1,18}$/.test(id));
    const result = await pool.query<NotificationRow>(
      `${selectNotification} WHERE n.user_id=$1 AND ${accessSql}
        AND ($2::boolean IS NOT TRUE OR n.read_at IS NULL)
        AND ($3::text[] IS NULL OR n.kind=ANY($3::text[])) AND ($4::bigint IS NULL OR n.id<$4)
        AND ($6::text IS NULL OR (${categorySql})=$6) ORDER BY n.id DESC LIMIT $5`,
      [
        ctx.actor.id,
        query.unread ?? false,
        query.kind?.length ? query.kind : null,
        before?.[0] ?? null,
        query.limit + 1,
        query.category ?? null,
      ],
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return { items: rows.map(toItem), nextCursor: result.rows.length > query.limit && last ? encodeCursor(String(last.id)) : null };
  }

  async function unreadCount(ctx: AuthenticatedContext) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM notifications n WHERE n.user_id=$1 AND n.read_at IS NULL AND ${accessSql}`,
      [ctx.actor.id],
    );
    return { unread: result.rows[0]!.count };
  }

  /** Ler no centro remove também o evento dos avisos pendentes. */
  async function markRead(ctx: AuthenticatedContext, ids?: string[]) {
    const result = await pool.query(
      `UPDATE notifications n SET read_at=$3 WHERE n.user_id=$1 AND n.read_at IS NULL
        AND ($2::bigint[] IS NULL OR n.id=ANY($2::bigint[])) AND ${accessSql}`,
      [ctx.actor.id, ids ?? null, now()],
    );
    return { marked: result.rowCount ?? 0 };
  }

  async function refreshOperational(db: Queryable, userId: string, preferences: Awaited<ReturnType<typeof loadPreferences>>) {
    const at = now();
    if (preferences.value.profile === 'operator') return;
    const last = preferences.row.last_operational_scan_at;
    if (last && at.getTime() - last.getTime() < 15 * 60_000) return;
    await db.query(
      `INSERT INTO notification_preferences(user_id,last_operational_scan_at) VALUES($1,$2)
       ON CONFLICT(user_id) DO UPDATE SET last_operational_scan_at=excluded.last_operational_scan_at`,
      [userId, at],
    );
    const result = await db.query<{
      id: string;
      current_revision: number | null;
      name: string;
      batch_id: string;
      document_id: string;
      team_id: string | null;
      kind: string;
      generation: string;
    }>(
      `WITH candidates AS (SELECT j.id,j.current_revision,j.created_at,d.display_name AS name,b.id AS batch_id,d.id AS document_id,b.team_id,
        CASE WHEN j.consecutive_rejections>=3 THEN 'review_blocked'
             WHEN j.status='failed' THEN 'translation_failed' WHEN j.status IN ('queued','processing') THEN 'processing_stalled'
             WHEN j.status='awaiting_approval' THEN 'approval_waiting' WHEN j.status='approved' THEN 'download_waiting'
             ELSE 'unassigned_work' END AS kind,
        coalesce(j.approved_at,j.submitted_at,j.processed_at,j.created_at)::text AS generation
       FROM translation_jobs j JOIN documents d ON d.id=j.document_id JOIN batches b ON b.id=d.batch_id
       WHERE (EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.org_role='director')
          OR EXISTS(SELECT 1 FROM team_memberships m WHERE m.user_id=$1 AND m.team_id=b.team_id AND m.role='leader'))
         AND j.annulled_at IS NULL AND (
          (j.consecutive_rejections>=3 AND j.status IN ('in_review','awaiting_approval')) OR j.status='failed'
          OR (j.status IN ('queued','processing') AND j.updated_at<=$2::timestamptz-interval '30 minutes'
              AND (j.status='processing' OR j.run_after<=$2::timestamptz))
          OR (j.status='awaiting_approval' AND coalesce(j.submitted_at,j.updated_at)<=$2::timestamptz-interval '24 hours')
          OR (j.status='approved' AND j.first_downloaded_at IS NULL AND j.approved_at<=$2::timestamptz-interval '24 hours')
          OR (j.status='in_review' AND j.assignee_id IS NULL AND j.updated_at<=$2::timestamptz-interval '1 hour')
         )) SELECT * FROM candidates candidate WHERE NOT EXISTS (
           SELECT 1 FROM notifications n WHERE n.user_id=$1 AND (
             n.dedupe_key=candidate.kind||':'||candidate.id::text||':'||coalesce(candidate.current_revision,0)::text||':'||candidate.generation
             OR (candidate.kind='translation_failed' AND n.kind='translation_failed' AND n.translation_id=candidate.id)
           )
         ) ORDER BY CASE WHEN candidate.kind='review_blocked' THEN 0 WHEN candidate.kind='translation_failed' THEN 1 ELSE 2 END,candidate.created_at LIMIT 200`,
      [userId, at],
    );
    const labels: Record<string, string> = {
      review_blocked: 'Revisão bloqueada',
      translation_failed: 'Falha que precisa de acompanhamento',
      processing_stalled: 'Processamento parado',
      approval_waiting: 'Conclusão pendente há 24 horas',
      download_waiting: 'Documento há 24 horas sem download',
      unassigned_work: 'Trabalho sem responsável',
    };
    for (const row of result.rows) {
      // Uma falha já comunicada pelo worker não repete o lembrete da mesma pessoa.
      if (
        row.kind === 'translation_failed' &&
        (
          await db.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND translation_id=$2 AND kind='translation_failed' LIMIT 1`, [
            userId,
            row.id,
          ])
        ).rowCount
      )
        continue;
      await notify(
        db,
        { teamId: row.team_id, users: [userId] },
        {
          kind: row.kind,
          title: `${labels[row.kind]}: ${row.name}`.slice(0, 200),
          body: classifyNotification(row.kind).reason,
          batchId: row.batch_id,
          documentId: row.document_id,
          translationId: row.id,
          dedupeKey: `${row.kind}:${row.id}:${row.current_revision ?? 0}:${row.generation}`,
        },
      );
    }
  }

  async function claimDelivery(ctx: AuthenticatedContext, input: { channel: NotificationChannel; initialize?: boolean }) {
    return withTransaction(pool, async (db) => {
      // Serializa sessões/canais e mudanças simultâneas de preferências, usando a conta ativa do banco.
      const preferences = await loadPreferences(db, ctx.actor.id, true);
      await refreshOperational(db, ctx.actor.id, preferences);
      const settings = preferences.value;
      const at = now();
      const highWater = (
        await db.query<{ id: string }>('SELECT coalesce(max(id),0)::text AS id FROM notifications WHERE user_id=$1', [ctx.actor.id])
      ).rows[0]!.id;
      const states = await db.query<{ cursor_id: string; initialized_at: Date; last_delivered_at: Date | null }>(
        'SELECT cursor_id,initialized_at,last_delivered_at FROM notification_delivery_state WHERE user_id=$1 AND channel=$2',
        [ctx.actor.id, input.channel],
      );
      const state = states.rows[0];
      const empty = {
        initialized: true,
        items: [] as ReturnType<typeof toItem>[],
        summary: null,
        nextDeliveryAt: null as string | null,
        deliveryMode: settings.deliveryMode,
      };
      if (!state || input.initialize) {
        await db.query(
          `INSERT INTO notification_delivery_state(user_id,channel,cursor_id,initialized_at,last_delivered_at) VALUES($1,$2,$3,$4,NULL)
           ON CONFLICT(user_id,channel) DO UPDATE SET cursor_id=excluded.cursor_id,initialized_at=excluded.initialized_at,last_delivered_at=NULL`,
          [ctx.actor.id, input.channel, highWater, at],
        );
        return empty;
      }
      if (!settings.notificationsEnabled || !NOTIFICATION_CATEGORIES.some((category) => settings.categories[category][input.channel])) {
        await db.query('UPDATE notification_delivery_state SET cursor_id=$3 WHERE user_id=$1 AND channel=$2', [
          ctx.actor.id,
          input.channel,
          highWater,
        ]);
        return empty;
      }
      const interval = deliveryIntervalMs(settings.notificationFrequency, settings.deliveryMode);
      const dueAt = new Date((state.last_delivered_at ?? state.initialized_at).getTime() + interval);
      if (at < dueAt) return { ...empty, nextDeliveryAt: dueAt.toISOString() };
      const result = await db.query<NotificationRow>(
        `${selectNotification} WHERE n.user_id=$1 AND n.id>$2 AND n.id<=$3 AND n.read_at IS NULL AND ${accessSql}
         AND n.${input.channel === 'inApp' ? 'in_app_claimed_at' : 'browser_claimed_at'} IS NULL AND ${relevantReminderSql}
         ORDER BY n.id LIMIT 1001`,
        [ctx.actor.id, state.cursor_id, highWater, at],
      );
      const scanned = result.rows.slice(0, 1000);
      const items: ReturnType<typeof toItem>[] = [];
      const consumed: string[] = [];
      for (const row of scanned) {
        consumed.push(row.id);
        const item = toItem(row);
        if (!settings.categories[item.category][input.channel]) continue;
        items.push(item);
        if (settings.deliveryMode === 'individual' && items.length === 10) {
          break;
        }
      }
      await db.query(
        `UPDATE notification_delivery_state SET last_delivered_at=CASE WHEN $3::boolean THEN $4 ELSE last_delivered_at END
         WHERE user_id=$1 AND channel=$2`,
        [ctx.actor.id, input.channel, items.length > 0, at],
      );
      // Consumo por evento, sem depender da ordem de commit de IDs reservados por transações concorrentes.
      if (consumed.length)
        await db.query(
          `UPDATE notifications SET ${input.channel === 'inApp' ? 'in_app_claimed_at' : 'browser_claimed_at'}=$3
           WHERE user_id=$1 AND id=ANY($2::bigint[])`,
          [ctx.actor.id, consumed, at],
        );
      if (!items.length) return empty;
      const byCategory = NOTIFICATION_CATEGORIES.map((category) => ({
        category,
        label: settings.catalog.find((item) => item.id === category)!.label,
        count: items.filter((item) => item.category === category).length,
      })).filter((category) => category.count > 0);
      const severity = ['critical', 'error', 'warning', 'info'].find((level) => items.some((item) => item.severity === level))!;
      return {
        initialized: true,
        items,
        summary: {
          title: items.length === 1 ? items[0]!.title : `${items.length} atualizações para você`,
          body: byCategory.map((category) => `${category.label}: ${category.count}`).join(' · '),
          count: items.length,
          byCategory,
          severity,
        },
        nextDeliveryAt: new Date(at.getTime() + interval).toISOString(),
        deliveryMode: settings.deliveryMode,
      };
    });
  }

  return { list, unreadCount, markRead, getPreferences, updatePreferences, claimDelivery };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
