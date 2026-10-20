import { canViewOrganizationDashboard, canViewTeamDashboard, ledTeams } from '../access/policy.js';
import { AppError, forbidden } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';

export interface Period {
  /** Datas AAAA-MM-DD, inclusivas; sem período, os últimos 30 dias. */
  from?: string;
  to?: string;
}

const minutes = (value: number | null) => (value === null ? null : Math.round(value));

/**
 * Painéis do plano de hierarquia. Acerto de primeira = concluída sem "refazer" e sem justificativa de exceção;
 * erro = teve "refazer" ou foi concluída com justificativa (D5). Tempos em minutos.
 */
export function createDashboardService({ pool, now = () => new Date() }: ServiceDeps) {
  function range(period: Period) {
    const to = period.to ?? now().toISOString().slice(0, 10);
    const from = period.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    if (from > to) throw new AppError(400, 'VALIDATION_FAILED', 'O início do período é depois do fim');
    return { from, to };
  }

  /** Painel do Diretor: a organização inteira, ou uma equipe com `teamId`. */
  async function organization(ctx: AuthenticatedContext, input: Period & { teamId?: string }) {
    if (!canViewOrganizationDashboard(ctx.actor)) throw forbidden();
    const { from, to } = range(input);
    const team = input.teamId ?? null;
    // $1 início, $2 fim, $3 equipe opcional.
    const base = `FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
                  WHERE ($3::uuid IS NULL OR b.team_id = $3)`;
    const approvedIn = `j.approved_at >= $1::date AND j.approved_at < $2::date + 1`;
    const params = [from, to, team];
    const [totals, pairs, types, teams, weeks, numbering] = await Promise.all([
      pool.query<{
        received: number;
        approved: number;
        in_progress: number;
        failed: number;
        first_time: number;
        redone: number;
        overridden: number;
        avg_minutes: number | null;
      }>(
        `SELECT count(*) FILTER (WHERE j.created_at >= $1::date AND j.created_at < $2::date + 1)::int AS received,
                count(*) FILTER (WHERE ${approvedIn})::int AS approved,
                count(*) FILTER (WHERE j.status IN ('queued', 'processing', 'in_review', 'awaiting_approval'))::int AS in_progress,
                count(*) FILTER (WHERE j.status = 'failed' AND j.updated_at >= $1::date AND j.updated_at < $2::date + 1)::int AS failed,
                count(*) FILTER (WHERE ${approvedIn} AND j.redo_count = 0 AND j.approval_override_reason IS NULL)::int AS first_time,
                count(*) FILTER (WHERE ${approvedIn} AND j.redo_count > 0)::int AS redone,
                count(*) FILTER (WHERE ${approvedIn} AND j.approval_override_reason IS NOT NULL)::int AS overridden,
                avg(extract(epoch FROM j.approved_at - j.created_at) / 60) FILTER (WHERE ${approvedIn}) AS avg_minutes
           ${base}`,
        params,
      ),
      pool.query<{ source: string; target: string; count: number }>(
        `SELECT j.source_language AS source, j.target_language AS target, count(*)::int AS count
           ${base} AND ${approvedIn} GROUP BY 1, 2 ORDER BY 3 DESC`,
        params,
      ),
      pool.query<{ type: string; total: number; first_time: number; redone: number; overridden: number }>(
        `SELECT coalesce(j.document_type, 'Sem tipo') AS type, count(*)::int AS total,
                count(*) FILTER (WHERE j.redo_count = 0 AND j.approval_override_reason IS NULL)::int AS first_time,
                count(*) FILTER (WHERE j.redo_count > 0)::int AS redone,
                count(*) FILTER (WHERE j.approval_override_reason IS NOT NULL)::int AS overridden
           ${base} AND ${approvedIn} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30`,
        params,
      ),
      pool.query<{ id: string | null; name: string | null; received: number; approved: number; in_progress: number }>(
        `SELECT b.team_id AS id, t.name::text AS name,
                count(*) FILTER (WHERE j.created_at >= $1::date AND j.created_at < $2::date + 1)::int AS received,
                count(*) FILTER (WHERE ${approvedIn})::int AS approved,
                count(*) FILTER (WHERE j.status IN ('queued', 'processing', 'in_review', 'awaiting_approval'))::int AS in_progress
           ${base.replace('JOIN batches b ON b.id = d.batch_id', 'JOIN batches b ON b.id = d.batch_id LEFT JOIN teams t ON t.id = b.team_id')}
          GROUP BY 1, 2 ORDER BY 4 DESC, 2`,
        params,
      ),
      pool.query<{ week: string; approved: number }>(
        `SELECT to_char(date_trunc('week', j.approved_at), 'YYYY-MM-DD') AS week, count(*)::int AS approved
           ${base} AND ${approvedIn} GROUP BY 1 ORDER BY 1`,
        params,
      ),
      pool.query<{ scope: string; team_id: string | null; name: string | null; quota: number | null; used: number }>(
        `SELECT 'organization' AS scope, NULL::uuid AS team_id, NULL AS name,
                (SELECT quota FROM numbering_quotas WHERE year = $1 AND scope = 'organization') AS quota,
                (SELECT count(*)::int FROM translation_jobs WHERE translation_year = $1 AND number_label IS NOT NULL) AS used
         UNION ALL
         SELECT 'team', t.id, t.name::text,
                (SELECT quota FROM numbering_quotas q WHERE q.year = $1 AND q.scope = 'team' AND q.team_id = t.id),
                (SELECT count(*)::int FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
                  WHERE j.translation_year = $1 AND j.number_label IS NOT NULL AND b.team_id = t.id)
           FROM teams t`,
        [Number(to.slice(0, 4))],
      ),
    ]);
    const total = totals.rows[0]!;
    return {
      period: { from, to },
      totals: {
        received: total.received,
        approved: total.approved,
        inProgress: total.in_progress,
        failed: total.failed,
        firstTime: total.first_time,
        redone: total.redone,
        overridden: total.overridden,
        avgMinutesToConclude: minutes(total.avg_minutes),
      },
      byPair: pairs.rows,
      byType: types.rows.map((row) => ({
        type: row.type,
        total: row.total,
        firstTime: row.first_time,
        redone: row.redone,
        overridden: row.overridden,
      })),
      byTeam: teams.rows.map((row) => ({
        team: row.id ? { id: row.id, name: row.name ?? '' } : null,
        received: row.received,
        approved: row.approved,
        inProgress: row.in_progress,
      })),
      byWeek: weeks.rows,
      numbering: {
        year: Number(to.slice(0, 4)),
        organization: numbering.rows.filter((row) => row.scope === 'organization').map(({ quota, used }) => ({ quota, used }))[0]!,
        teams: numbering.rows
          .filter((row) => row.scope === 'team')
          .map((row) => ({ team: { id: row.team_id!, name: row.name ?? '' }, quota: row.quota, used: row.used })),
      },
    };
  }

  /** Painel da equipe: Supervisor dela ou Diretor. Sem `teamId`, a primeira equipe que o Supervisor supervisiona. */
  async function team(ctx: AuthenticatedContext, input: Period & { teamId?: string }) {
    const teamId = input.teamId ?? ledTeams(ctx.actor)[0];
    if (!teamId) throw new AppError(400, 'VALIDATION_FAILED', 'Escolha a equipe');
    if (!canViewTeamDashboard(ctx.actor, teamId)) throw forbidden();
    const { from, to } = range(input);
    const year = Number(to.slice(0, 4));
    const params = [from, to, teamId];
    const approvedIn = `j.approved_at >= $1::date AND j.approved_at < $2::date + 1`;
    const [people, documents, totals] = await Promise.all([
      pool.query<{
        id: string;
        name: string;
        role: string | null;
        in_progress: number;
        delivered: number;
        redone: number;
        avg_review: number | null;
        avg_total: number | null;
        quota: number | null;
        used: number;
      }>(
        `WITH work AS (
           SELECT j.* FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
            WHERE b.team_id = $3
         ), people AS (
           SELECT user_id AS id FROM team_memberships WHERE team_id = $3
           UNION SELECT assignee_id FROM work WHERE assignee_id IS NOT NULL
         )
         SELECT u.id, u.display_name AS name, m.role,
                (SELECT count(*)::int FROM work j WHERE j.assignee_id = u.id
                   AND j.status IN ('queued', 'processing', 'in_review', 'awaiting_approval')) AS in_progress,
                (SELECT count(*)::int FROM work j WHERE j.assignee_id = u.id AND ${approvedIn}) AS delivered,
                (SELECT count(*)::int FROM work j WHERE j.assignee_id = u.id AND ${approvedIn} AND j.redo_count > 0) AS redone,
                (SELECT avg(extract(epoch FROM j.submitted_at - j.processed_at) / 60) FROM work j
                  WHERE j.assignee_id = u.id AND ${approvedIn} AND j.processed_at IS NOT NULL AND j.submitted_at >= j.processed_at) AS avg_review,
                (SELECT avg(extract(epoch FROM j.approved_at - j.created_at) / 60) FROM work j
                  WHERE j.assignee_id = u.id AND ${approvedIn}) AS avg_total,
                (SELECT quota FROM numbering_quotas q WHERE q.year = ${year} AND q.scope = 'user' AND q.user_id = u.id) AS quota,
                (SELECT count(*)::int FROM translation_jobs j WHERE j.assignee_id = u.id AND j.translation_year = ${year}
                   AND j.number_label IS NOT NULL) AS used
           FROM people p JOIN users u ON u.id = p.id
           LEFT JOIN team_memberships m ON m.user_id = u.id AND m.team_id = $3
          ORDER BY delivered DESC, u.display_name`,
        params,
      ),
      pool.query<{
        id: string;
        name: string;
        assignee: string | null;
        status: string;
        document_type: string | null;
        created_at: Date;
        approved_at: Date | null;
        processing: number | null;
        review: number | null;
        conclusion: number | null;
        total: number | null;
        redo_count: number;
        number: string | null;
      }>(
        `SELECT j.id, d.display_name AS name, u.display_name AS assignee, j.status, j.document_type, j.created_at, j.approved_at,
                extract(epoch FROM j.processed_at - j.created_at) / 60 AS processing,
                CASE WHEN j.submitted_at >= j.processed_at THEN extract(epoch FROM j.submitted_at - j.processed_at) / 60 END AS review,
                CASE WHEN j.approved_at >= j.submitted_at THEN extract(epoch FROM j.approved_at - j.submitted_at) / 60 END AS conclusion,
                extract(epoch FROM j.approved_at - j.created_at) / 60 AS total,
                j.redo_count,
                j.number_label AS number
           FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
           LEFT JOIN users u ON u.id = j.assignee_id
          WHERE b.team_id = $3 AND ((j.created_at >= $1::date AND j.created_at < $2::date + 1) OR ${approvedIn})
          ORDER BY j.created_at DESC LIMIT 300`,
        params,
      ),
      pool.query<{ name: string; delivered: number; in_progress: number; avg_total: number | null; first_time: number }>(
        `SELECT (SELECT name::text FROM teams WHERE id = $3) AS name,
                count(*) FILTER (WHERE ${approvedIn})::int AS delivered,
                count(*) FILTER (WHERE j.status IN ('queued', 'processing', 'in_review', 'awaiting_approval'))::int AS in_progress,
                avg(extract(epoch FROM j.approved_at - j.created_at) / 60) FILTER (WHERE ${approvedIn}) AS avg_total,
                count(*) FILTER (WHERE ${approvedIn} AND j.redo_count = 0 AND j.approval_override_reason IS NULL)::int AS first_time
           FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
          WHERE b.team_id = $3`,
        params,
      ),
    ]);
    const summary = totals.rows[0]!;
    return {
      period: { from, to },
      team: { id: teamId, name: summary.name },
      totals: {
        delivered: summary.delivered,
        inProgress: summary.in_progress,
        firstTime: summary.first_time,
        avgMinutesToConclude: minutes(summary.avg_total),
      },
      users: people.rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        inProgress: row.in_progress,
        delivered: row.delivered,
        redone: row.redone,
        avgReviewMinutes: minutes(row.avg_review),
        avgTotalMinutes: minutes(row.avg_total),
        quota: row.quota,
        used: row.used,
      })),
      documents: documents.rows.map((row) => ({
        id: row.id,
        name: row.name,
        assignee: row.assignee,
        status: row.status,
        documentType: row.document_type,
        createdAt: row.created_at.toISOString(),
        approvedAt: row.approved_at?.toISOString() ?? null,
        processingMinutes: minutes(row.processing),
        reviewMinutes: minutes(row.review),
        conclusionMinutes: minutes(row.conclusion),
        totalMinutes: minutes(row.total),
        redoCount: row.redo_count,
        number: row.number,
      })),
    };
  }

  return { organization, team };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
