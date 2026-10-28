import { notify, recordAudit, withTransaction } from '@tradutor/core/db';
import type { ObjectStorage } from '@tradutor/core/storage';
import type { PoolClient } from 'pg';
import {
  canDecideNumberingRequest,
  canManageNumberingLimits,
  canSetUserQuota,
  canViewBatch,
  isDirector,
  ledTeams,
  type Actor,
  type TeamRole,
} from '../access/policy.js';
import { AppError, conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { reissueFinalDocx, type MaskSource } from '../translations/service.js';
import type { QuotaScope } from './quota.js';

type Db = Pick<PoolClient, 'query'>;

export interface NumberingRequestInput {
  kind: 'change' | 'annul';
  reason: string;
  /** Valores como o tradutor os usa (texto livre, ADR-012). */
  number?: string;
  book?: string;
  sheet?: string;
}

interface RequestRow {
  id: string;
  job_id: string;
  kind: 'change' | 'annul';
  reason: string;
  requested_number: string | null;
  requested_book: string | null;
  requested_sheet: string | null;
  previous_number: string | null;
  previous_book: string | null;
  previous_sheet: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'reverted';
  requested_by: string;
  requested_by_name: string;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  reverted_at: Date | null;
  created_at: Date;
  document_name: string;
  team_id: string | null;
  team_name: string | null;
  owner_id: string;
  batch_id: string;
  document_id: string;
  translator_id: string | null;
  translator_name: string | null;
  number_label: string;
  book_label: string | null;
  sheet_label: string | null;
  annulled_at: Date | null;
}

const REQUEST_SELECT = `
  SELECT nr.*, ru.display_name AS requested_by_name, du.display_name AS decided_by_name, d.display_name AS document_name,
         b.team_id, t.name::text AS team_name, b.owner_id, b.id AS batch_id, d.id AS document_id,
         j.translator_id, st.name AS translator_name, j.number_label, j.book_label, j.sheet_label, j.annulled_at
    FROM numbering_requests nr
    JOIN translation_jobs j ON j.id = nr.job_id
    LEFT JOIN sworn_translators st ON st.id = j.translator_id
    JOIN documents d ON d.id = j.document_id
    JOIN batches b ON b.id = d.batch_id
    LEFT JOIN teams t ON t.id = b.team_id
    JOIN users ru ON ru.id = nr.requested_by
    LEFT JOIN users du ON du.id = nr.decided_by`;

function toRequest(row: RequestRow, actor: Actor) {
  const batch = { teamId: row.team_id, ownerId: row.owner_id };
  return {
    id: row.id,
    translationId: row.job_id,
    document: { id: row.document_id, name: row.document_name },
    team: row.team_id ? { id: row.team_id, name: row.team_name ?? '' } : null,
    kind: row.kind,
    reason: row.reason,
    translator: row.translator_id ? { id: row.translator_id, name: row.translator_name ?? '' } : null,
    current: { number: row.number_label, book: row.book_label, sheet: row.sheet_label },
    requested: { number: row.requested_number, book: row.requested_book, sheet: row.requested_sheet },
    previous: row.previous_number !== null ? { number: row.previous_number, book: row.previous_book, sheet: row.previous_sheet } : null,
    status: row.status,
    requestedBy: row.requested_by_name,
    decidedBy: row.decided_by_name,
    decidedAt: row.decided_at?.toISOString() ?? null,
    decisionNote: row.decision_note,
    createdAt: row.created_at.toISOString(),
    permissions: {
      decide: row.status === 'pending' && canDecideNumberingRequest(actor, batch),
      // D3: o Supervisor autoriza; o Diretor é avisado e pode reverter.
      revert: row.status === 'approved' && isDirector(actor),
    },
  };
}

/** Numeração por hierarquia (plano de hierarquia): cotas anuais e pedidos de alteração/anulação de número. */
export function createNumberingService({
  pool,
  storage,
  masks,
  now = () => new Date(),
}: ServiceDeps & { storage: ObjectStorage; masks: MaskSource }) {
  const currentYear = () => now().getUTCFullYear();

  /**
   * Visão da numeração no ano: Diretor vê a organização, todas as equipes e todas as pessoas de equipe;
   * Supervisor vê as próprias equipes e as pessoas delas. Usuário vê só a própria cota.
   */
  async function overview(ctx: AuthenticatedContext, year = currentYear()) {
    const director = isDirector(ctx.actor);
    const teams = director ? null : ledTeams(ctx.actor);
    const used = await pool.query<{ team_id: string | null; assignee_id: string | null; used: number }>(
      `SELECT b.team_id, j.assignee_id, count(*)::int AS used
         FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
        WHERE j.translation_year = $1 AND j.number_label IS NOT NULL
        GROUP BY b.team_id, j.assignee_id`,
      [year],
    );
    const quotas = await pool.query<{ scope: QuotaScope; team_id: string | null; user_id: string | null; quota: number }>(
      'SELECT scope, team_id, user_id, quota FROM numbering_quotas WHERE year = $1',
      [year],
    );
    const quotaOf = (scope: QuotaScope, id: string | null) =>
      quotas.rows.find((q) => q.scope === scope && (scope === 'team' ? q.team_id === id : scope === 'user' ? q.user_id === id : true))
        ?.quota ?? null;
    const sum = (filter: (row: { team_id: string | null; assignee_id: string | null }) => boolean) =>
      used.rows.filter(filter).reduce((total, row) => total + row.used, 0);

    const teamRows = await pool.query<{ id: string; name: string }>(
      `SELECT id, name::text FROM teams ${teams ? 'WHERE id = ANY($1::uuid[])' : ''} ORDER BY name`,
      teams ? [teams] : [],
    );
    const people = await pool.query<{
      id: string;
      name: string;
      email: string;
      teams: Array<{ id: string; name: string; role: TeamRole }>;
    }>(
      `SELECT u.id, u.display_name AS name, u.email::text,
              jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', m.role) ORDER BY t.name) AS teams
         FROM users u JOIN team_memberships m ON m.user_id = u.id JOIN teams t ON t.id = m.team_id
        WHERE u.status = 'active' ${teams ? 'AND m.team_id = ANY($1::uuid[])' : ''}
        GROUP BY u.id ORDER BY u.display_name`,
      teams ? [teams] : [],
    );
    const mine = { quota: quotaOf('user', ctx.actor.id), used: sum((row) => row.assignee_id === ctx.actor.id) };
    if (!director && !teams?.length) return { year, mine, organization: null, teams: [], users: [] };
    return {
      year,
      mine,
      organization: director ? { quota: quotaOf('organization', null), used: sum(() => true) } : null,
      teams: teamRows.rows.map((team) => ({
        id: team.id,
        name: team.name,
        quota: quotaOf('team', team.id),
        used: sum((row) => row.team_id === team.id),
        canEdit: canManageNumberingLimits(ctx.actor),
      })),
      users: people.rows.map((person) => ({
        id: person.id,
        name: person.name,
        email: person.email,
        teams: person.teams,
        quota: quotaOf('user', person.id),
        used: sum((row) => row.assignee_id === person.id),
        canEdit:
          person.id !== ctx.actor.id &&
          canSetUserQuota(ctx.actor, new Map(person.teams.map((team) => [team.id, team.role] as [string, TeamRole]))),
      })),
    };
  }

  /** Define (ou remove, com `quota: null`) a cota de um nível no ano. */
  async function setQuota(
    ctx: AuthenticatedContext,
    input: { year: number; scope: QuotaScope; teamId?: string; userId?: string; quota: number | null },
  ) {
    if (input.scope === 'user') {
      if (!input.userId) throw new AppError(400, 'VALIDATION_FAILED', 'Informe a pessoa');
      if (input.quota !== null && (input.quota < 1 || input.quota > 1000)) {
        throw new AppError(400, 'VALIDATION_FAILED', 'A cota de um usuário vai de 1 a 1000 números por ano');
      }
      const memberships = await pool.query<{ team_id: string; role: TeamRole }>(
        'SELECT team_id, role FROM team_memberships WHERE user_id = $1',
        [input.userId],
      );
      const map = new Map(memberships.rows.map((row) => [row.team_id, row.role] as [string, TeamRole]));
      if (input.userId === ctx.actor.id || !canSetUserQuota(ctx.actor, map)) {
        throw forbidden('Somente o Supervisor da equipe da pessoa ou o Diretor define a cota dela');
      }
    } else {
      if (!canManageNumberingLimits(ctx.actor)) throw forbidden('Somente o Diretor define os limites da organização e das equipes');
      if (input.scope === 'team' && !input.teamId) throw new AppError(400, 'VALIDATION_FAILED', 'Informe a equipe');
    }
    const teamId = input.scope === 'team' ? input.teamId! : null;
    const userId = input.scope === 'user' ? input.userId! : null;
    await withTransaction(pool, async (db) => {
      const match = `year = $1 AND scope = $2 AND team_id IS NOT DISTINCT FROM $3 AND user_id IS NOT DISTINCT FROM $4`;
      if (input.quota === null) {
        await db.query(`DELETE FROM numbering_quotas WHERE ${match}`, [input.year, input.scope, teamId, userId]);
      } else {
        const updated = await db.query(`UPDATE numbering_quotas SET quota = $5, updated_by = $6, updated_at = now() WHERE ${match}`, [
          input.year,
          input.scope,
          teamId,
          userId,
          input.quota,
          ctx.actor.id,
        ]);
        if (!updated.rowCount) {
          await db.query(
            'INSERT INTO numbering_quotas (year, scope, team_id, user_id, quota, updated_by) VALUES ($1, $2, $3, $4, $5, $6)',
            [input.year, input.scope, teamId, userId, input.quota, ctx.actor.id],
          );
        }
      }
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'numbering.quota_set',
        targetType: input.scope === 'user' ? 'user' : input.scope === 'team' ? 'team' : 'settings',
        ...(userId ? { targetId: userId } : teamId ? { targetId: teamId } : {}),
        ...(teamId ? { teamId } : {}),
        correlationId: ctx.correlationId,
        metadata: { year: input.year, scope: input.scope, quota: input.quota },
      });
      if (userId) {
        await notify(
          db,
          { teamId: null, users: [userId], exclude: ctx.actor.id },
          {
            kind: 'quota_changed',
            title:
              input.quota === null
                ? `Sua cota de numeração de ${input.year} ficou sem limite`
                : `Sua cota de numeração de ${input.year} agora é ${input.quota}`,
          },
        );
      }
    });
    return overview(ctx, input.year);
  }

  async function loadRequest(db: Db, ctx: AuthenticatedContext, id: string, lock = false) {
    const result = await db.query<RequestRow>(`${REQUEST_SELECT} WHERE nr.id = $1 ${lock ? 'FOR UPDATE OF nr' : ''}`, [id]);
    const row = result.rows[0];
    if (!row || !canViewBatch(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) throw notFound('Pedido não encontrado');
    return row;
  }

  /** Pedido de alteração ou anulação: o responsável pela tradução ou quem decide; um pedido em aberto por vez. */
  async function createRequest(ctx: AuthenticatedContext, jobId: string, input: NumberingRequestInput) {
    const id = await withTransaction(pool, async (db) => {
      const found = await db.query<{
        status: string;
        number_label: string | null;
        annulled_at: Date | null;
        assignee_id: string | null;
        team_id: string | null;
        owner_id: string;
        name: string;
        batch_id: string;
        document_id: string;
      }>(
        `SELECT j.status, j.number_label, j.annulled_at, j.assignee_id, b.team_id, b.owner_id,
                d.display_name AS name, b.id AS batch_id, d.id AS document_id
           FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
          WHERE j.id = $1 FOR UPDATE OF j`,
        [jobId],
      );
      const job = found.rows[0];
      const batch = job ? { teamId: job.team_id, ownerId: job.owner_id } : null;
      if (!job || !batch || !canViewBatch(ctx.actor, batch)) throw notFound('Tradução não encontrada');
      if (job.assignee_id !== ctx.actor.id && !canDecideNumberingRequest(ctx.actor, batch)) {
        throw forbidden('Somente o responsável pela tradução pede alteração do número');
      }
      if (job.status !== 'approved' || !job.number_label) throw conflict('A tradução ainda não tem número');
      if (job.annulled_at) throw conflict('Este número já foi anulado');
      try {
        const created = await db.query<{ id: string }>(
          `INSERT INTO numbering_requests (job_id, kind, reason, requested_number, requested_book, requested_sheet, requested_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            jobId,
            input.kind,
            input.reason,
            input.kind === 'change' ? (input.number ?? null) : null,
            input.kind === 'change' ? (input.book ?? null) : null,
            input.kind === 'change' ? (input.sheet ?? null) : null,
            ctx.actor.id,
          ],
        );
        const requestId = created.rows[0]!.id;
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'numbering.requested',
          targetType: 'translation',
          targetId: jobId,
          ...(job.team_id ? { teamId: job.team_id } : {}),
          correlationId: ctx.correlationId,
          metadata: { request: requestId, kind: input.kind, number: job.number_label },
        });
        await notify(
          db,
          { teamId: job.team_id, leaders: true, directors: true, exclude: ctx.actor.id },
          {
            kind: 'numbering_request',
            title: `${input.kind === 'annul' ? 'Anular' : 'Alterar'} o nº ${job.number_label}: ${job.name}`,
            body: input.reason,
            batchId: job.batch_id,
            documentId: job.document_id,
            translationId: jobId,
          },
        );
        return requestId;
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw conflict('Já existe um pedido em aberto para este número');
        throw error;
      }
    });
    return { request: toRequest(await loadRequest(pool, ctx, id), ctx.actor) };
  }

  async function listRequests(ctx: AuthenticatedContext, query: { status?: RequestRow['status'] }) {
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions: string[] = [];
    if (!isDirector(ctx.actor)) {
      // Supervisor: pedidos das equipes que supervisiona; demais: os próprios.
      conditions.push(`(b.team_id = ANY(${param(ledTeams(ctx.actor))}::uuid[]) OR nr.requested_by = ${param(ctx.actor.id)})`);
    }
    if (query.status) conditions.push(`nr.status = ${param(query.status)}`);
    const result = await pool.query<RequestRow>(
      `${REQUEST_SELECT} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY nr.created_at DESC LIMIT 200`,
      params,
    );
    return { items: result.rows.map((row) => toRequest(row, ctx.actor)) };
  }

  /** O mesmo número não se repete no livro do mesmo tradutor (ADR-012). */
  async function requireFreeNumber(db: Db, row: RequestRow, number: string) {
    if (number === row.number_label) return;
    const taken = await db.query('SELECT 1 FROM translation_jobs WHERE translator_id = $1 AND number_label = $2 AND id <> $3', [
      row.translator_id,
      number,
      row.job_id,
    ]);
    if (taken.rowCount) throw conflict(`O nº ${number} já foi usado por ${row.translator_name ?? 'este tradutor'}`);
  }

  /** Aplica a alteração (número, livro ou folha, nova versão do DOCX) ou a anulação. */
  async function apply(db: Db, row: RequestRow) {
    if (row.kind === 'annul') {
      await db.query('UPDATE translation_jobs SET annulled_at = now(), annulled_reason = $2, updated_at = now() WHERE id = $1', [
        row.job_id,
        row.reason,
      ]);
      return;
    }
    const number = row.requested_number ?? row.number_label;
    await requireFreeNumber(db, row, number);
    await reissueFinalDocx(db, storage, masks, row.job_id, {
      number,
      book: row.requested_book ?? row.book_label,
      sheet: row.requested_sheet ?? row.sheet_label,
    });
  }

  async function decide(ctx: AuthenticatedContext, id: string, input: { approve: boolean; note?: string }) {
    await withTransaction(pool, async (db) => {
      const row = await loadRequest(db, ctx, id, true);
      if (!canDecideNumberingRequest(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) {
        throw forbidden('Somente o Supervisor da equipe ou o Diretor decide pedidos de numeração');
      }
      if (row.status !== 'pending') throw conflict('Este pedido já foi decidido');
      if (input.approve) await apply(db, row);
      await db.query(
        `UPDATE numbering_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4,
                previous_number = $5, previous_book = $6, previous_sheet = $7
          WHERE id = $1`,
        [id, input.approve ? 'approved' : 'rejected', ctx.actor.id, input.note ?? null, row.number_label, row.book_label, row.sheet_label],
      );
      const number = row.number_label;
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: input.approve ? 'numbering.approved' : 'numbering.rejected',
        targetType: 'translation',
        targetId: row.job_id,
        ...(row.team_id ? { teamId: row.team_id } : {}),
        correlationId: ctx.correlationId,
        metadata: { request: id, kind: row.kind, number, note: input.note ?? null },
      });
      const links = { batchId: row.batch_id, documentId: row.document_id, translationId: row.job_id };
      await notify(
        db,
        { teamId: row.team_id, users: [row.requested_by], exclude: ctx.actor.id },
        {
          ...links,
          kind: 'numbering_decided',
          title: `Pedido ${input.approve ? 'autorizado' : 'recusado'}: ${row.kind === 'annul' ? 'anular' : 'alterar'} o nº ${number}`,
          body: input.note ?? null,
        },
      );
      // D3: decisão do Supervisor deixa o Diretor ciente, com a opção de reverter.
      if (input.approve && !isDirector(ctx.actor)) {
        await notify(
          db,
          { teamId: null, directors: true },
          {
            ...links,
            kind: 'numbering_decided',
            title: `Supervisor autorizou ${row.kind === 'annul' ? 'anular' : 'alterar'} o nº ${number}`,
            body: `${row.document_name}: ${row.reason}`,
          },
        );
      }
    });
    return { request: toRequest(await loadRequest(pool, ctx, id), ctx.actor) };
  }

  /** Diretor desfaz uma alteração/anulação autorizada: volta a numeração anterior (D3). */
  async function revert(ctx: AuthenticatedContext, id: string) {
    if (!isDirector(ctx.actor)) throw forbidden('Somente o Diretor reverte decisões de numeração');
    await withTransaction(pool, async (db) => {
      const row = await loadRequest(db, ctx, id, true);
      if (row.status !== 'approved') throw conflict('Só um pedido autorizado pode ser revertido');
      // Reabertura ou pedido mais novo mudaram o documento depois: reverter geraria o Word final com o rascunho em
      // revisão ou devolveria um número antigo por cima do atual.
      const job = await db.query<{ status: string }>('SELECT status FROM translation_jobs WHERE id = $1 FOR UPDATE', [row.job_id]);
      if (job.rows[0]?.status !== 'approved')
        throw conflict('A tradução foi reaberta depois deste pedido; a numeração não pode ser revertida');
      const later = await db.query(
        `SELECT 1 FROM numbering_requests WHERE job_id = $1 AND id <> $2 AND status IN ('pending', 'approved') AND created_at > $3 LIMIT 1`,
        [row.job_id, id, row.created_at],
      );
      if (later.rowCount) throw conflict('Há um pedido mais recente para este número; decida ou reverta o mais recente primeiro');
      if (row.kind === 'annul') {
        await db.query('UPDATE translation_jobs SET annulled_at = NULL, annulled_reason = NULL, updated_at = now() WHERE id = $1', [
          row.job_id,
        ]);
      } else {
        const previous = row.previous_number ?? row.number_label;
        await requireFreeNumber(db, row, previous);
        await reissueFinalDocx(db, storage, masks, row.job_id, {
          number: previous,
          book: row.previous_book,
          sheet: row.previous_sheet,
        });
      }
      await db.query(`UPDATE numbering_requests SET status = 'reverted', reverted_by = $2, reverted_at = now() WHERE id = $1`, [
        id,
        ctx.actor.id,
      ]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'numbering.reverted',
        targetType: 'translation',
        targetId: row.job_id,
        ...(row.team_id ? { teamId: row.team_id } : {}),
        correlationId: ctx.correlationId,
        metadata: { request: id, kind: row.kind },
      });
      await notify(
        db,
        { teamId: row.team_id, leaders: true, users: [row.requested_by], exclude: ctx.actor.id },
        {
          batchId: row.batch_id,
          documentId: row.document_id,
          translationId: row.job_id,
          kind: 'numbering_decided',
          title: `Diretor reverteu o pedido de ${row.kind === 'annul' ? 'anulação' : 'alteração'}: ${row.document_name}`,
        },
      );
    });
    return { request: toRequest(await loadRequest(pool, ctx, id), ctx.actor) };
  }

  return { overview, setQuota, createRequest, listRequests, decide, revert };
}

export type NumberingService = ReturnType<typeof createNumberingService>;
