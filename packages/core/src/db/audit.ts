import type { Queryable } from './pool.js';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  teamId?: string;
  correlationId?: string;
  /** Nunca incluir senha, token, conteúdo de documento ou outros dados sensíveis. */
  metadata?: Record<string, unknown>;
}

export async function recordAudit(db: Queryable, entry: AuditEntry) {
  await db.query(
    `INSERT INTO audit_events (actor_user_id, action, target_type, target_id, team_id, correlation_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.actorUserId,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.teamId ?? null,
      entry.correlationId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
