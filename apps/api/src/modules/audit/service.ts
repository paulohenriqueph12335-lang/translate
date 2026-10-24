import { canReadTeamAudit, isDirector, ledTeams } from '../access/policy.js';
import { forbidden } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { decodeCursor, encodeCursor, likePattern } from '../pagination.js';
import { createIncidentService } from './incidents.js';

export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

/** Shared classification: summaries, facets and pages always use the same rules. */
export const failureCodeSql = `nullif(coalesce(a.metadata->>'failureCode', a.metadata->>'failure_code', a.metadata->>'errorCode', a.metadata->>'error_code', a.metadata->>'code',
  CASE WHEN a.action ~ '(failed|failure|error|consecutive_failures|review_locked|review_blocked|retry_limit|emergency)' OR a.action='document.rejected' OR a.metadata->>'blocked'='true' THEN a.metadata->>'reason' END,
  CASE WHEN a.action ~ '(consecutive_failures|review_locked|review_blocked|retry_limit)' OR a.metadata->>'consecutiveRejections'='3' THEN 'consecutive_review_errors' END), '')`;
export const severitySql = `CASE
  WHEN a.metadata->>'severity' IN ('info', 'warning', 'error', 'critical') THEN a.metadata->>'severity'
  WHEN a.action ~ '(consecutive_failures|review_locked|review_blocked|retry_limit|emergency)' OR a.metadata->>'blocked' = 'true' OR a.metadata->>'consecutiveRejections' = '3' THEN 'critical'
  WHEN a.action ~ '(failed|failure|error)' OR a.action='document.rejected' OR ${failureCodeSql} IS NOT NULL OR a.metadata->>'hasError' = 'true' THEN 'error'
  WHEN a.action ~ '(redo|returned|rejected|blocked|cancelled|denied|override)' THEN 'warning'
  ELSE 'info' END`;

interface AuditRow {
  id: string;
  occurred_at: Date;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  team_id: string | null;
  team_name: string | null;
  correlation_id: string | null;
  metadata: Record<string, unknown>;
  severity: AuditSeverity;
  failure_code: string | null;
}

export interface AuditQuery {
  limit: number;
  cursor?: string;
  action?: string;
  category?: string;
  actorId?: string;
  system?: boolean;
  teamId?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  q?: string;
  severity?: AuditSeverity;
  errorsOnly?: boolean;
  failureCode?: string;
}

const joins = `FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN teams t ON t.id = a.team_id`;

/** Every token must match; accents, capitalization and punctuation do not affect a search. */
export function searchTokens(value: string) {
  return [
    ...new Set(
      value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ].slice(0, 20);
}

function filters(ctx: AuthenticatedContext, query: Omit<AuditQuery, 'limit' | 'cursor'>) {
  if (!canReadTeamAudit(ctx.actor)) throw forbidden();
  const params: unknown[] = [];
  const param = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const conditions: string[] = isDirector(ctx.actor) ? [] : [`a.team_id = ANY(${param(ledTeams(ctx.actor))}::uuid[])`];
  if (query.action) conditions.push(`a.action = ${param(query.action)}`);
  if (query.category) conditions.push(`a.action LIKE ${param(`${likePattern(query.category).slice(1, -1)}.%`)}`);
  if (query.actorId) conditions.push(`a.actor_user_id = ${param(query.actorId)}`);
  if (query.system) conditions.push('a.actor_user_id IS NULL');
  if (query.teamId) conditions.push(`a.team_id = ${param(query.teamId)}`);
  if (query.targetType) conditions.push(`a.target_type = ${param(query.targetType)}`);
  if (query.targetId) conditions.push(`a.target_id = ${param(query.targetId)}`);
  if (query.from) conditions.push(`a.occurred_at >= ${param(query.from)}::date`);
  if (query.to) conditions.push(`a.occurred_at < ${param(query.to)}::date + 1`);
  if (query.severity) conditions.push(`(${severitySql}) = ${param(query.severity)}`);
  if (query.errorsOnly) conditions.push(`(${severitySql}) IN ('error', 'critical')`);
  if (query.failureCode) conditions.push(`(${failureCodeSql}) = ${param(query.failureCode)}`);
  const text = `concat_ws(' ', a.id, u.display_name, a.action, t.name, a.target_type, a.target_id, a.correlation_id, a.metadata::text,
    (SELECT concat_ws(' ', d.display_name, b.protocol) FROM translation_jobs j JOIN documents d ON d.id=j.document_id JOIN batches b ON b.id=d.batch_id WHERE a.target_type='translation' AND j.id::text=a.target_id AND b.team_id IS NOT DISTINCT FROM a.team_id),
    (SELECT concat_ws(' ', d.display_name, b.protocol) FROM documents d JOIN batches b ON b.id=d.batch_id WHERE a.target_type='document' AND d.id::text=a.target_id AND b.team_id IS NOT DISTINCT FROM a.team_id),
    (SELECT concat_ws(' ', b.name, b.protocol) FROM batches b WHERE a.target_type='batch' AND b.id::text=a.target_id AND b.team_id IS NOT DISTINCT FROM a.team_id))`;
  for (const token of searchTokens(query.q ?? '')) conditions.push(`unaccent(${text}) ILIKE unaccent(${param(likePattern(token))})`);
  return { params, param, conditions, where: () => (conditions.length ? `WHERE ${conditions.join(' AND ')}` : '') };
}

export function createAuditService(deps: ServiceDeps) {
  const { pool } = deps;
  async function list(ctx: AuthenticatedContext, query: AuditQuery) {
    const f = filters(ctx, query);
    const before = decodeCursor(query.cursor, ([id]) => !!id && /^\d{1,18}$/.test(id));
    if (before) f.conditions.push(`a.id < ${f.param(before[0])}::bigint`);
    const result = await pool.query<AuditRow>(
      `SELECT a.id, a.occurred_at, a.actor_user_id, u.display_name AS actor_name, a.action, a.target_type, a.target_id,
              a.team_id, t.name::text AS team_name, a.correlation_id, a.metadata, (${severitySql}) AS severity, (${failureCodeSql}) AS failure_code
         ${joins} ${f.where()} ORDER BY a.id DESC LIMIT ${f.param(query.limit + 1)}`,
      f.params,
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        occurredAt: row.occurred_at.toISOString(),
        actor: row.actor_user_id ? { id: row.actor_user_id, displayName: row.actor_name } : null,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        team: row.team_id ? { id: row.team_id, name: row.team_name ?? '' } : null,
        correlationId: row.correlation_id,
        metadata: row.metadata,
        severity: row.severity,
        failureCode: row.failure_code,
      })),
      nextCursor: result.rows.length > query.limit && last ? encodeCursor(String(last.id)) : null,
    };
  }

  /** Aggregation excludes the pagination cursor: totals describe the entire filtered result. */
  async function summary(ctx: AuthenticatedContext, query: Omit<AuditQuery, 'limit' | 'cursor'>) {
    const f = filters(ctx, query);
    const result = await pool.query<{ severity: AuditSeverity; code: string | null; action: string; count: number }>(
      `SELECT (${severitySql}) AS severity, (${failureCodeSql}) AS code, a.action, count(*)::int AS count
       ${joins} ${f.where()} GROUP BY 1,2,3`,
      f.params,
    );
    const bySeverity = { info: 0, warning: 0, error: 0, critical: 0 };
    const codes = new Map<string, number>();
    const actions = new Map<string, number>();
    for (const row of result.rows) {
      bySeverity[row.severity] += row.count;
      if (row.code) codes.set(row.code, (codes.get(row.code) ?? 0) + row.count);
      actions.set(row.action, (actions.get(row.action) ?? 0) + row.count);
    }
    return {
      total: Object.values(bySeverity).reduce((a, b) => a + b, 0),
      errors: bySeverity.error + bySeverity.critical,
      warnings: bySeverity.warning,
      critical: bySeverity.critical,
      bySeverity,
      byFailureCode: [...codes].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
      byAction: [...actions]
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action)),
    };
  }

  async function facets(ctx: AuthenticatedContext) {
    const f = filters(ctx, {});
    const result = await pool.query<{ action: string; target_type: string | null; code: string | null }>(
      `SELECT DISTINCT a.action, a.target_type, (${failureCodeSql}) AS code ${joins} ${f.where()}`,
      f.params,
    );
    const unique = (values: Array<string | null>) => [...new Set(values.filter((v): v is string => !!v))].sort();
    return {
      actions: unique(result.rows.map((r) => r.action)),
      targetTypes: unique(result.rows.map((r) => r.target_type)),
      failureCodes: unique(result.rows.map((r) => r.code)),
    };
  }
  return { list, summary, facets, incidents: createIncidentService(deps).list };
}

export type AuditService = ReturnType<typeof createAuditService>;
