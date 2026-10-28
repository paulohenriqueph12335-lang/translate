import { notify, withTransaction } from '@tradutor/core/db';
import type { PoolClient } from 'pg';
import { canAuthorizePasswordReset, isDirector, type TeamRole, type UserStatus } from '../access/policy.js';
import { recordAudit } from '../audit/audit.js';
import { AppError, conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, RequestContext, ServiceDeps } from '../context.js';
import type { MasterTokenCheck } from './master-tokens.js';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from './passwords.js';

/** Cada liberação do Líder vale 24 horas; depois de 3 seguidas, só o Diretor troca a senha. */
export const LEADER_UNLOCK_HOURS = 24;
export const LEADER_UNLOCK_LIMIT = 3;

type Db = Pick<PoolClient, 'query'>;

const membershipsOf = async (db: Db, userId: string) =>
  new Map(
    (
      await db.query<{ team_id: string; role: TeamRole }>('SELECT team_id, role FROM team_memberships WHERE user_id = $1', [userId])
    ).rows.map((row) => [row.team_id, row.role] as const),
  );

/** Troca a senha e derruba as sessões; `accessUntil` nulo tira o limite de acesso e zera as liberações do Líder. */
async function applyPassword(db: Db, userId: string, passwordHash: string, accessUntil: Date | null) {
  await db.query(
    `UPDATE users SET password_hash = $2, access_expires_at = $3,
            leader_unlocks = CASE WHEN $3::timestamptz IS NULL THEN 0 ELSE leader_unlocks + 1 END, updated_at = now()
      WHERE id = $1`,
    [userId, passwordHash, accessUntil],
  );
  const revoked = await db.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_changed' WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return revoked.rowCount ?? 0;
}

/**
 * Recuperação de senha (pedido do produto, 2026-10-28). Quem esqueceu pede uma senha nova em "Esqueci a senha".
 * O Diretor autoriza com o Token do Diretor e a senha vale de vez. O Líder, com o Token do Líder, libera o Usuário da
 * equipe dele por 24 horas, até 3 vezes seguidas; depois, o acesso para e só o Diretor troca a senha.
 * Com o Token do Diretor, a própria tela de "Esqueci a senha" troca a senha na hora (inclusive do Diretor que esqueceu).
 */
export function createRecoveryService({ pool, now = () => new Date(), checkToken }: ServiceDeps & { checkToken: MasterTokenCheck }) {
  function requirePassword(password: string) {
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)
      throw new AppError(400, 'VALIDATION_FAILED', `Use entre ${PASSWORD_MIN} e ${PASSWORD_MAX} caracteres`);
  }

  async function request(input: { email: string; newPassword: string; directorToken?: string }, ctx: RequestContext) {
    requirePassword(input.newPassword);
    // O hash vem antes da busca: a resposta leva o mesmo tempo com e sem conta.
    const passwordHash = await hashPassword(input.newPassword);
    if (input.directorToken) {
      if (!checkToken('director', input.directorToken)) {
        await recordAudit(pool, { actorUserId: null, action: 'password_reset.token_rejected', correlationId: ctx.correlationId });
        throw new AppError(403, 'FORBIDDEN', 'Token do Diretor incorreto.');
      }
      await withTransaction(pool, async (db) => {
        const user = (
          await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL FOR UPDATE', [input.email])
        ).rows[0];
        if (!user) throw notFound('Nenhuma conta com este e-mail');
        await db.query(
          `UPDATE password_reset_requests SET status = 'superseded', password_hash = NULL, decided_at = now()
            WHERE user_id = $1 AND status = 'pending'`,
          [user.id],
        );
        const revoked = await applyPassword(db, user.id, passwordHash, null);
        await recordAudit(db, {
          actorUserId: null,
          action: 'auth.password_reset',
          targetType: 'user',
          targetId: user.id,
          correlationId: ctx.correlationId,
          metadata: { by: 'director_token', revokedSessions: revoked },
        });
      });
      return { status: 'changed' as const };
    }

    await withTransaction(pool, async (db) => {
      const user = (
        await db.query<{ id: string; display_name: string; status: UserStatus }>(
          'SELECT id, display_name, status FROM users WHERE email = $1 AND deleted_at IS NULL FOR UPDATE',
          [input.email],
        )
      ).rows[0];
      // Resposta igual com e sem conta: o pedido não revela cadastros.
      if (!user || user.status !== 'active') {
        await recordAudit(db, {
          actorUserId: null,
          action: 'password_reset.request_ignored',
          targetType: 'user',
          ...(user ? { targetId: user.id } : {}),
          correlationId: ctx.correlationId,
          metadata: { reason: user ? user.status : 'unknown_user' },
        });
        return;
      }
      await db.query(
        `UPDATE password_reset_requests SET status = 'superseded', password_hash = NULL, decided_at = now()
          WHERE user_id = $1 AND status = 'pending'`,
        [user.id],
      );
      const created = (
        await db.query<{ id: string }>(`INSERT INTO password_reset_requests (user_id, password_hash) VALUES ($1, $2) RETURNING id`, [
          user.id,
          passwordHash,
        ])
      ).rows[0]!;
      await recordAudit(db, {
        actorUserId: null,
        action: 'password_reset.requested',
        targetType: 'user',
        targetId: user.id,
        correlationId: ctx.correlationId,
        metadata: { requestId: created.id },
      });
      const entry = {
        kind: 'password_reset_requested',
        title: `Pedido de senha nova: ${user.display_name}`,
        body: 'Confirme com a pessoa antes de autorizar. Em Equipe › Pedidos de senha.',
        dedupeKey: `password-reset:${created.id}`,
      };
      await notify(db, { teamId: null, directors: true }, entry);
      for (const [teamId, role] of await membershipsOf(db, user.id))
        if (role === 'operator') await notify(db, { teamId, leaders: true, exclude: user.id }, entry);
    });
    return { status: 'pending' as const };
  }

  /** Pedidos em aberto que a pessoa pode decidir: o Diretor vê todos; o Líder, os dos Usuários das equipes dele. */
  async function list(ctx: AuthenticatedContext) {
    const director = isDirector(ctx.actor);
    const led = [...ctx.actor.memberships].filter(([, role]) => role === 'leader').map(([teamId]) => teamId);
    if (!director && !led.length) throw forbidden();
    const result = await pool.query<{
      id: string;
      created_at: Date;
      user_id: string;
      display_name: string;
      email: string;
      org_role: string;
      leader_unlocks: number;
      access_expires_at: Date | null;
      teams: Array<{ teamId: string; name: string; role: TeamRole }>;
    }>(
      `SELECT r.id, r.created_at, u.id AS user_id, u.display_name, u.email::text, u.org_role, u.leader_unlocks, u.access_expires_at,
              coalesce((SELECT jsonb_agg(jsonb_build_object('teamId', m.team_id, 'name', t.name, 'role', m.role) ORDER BY t.name)
                          FROM team_memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = u.id), '[]') AS teams
         FROM password_reset_requests r JOIN users u ON u.id = r.user_id
        WHERE r.status = 'pending' AND u.id <> $1
          AND ($2 OR EXISTS (SELECT 1 FROM team_memberships m WHERE m.user_id = u.id AND m.role = 'operator' AND m.team_id = ANY($3::uuid[])))
        ORDER BY r.created_at`,
      [ctx.actor.id, director, led],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at.toISOString(),
        user: {
          id: row.user_id,
          name: row.display_name,
          email: row.email,
          role: row.org_role === 'director' ? 'Diretor' : row.teams.some((team) => team.role === 'leader') ? 'Líder' : 'Usuário',
          teams: row.teams.map((team) => team.name),
        },
        leaderUnlocks: row.leader_unlocks,
        accessExpiresAt: row.access_expires_at?.toISOString() ?? null,
        /** O Diretor autoriza de vez; o Líder libera por 24 horas, se ainda não liberou 3 vezes. */
        authorizeAs: director ? ('director' as const) : row.leader_unlocks < LEADER_UNLOCK_LIMIT ? ('leader' as const) : null,
      })),
    };
  }

  async function decide(ctx: AuthenticatedContext, id: string, input: { action: 'approve' | 'reject'; token?: string }) {
    return withTransaction(pool, async (db) => {
      const found = (
        await db.query<{ user_id: string; password_hash: string | null; status: string }>(
          'SELECT user_id, password_hash, status FROM password_reset_requests WHERE id = $1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      const target = found && { id: found.user_id, memberships: await membershipsOf(db, found.user_id) };
      if (!found || !target || !canAuthorizePasswordReset(ctx.actor, target)) throw notFound('Pedido não encontrado');
      if (found.status !== 'pending') throw conflict('Este pedido já foi decidido ou substituído por outro');
      const user = (
        await db.query<{ status: UserStatus; leader_unlocks: number }>(
          'SELECT status, leader_unlocks FROM users WHERE id = $1 FOR UPDATE',
          [found.user_id],
        )
      ).rows[0]!;
      const as = isDirector(ctx.actor) ? ('director' as const) : ('leader' as const);

      if (input.action === 'reject') {
        await db.query(
          `UPDATE password_reset_requests SET status = 'rejected', password_hash = NULL, decided_at = now(), decided_by = $2, decided_as = $3
            WHERE id = $1`,
          [id, ctx.actor.id, as],
        );
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'password_reset.rejected',
          targetType: 'user',
          targetId: found.user_id,
          correlationId: ctx.correlationId,
          metadata: { requestId: id },
        });
        return { status: 'rejected' as const, accessUntil: null };
      }

      if (!checkToken(as, input.token)) {
        // Registrado fora da transação, que é desfeita junto com o erro.
        throw new TokenRejected(as);
      }
      if (user.status !== 'active') throw conflict('A conta não está ativa; reative antes de trocar a senha');
      if (as === 'leader' && user.leader_unlocks >= LEADER_UNLOCK_LIMIT)
        throw conflict(`O Líder já liberou esta pessoa ${LEADER_UNLOCK_LIMIT} vezes seguidas; agora só o Diretor troca a senha`);
      const accessUntil = as === 'leader' ? new Date(now().getTime() + LEADER_UNLOCK_HOURS * 3_600_000) : null;
      const revoked = await applyPassword(db, found.user_id, found.password_hash!, accessUntil);
      await db.query(
        `UPDATE password_reset_requests SET status = 'approved', password_hash = NULL, decided_at = now(), decided_by = $2,
                decided_as = $3, access_until = $4
          WHERE id = $1`,
        [id, ctx.actor.id, as, accessUntil],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'auth.password_reset',
        targetType: 'user',
        targetId: found.user_id,
        correlationId: ctx.correlationId,
        metadata: {
          by: as,
          requestId: id,
          revokedSessions: revoked,
          ...(accessUntil ? { accessUntil: accessUntil.toISOString(), unlock: user.leader_unlocks + 1 } : {}),
        },
      });
      return { status: 'approved' as const, accessUntil: accessUntil?.toISOString() ?? null };
    });
  }

  /** Token errado: o registro na auditoria fica mesmo com o erro. */
  async function decideOrAudit(ctx: AuthenticatedContext, id: string, input: { action: 'approve' | 'reject'; token?: string }) {
    try {
      return await decide(ctx, id, input);
    } catch (error) {
      if (!(error instanceof TokenRejected)) throw error;
      await recordAudit(pool, {
        actorUserId: ctx.actor.id,
        action: 'password_reset.token_rejected',
        targetType: 'password_reset',
        targetId: id,
        correlationId: ctx.correlationId,
        metadata: { as: error.as },
      });
      throw new AppError(403, 'FORBIDDEN', error.as === 'director' ? 'Token do Diretor incorreto.' : 'Token do Líder incorreto.');
    }
  }

  return { request, list, decide: decideOrAudit };
}

class TokenRejected extends Error {
  constructor(readonly as: 'director' | 'leader') {
    super('token');
  }
}

export type RecoveryService = ReturnType<typeof createRecoveryService>;
