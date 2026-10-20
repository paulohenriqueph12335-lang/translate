import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { decodeCursor, encodeCursor } from '../pagination.js';

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

export interface NotificationQuery {
  unread?: boolean;
  kind?: string[];
  limit: number;
  cursor?: string;
}

/** Notificações da própria pessoa; ninguém lê nem marca as de outra. */
export function createNotificationService({ pool }: ServiceDeps) {
  async function list(ctx: AuthenticatedContext, query: NotificationQuery) {
    const before = decodeCursor(query.cursor, ([id]) => !!id && /^\d{1,18}$/.test(id));
    const result = await pool.query<NotificationRow>(
      `SELECT n.id, n.kind, n.title, n.body, n.team_id, t.name::text AS team_name, n.batch_id, n.document_id, n.translation_id,
              n.created_at, n.read_at
         FROM notifications n LEFT JOIN teams t ON t.id = n.team_id
        WHERE n.user_id = $1
          AND ($2::boolean IS NOT TRUE OR n.read_at IS NULL)
          AND ($3::text[] IS NULL OR n.kind = ANY($3::text[]))
          AND ($4::bigint IS NULL OR n.id < $4)
        ORDER BY n.id DESC
        LIMIT $5`,
      [ctx.actor.id, query.unread ?? false, query.kind?.length ? query.kind : null, before?.[0] ?? null, query.limit + 1],
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        kind: row.kind,
        title: row.title,
        body: row.body,
        team: row.team_id ? { id: row.team_id, name: row.team_name ?? '' } : null,
        batchId: row.batch_id,
        documentId: row.document_id,
        translationId: row.translation_id,
        createdAt: row.created_at.toISOString(),
        readAt: row.read_at?.toISOString() ?? null,
      })),
      nextCursor: result.rows.length > query.limit && last ? encodeCursor(String(last.id)) : null,
    };
  }

  async function unreadCount(ctx: AuthenticatedContext) {
    const result = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [ctx.actor.id],
    );
    return { unread: result.rows[0]!.count };
  }

  /** Marca como lidas as notificações informadas, ou todas quando `ids` não vem. */
  async function markRead(ctx: AuthenticatedContext, ids?: string[]) {
    const result = await pool.query(
      `UPDATE notifications SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))`,
      [ctx.actor.id, ids ?? null],
    );
    return { marked: result.rowCount ?? 0 };
  }

  return { list, unreadCount, markRead };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
