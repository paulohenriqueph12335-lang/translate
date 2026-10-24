import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { AppError, forbidden } from '../../http/errors.js';

export interface PerformanceFilter {
  from?: string;
  to?: string;
  teamId?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  mode?: string;
}

/** Counts come from the full authorized scope; only the document drill-down is limited. */
export function createPerformanceDashboards({ pool, now = () => new Date() }: Pick<ServiceDeps, 'pool' | 'now'>) {
  async function load(ctx: AuthenticatedContext, input: PerformanceFilter, personal: boolean) {
    if (ctx.actor.status !== 'active' || (!personal && ctx.actor.orgRole !== 'director')) throw forbidden();
    const to = input.to ?? now().toISOString().slice(0, 10);
    const validDate = (value: string) => {
      if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const timestamp = Date.parse(`${value}T00:00:00Z`);
      return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
    };
    if (!validDate(to) || (input.from !== undefined && !validDate(input.from))) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Informe datas válidas para o início e o fim do período');
    }
    const from = input.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!Number.isFinite(days) || days < 0 || days > 730) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Escolha um período de até 731 dias, com início anterior ao fim');
    }
    const params = [
      from,
      to,
      personal ? ctx.actor.id : null,
      input.teamId ?? null,
      input.sourceLanguage ?? null,
      input.targetLanguage ?? null,
      input.mode ?? null,
    ];
    const scope = `WITH w AS (
      SELECT j.*,d.display_name AS name,b.protocol,b.team_id FROM translation_jobs j
      JOIN documents d ON d.id=j.document_id JOIN batches b ON b.id=d.batch_id
      WHERE ($3::uuid IS NULL OR j.assignee_id=$3)
        AND ($4::uuid IS NULL OR b.team_id=$4)
        AND ($5::text IS NULL OR j.source_language=$5)
        AND ($6::text IS NULL OR j.target_language=$6)
        AND ($7::text IS NULL OR j.translation_mode=$7)
    )`;
    const approved = `status='approved' AND approved_at >= $1::date AND approved_at < $2::date+1`;
    const received = `created_at >= $1::date AND created_at < $2::date+1`;
    const [totals, weekly, phases, causes, documents] = await Promise.all([
      pool.query<{
        received: number;
        approved: number;
        first_time: number;
        reworked: number;
        failed: number;
        in_progress: number;
        in_review: number;
        blocked: number;
        awaiting_download: number;
        avg_minutes: number | null;
        avg_download_minutes: number | null;
        rejected_inspections: number;
        approved_inspections: number;
      }>(
        `${scope} SELECT
        count(*) FILTER(WHERE ${received})::int AS received,
        count(*) FILTER(WHERE ${approved})::int AS approved,
        count(*) FILTER(WHERE ${approved} AND redo_count=0 AND approval_override_reason IS NULL)::int AS first_time,
        count(*) FILTER(WHERE ${approved} AND (redo_count>0 OR approval_override_reason IS NOT NULL))::int AS reworked,
        count(*) FILTER(WHERE status='failed' AND updated_at >= $1::date AND updated_at < $2::date+1)::int AS failed,
        count(*) FILTER(WHERE status IN ('queued','processing','in_review','awaiting_approval'))::int AS in_progress,
        count(*) FILTER(WHERE status='in_review')::int AS in_review,
        count(*) FILTER(WHERE consecutive_rejections>=3 AND status<>'approved')::int AS blocked,
        count(*) FILTER(WHERE ${approved} AND first_downloaded_at IS NULL)::int AS awaiting_download,
        avg(extract(epoch FROM approved_at-created_at)/60) FILTER(WHERE ${approved}) AS avg_minutes,
        avg(extract(epoch FROM first_downloaded_at-approved_at)/60) FILTER(WHERE ${approved} AND first_downloaded_at>=approved_at) AS avg_download_minutes,
        (SELECT count(*)::int FROM translation_inspections i JOIN w ON w.id=i.job_id WHERE i.decision='rejected' AND i.inspected_at >= $1::date AND i.inspected_at < $2::date+1) AS rejected_inspections,
        (SELECT count(*)::int FROM translation_inspections i JOIN w ON w.id=i.job_id WHERE i.decision='approved' AND i.inspected_at >= $1::date AND i.inspected_at < $2::date+1) AS approved_inspections
        FROM w`,
        params,
      ),
      pool.query<{ week: string; received: number; approved: number; reworked: number }>(
        `${scope}, weeks AS (
        SELECT generate_series(date_trunc('week',$1::date),date_trunc('week',$2::date),interval '1 week') AS week
      ) SELECT to_char(k.week,'YYYY-MM-DD') AS week,
        (SELECT count(*)::int FROM w WHERE ${received} AND date_trunc('week',created_at)=k.week) AS received,
        (SELECT count(*)::int FROM w WHERE ${approved} AND date_trunc('week',approved_at)=k.week) AS approved,
        (SELECT count(*)::int FROM w WHERE ${approved} AND (redo_count>0 OR approval_override_reason IS NOT NULL) AND date_trunc('week',approved_at)=k.week) AS reworked
        FROM weeks k ORDER BY k.week`,
        params,
      ),
      pool.query<{ stage: string; count: number }>(
        `${scope} SELECT stage,count(*)::int AS count
        FROM translation_inspections i JOIN w ON w.id=i.job_id CROSS JOIN LATERAL unnest(i.failed_stages) stage
        WHERE i.decision='rejected' AND i.inspected_at >= $1::date AND i.inspected_at < $2::date+1
        GROUP BY stage ORDER BY count DESC,stage`,
        params,
      ),
      pool.query<{ code: string; count: number }>(
        `${scope} SELECT failure_code AS code,count(*)::int AS count FROM w
        WHERE status='failed' AND updated_at >= $1::date AND updated_at < $2::date+1 GROUP BY failure_code ORDER BY count DESC,code`,
        params,
      ),
      pool.query<{
        id: string;
        name: string;
        protocol: string | null;
        status: string;
        source_language: string;
        target_language: string;
        redo_count: number;
        created_at: Date;
        approved_at: Date | null;
        failure_code: string | null;
      }>(
        `${scope}
        SELECT id,name,protocol,status,source_language,target_language,redo_count,created_at,approved_at,failure_code FROM w
        WHERE (${received}) OR (${approved}) ORDER BY created_at DESC,id DESC LIMIT 101`,
        params,
      ),
    ]);
    const t = totals.rows[0]!;
    const rounded = (n: number | null) => (n === null ? null : Math.max(0, Math.round(n)));
    return {
      period: { from, to },
      scope: personal ? 'individual' : 'organization',
      totals: {
        received: t.received,
        approved: t.approved,
        firstTime: t.first_time,
        reworked: t.reworked,
        failed: t.failed,
        inProgress: t.in_progress,
        inReview: t.in_review,
        blocked: t.blocked,
        awaitingDownload: t.awaiting_download,
        avgMinutes: rounded(t.avg_minutes),
        avgDownloadMinutes: rounded(t.avg_download_minutes),
        approvedInspections: t.approved_inspections,
        rejectedInspections: t.rejected_inspections,
        firstTimeRate: t.approved ? Math.round((t.first_time * 100) / t.approved) : null,
      },
      weeks: weekly.rows,
      failedStages: phases.rows,
      failureCauses: causes.rows,
      documents: documents.rows.slice(0, 100).map((d) => ({
        id: d.id,
        name: d.name,
        protocol: d.protocol,
        status: d.status,
        sourceLanguage: d.source_language,
        targetLanguage: d.target_language,
        redoCount: d.redo_count,
        createdAt: d.created_at.toISOString(),
        approvedAt: d.approved_at?.toISOString() ?? null,
        failureCode: d.failure_code,
      })),
      documentsTruncated: documents.rows.length > 100,
    };
  }
  return {
    individual: (ctx: AuthenticatedContext, input: PerformanceFilter) => load(ctx, input, true),
    quality: (ctx: AuthenticatedContext, input: PerformanceFilter) => load(ctx, input, false),
  };
}
