import type { PoolClient } from 'pg';
import { recordAudit } from '../audit/audit.js';

export type ReleaseReason = 'member_removed' | 'batch_reassigned' | 'user_suspended' | 'role_changed';

/**
 * Solta o responsável das traduções em aberto que essa pessoa já não consegue abrir: saiu da equipe do lote, o lote foi
 * para outra equipe, a conta foi suspensa ou deixou de ser Diretor. Sem isso a tradução ficava presa a quem não a vê e
 * nunca aparecia em "Disponíveis para assumir". Roda na mesma transação da mudança que tirou o acesso.
 */
export async function releaseUnreachableAssignments(
  db: Pick<PoolClient, 'query'>,
  scope: { userId?: string; batchId?: string },
  by: { actorUserId: string; correlationId?: string; reason: ReleaseReason },
) {
  const released = await db.query<{ id: string; team_id: string | null; assignee_id: string }>(
    `UPDATE translation_jobs j SET assignee_id = NULL, updated_at = now()
       FROM documents d JOIN batches b ON b.id = d.batch_id, users u
      WHERE d.id = j.document_id AND u.id = j.assignee_id
        AND j.status NOT IN ('approved', 'cancelled', 'failed')
        AND ($1::uuid IS NULL OR j.assignee_id = $1)
        AND ($2::uuid IS NULL OR d.batch_id = $2)
        AND (u.status <> 'active' OR (u.org_role <> 'director' AND (b.team_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM team_memberships m WHERE m.user_id = u.id AND m.team_id = b.team_id))))
      RETURNING j.id, b.team_id, u.id AS assignee_id`,
    [scope.userId ?? null, scope.batchId ?? null],
  );
  for (const row of released.rows) {
    await recordAudit(db, {
      actorUserId: by.actorUserId,
      action: 'translation.released',
      targetType: 'translation',
      targetId: row.id,
      ...(row.team_id ? { teamId: row.team_id } : {}),
      ...(by.correlationId ? { correlationId: by.correlationId } : {}),
      metadata: { from: row.assignee_id, reason: by.reason },
    });
  }
  return released.rowCount ?? 0;
}
