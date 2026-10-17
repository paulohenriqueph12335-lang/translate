import { canReadAudit } from '../access/policy.js';
import { forbidden } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { decodeCursor, encodeCursor } from '../pagination.js';

interface AuditRow {
  id: string;
  occurred_at: Date;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  team_id: string | null;
  correlation_id: string | null;
  metadata: Record<string, unknown>;
}

export function createAuditService({ pool }: ServiceDeps) {
  async function list(ctx: AuthenticatedContext, query: { limit: number; cursor?: string; action?: string }) {
    if (!canReadAudit(ctx.actor)) throw forbidden();
    const before = decodeCursor(query.cursor, ([id]) => !!id && /^\d{1,18}$/.test(id));
    const result = await pool.query<AuditRow>(
      `SELECT a.id, a.occurred_at, a.actor_user_id, u.display_name AS actor_name, a.action, a.target_type, a.target_id,
              a.team_id, a.correlation_id, a.metadata
         FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ($1::text IS NULL OR a.action = $1)
          AND ($2::bigint IS NULL OR a.id < $2)
        ORDER BY a.id DESC
        LIMIT $3`,
      [query.action ?? null, before?.[0] ?? null, query.limit + 1],
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
        teamId: row.team_id,
        correlationId: row.correlation_id,
        metadata: row.metadata,
      })),
      nextCursor: result.rows.length > query.limit && last ? encodeCursor(String(last.id)) : null,
    };
  }

  return { list };
}

export type AuditService = ReturnType<typeof createAuditService>;
