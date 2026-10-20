import { canReadTeamAudit, isDirector, ledTeams } from '../access/policy.js';
import { forbidden } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { decodeCursor, encodeCursor, likePattern } from '../pagination.js';

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
}

export interface AuditQuery {
  limit: number;
  cursor?: string;
  /** Ação exata, ex.: `translation.approved`. */
  action?: string;
  /** Grupo de ações pelo prefixo, ex.: `translation` para `translation.*`. */
  category?: string;
  actorId?: string;
  /** Só eventos do sistema (worker), sem pessoa. */
  system?: boolean;
  teamId?: string;
  targetType?: string;
  targetId?: string;
  /** Datas AAAA-MM-DD, inclusivas. */
  from?: string;
  to?: string;
  /** Busca no nome de quem agiu e na ação. */
  q?: string;
}

export function createAuditService({ pool }: ServiceDeps) {
  async function list(ctx: AuthenticatedContext, query: AuditQuery) {
    if (!canReadTeamAudit(ctx.actor)) throw forbidden();
    const before = decodeCursor(query.cursor, ([id]) => !!id && /^\d{1,18}$/.test(id));
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    // Supervisor (plano de hierarquia): só eventos das equipes que supervisiona.
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
    if (query.q) {
      const pattern = param(likePattern(query.q));
      conditions.push(`(unaccent(coalesce(u.display_name, '')) ILIKE unaccent(${pattern}) OR a.action ILIKE ${pattern})`);
    }
    if (before) conditions.push(`a.id < ${param(before[0])}::bigint`);
    const limit = param(query.limit + 1);
    const result = await pool.query<AuditRow>(
      `SELECT a.id, a.occurred_at, a.actor_user_id, u.display_name AS actor_name, a.action, a.target_type, a.target_id,
              a.team_id, t.name::text AS team_name, a.correlation_id, a.metadata
         FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN teams t ON t.id = a.team_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY a.id DESC
        LIMIT ${limit}`,
      params,
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
      })),
      nextCursor: result.rows.length > query.limit && last ? encodeCursor(String(last.id)) : null,
    };
  }

  /** Ações e tipos de alvo já registrados (no escopo de quem consulta), para montar os filtros. */
  async function facets(ctx: AuthenticatedContext) {
    if (!canReadTeamAudit(ctx.actor)) throw forbidden();
    const scope = isDirector(ctx.actor) ? '' : 'AND team_id = ANY($1::uuid[])';
    const params = isDirector(ctx.actor) ? [] : [ledTeams(ctx.actor)];
    const [actions, targets] = await Promise.all([
      pool.query<{ value: string }>(`SELECT DISTINCT action AS value FROM audit_events WHERE true ${scope} ORDER BY 1`, params),
      pool.query<{ value: string }>(
        `SELECT DISTINCT target_type AS value FROM audit_events WHERE target_type IS NOT NULL ${scope} ORDER BY 1`,
        params,
      ),
    ]);
    return { actions: actions.rows.map((row) => row.value), targetTypes: targets.rows.map((row) => row.value) };
  }

  return { list, facets };
}

export type AuditService = ReturnType<typeof createAuditService>;
