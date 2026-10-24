import { canReadTeamAudit, isDirector, ledTeams } from '../access/policy.js';
import { forbidden } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';

/** Operational thresholds are explicit and never presented as AI judgements. */
export const incidentCriteria = { stalledMinutes: 30, undownloadedHours: 24, consecutiveFailures: 3 };

export function createIncidentService({ pool, now = () => new Date() }: ServiceDeps) {
  async function list(ctx: AuthenticatedContext, query: { teamId?: string; limit?: number } = {}) {
    if (!canReadTeamAudit(ctx.actor)) throw forbidden();
    const teams = isDirector(ctx.actor) ? null : ledTeams(ctx.actor);
    const params = [teams, query.teamId ?? null, now(), Math.min(100, Math.max(1, query.limit ?? 30))];
    const cte = `WITH pending AS (
      SELECT j.id, j.document_id, d.display_name AS name, b.protocol, b.team_id, t.name::text AS team_name, j.status,
        CASE WHEN j.status NOT IN ('approved','cancelled') AND j.consecutive_rejections >= 3 THEN 'critical'
             WHEN j.status = 'failed' THEN 'error' ELSE 'warning' END AS severity,
        CASE WHEN j.status NOT IN ('approved','cancelled') AND j.consecutive_rejections >= 3 THEN 'CONSECUTIVE_FAILURES'
             WHEN j.status = 'failed' THEN coalesce(j.failure_code,'TRANSLATION_FAILED')
             WHEN j.status = 'approved' THEN 'READY_NOT_DOWNLOADED' ELSE 'PROCESSING_STALLED' END AS code,
        CASE WHEN j.status NOT IN ('approved','cancelled') AND j.consecutive_rejections >= 3 THEN 'Documento devolvido três vezes consecutivas neste formato; exige um novo modelo de formatação.'
             WHEN j.status = 'failed' THEN concat('Falha de tradução: ',j.failure_code)
             WHEN j.status = 'approved' THEN 'Documento concluído há pelo menos 24 horas sem nenhum download registrado.'
             ELSE 'Documento na fila ou processando há pelo menos 30 minutos sem atualização.' END AS cause,
        CASE WHEN j.status = 'approved' THEN j.approved_at ELSE j.updated_at END AS since
      FROM translation_jobs j JOIN documents d ON d.id=j.document_id JOIN batches b ON b.id=d.batch_id LEFT JOIN teams t ON t.id=b.team_id
      WHERE ($1::uuid[] IS NULL OR b.team_id=ANY($1::uuid[])) AND ($2::uuid IS NULL OR b.team_id=$2)
        AND ((j.status NOT IN ('approved','cancelled') AND j.consecutive_rejections>=3) OR j.status='failed'
          OR (j.status IN ('queued','processing') AND j.updated_at <= $3::timestamptz-interval '30 minutes' AND j.run_after <= $3::timestamptz)
          OR (j.status='approved' AND j.annulled_at IS NULL AND j.approved_at <= $3::timestamptz-interval '24 hours'
            AND j.first_downloaded_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.target_type='translation' AND a.target_id=j.id::text AND a.action='translation.downloaded' AND a.occurred_at>=j.approved_at)))
    )`;
    const [totals, result] = await Promise.all([
      pool.query<{ total: number; critical: number; errors: number; warnings: number }>(
        `${cte} SELECT count(*)::int AS total, count(*) FILTER(WHERE severity='critical')::int AS critical,
        count(*) FILTER(WHERE severity IN ('critical','error'))::int AS errors, count(*) FILTER(WHERE severity='warning')::int AS warnings FROM pending`,
        params.slice(0, 3),
      ),
      pool.query<{
        id: string;
        document_id: string;
        name: string;
        protocol: string | null;
        team_id: string | null;
        team_name: string | null;
        status: string;
        severity: 'critical' | 'error' | 'warning';
        code: string;
        cause: string;
        since: Date;
      }>(
        `${cte} SELECT * FROM pending ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'error' THEN 1 ELSE 2 END,since,id LIMIT $4`,
        params,
      ),
    ]);
    return {
      ...totals.rows[0]!,
      criteria: incidentCriteria,
      items: result.rows.map((row) => ({
        id: row.id,
        translationId: row.id,
        documentId: row.document_id,
        name: row.name,
        protocol: row.protocol,
        team: row.team_id ? { id: row.team_id, name: row.team_name ?? '' } : null,
        status: row.status,
        severity: row.severity,
        code: row.code,
        cause: row.cause,
        since: row.since.toISOString(),
        ageMinutes: Math.max(0, Math.floor((now().getTime() - row.since.getTime()) / 60_000)),
      })),
    };
  }
  return { list };
}
