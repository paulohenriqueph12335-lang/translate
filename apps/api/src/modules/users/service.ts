import type { PoolClient } from 'pg';
import {
  canAdministerUsers,
  canChangeOrgRole,
  canChangeUserStatus,
  statusTransition,
  type OrgRole,
  type StatusAction,
  type UserStatus,
} from '../access/policy.js';
import { recordAudit } from '../audit/audit.js';
import { withTransaction } from '@tradutor/core/db';
import { conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { USER_COLUMNS, toPublicUser, type UserRow } from '../identity/service.js';
import { decodeCursor, encodeCursor } from '../pagination.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createUserAdminService({ pool }: ServiceDeps) {
  async function list(ctx: AuthenticatedContext, query: { status?: UserStatus; limit: number; cursor?: string }) {
    if (!canAdministerUsers(ctx.actor)) throw forbidden();
    const after = decodeCursor(query.cursor, ([at, id]) => !!at && !Number.isNaN(Date.parse(at)) && !!id && UUID.test(id));
    const result = await pool.query<UserRow & { cursor_at: string }>(
      `SELECT ${USER_COLUMNS}, to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM users u
        WHERE ($1::text IS NULL OR u.status = $1)
          AND ($2::timestamptz IS NULL OR (u.created_at, u.id) > ($2, $3::uuid))
        ORDER BY u.created_at, u.id
        LIMIT $4`,
      [query.status ?? null, after?.[0] ?? null, after?.[1] ?? null, query.limit + 1],
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(toPublicUser),
      nextCursor: result.rows.length > query.limit && last ? encodeCursor(last.cursor_at, last.id) : null,
    };
  }

  async function lockTarget(db: PoolClient, userId: string) {
    const found = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1 FOR UPDATE`, [userId]);
    const target = found.rows[0];
    if (!target) throw notFound('Usuário não encontrado');
    return target;
  }

  async function changeStatus(ctx: AuthenticatedContext, userId: string, action: StatusAction) {
    if (!canAdministerUsers(ctx.actor)) throw forbidden();
    return withTransaction(pool, async (db) => {
      const target = await lockTarget(db, userId);
      if (!canChangeUserStatus(ctx.actor, { id: target.id, status: target.status, orgRole: target.org_role })) {
        throw forbidden('Não é possível alterar o próprio status');
      }
      const { from, to } = statusTransition(action);
      if (target.status !== from) throw conflict(`Transição inválida a partir de "${target.status}"`);

      const reviewed = action === 'approve' || action === 'reject';
      const updated = await db.query<UserRow>(
        `UPDATE users u SET status = $2, updated_at = now(),
                reviewed_at = CASE WHEN $3 THEN now() ELSE reviewed_at END,
                reviewed_by = CASE WHEN $3 THEN $4::uuid ELSE reviewed_by END
          WHERE u.id = $1 RETURNING ${USER_COLUMNS}`,
        [userId, to, reviewed, ctx.actor.id],
      );
      if (action === 'suspend') {
        await db.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'suspended' WHERE user_id = $1 AND revoked_at IS NULL`, [
          userId,
        ]);
      }
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: `user.${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'suspend' ? 'suspended' : 'reactivated'}`,
        targetType: 'user',
        targetId: userId,
        correlationId: ctx.correlationId,
        metadata: { from, to },
      });
      return toPublicUser(updated.rows[0]!);
    });
  }

  async function setOrgRole(ctx: AuthenticatedContext, userId: string, orgRole: OrgRole) {
    if (!canAdministerUsers(ctx.actor)) throw forbidden();
    return withTransaction(pool, async (db) => {
      const target = await lockTarget(db, userId);
      if (!canChangeOrgRole(ctx.actor, { id: target.id, status: target.status, orgRole: target.org_role })) {
        throw forbidden('Somente outra conta ativa pode ter o papel alterado');
      }
      if (target.org_role === orgRole) return toPublicUser(target);
      if (orgRole === 'director') {
        // Diretor não ocupa cargo de equipe (ADR-005): as associações saem junto com a promoção.
        const removed = await db.query<{ team_id: string; role: string }>(
          'DELETE FROM team_memberships WHERE user_id = $1 RETURNING team_id, role',
          [userId],
        );
        for (const membership of removed.rows) {
          await recordAudit(db, {
            actorUserId: ctx.actor.id,
            action: 'team.member_removed',
            targetType: 'user',
            targetId: userId,
            teamId: membership.team_id,
            correlationId: ctx.correlationId,
            metadata: { role: membership.role, reason: 'promoted_to_director' },
          });
        }
      }
      const updated = await db.query<UserRow>(
        `UPDATE users u SET org_role = $2, updated_at = now() WHERE u.id = $1 RETURNING ${USER_COLUMNS}`,
        [userId, orgRole],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: orgRole === 'director' ? 'user.director_granted' : 'user.director_revoked',
        targetType: 'user',
        targetId: userId,
        correlationId: ctx.correlationId,
      });
      return toPublicUser(updated.rows[0]!);
    });
  }

  return { list, changeStatus, setOrgRole };
}

export type UserAdminService = ReturnType<typeof createUserAdminService>;
