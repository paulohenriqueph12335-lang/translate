import type { Actor, OrgRole, TeamRole, UserStatus } from '../access/policy.js';
import { canRevokeSessionsOf } from '../access/policy.js';
import { recordAudit } from '../audit/audit.js';
import { withTransaction } from '@tradutor/core/db';
import { AppError, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, RequestContext, ServiceDeps } from '../context.js';
import { getDummyHash, hashPassword, verifyPassword } from './passwords.js';
import { hashToken, newSessionToken } from './tokens.js';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  orgRole: OrgRole;
  createdAt: string;
  /** Conta criada como teste na configuração inicial: pode ser excluída. */
  testAccount: boolean;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: UserStatus;
  org_role: OrgRole;
  created_at: Date;
  test_account: boolean;
}

export const USER_COLUMNS = 'u.id, u.email, u.display_name, u.status, u.org_role, u.created_at, u.test_account';

export const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  status: row.status,
  orgRole: row.org_role,
  createdAt: row.created_at.toISOString(),
  testAccount: row.test_account,
});

export interface Membership {
  teamId: string;
  teamName: string;
  role: TeamRole;
}

export function createIdentityService({ pool, config, now = () => new Date() }: ServiceDeps) {
  const ttlMs = config.SESSION_TTL_HOURS * 3_600_000;
  const idleMs = config.SESSION_IDLE_MINUTES * 60_000;

  async function signup(input: { email: string; displayName: string; password: string }, ctx: RequestContext) {
    const passwordHash = await hashPassword(input.password);
    await withTransaction(pool, async (db) => {
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [input.email, input.displayName, passwordHash],
      );
      const id = inserted.rows[0]?.id;
      // Resposta idêntica para e-mail novo ou existente, sem revelar cadastros.
      await recordAudit(db, {
        actorUserId: id ?? null,
        action: id ? 'auth.signup' : 'auth.signup_duplicate',
        targetType: 'user',
        ...(id ? { targetId: id } : {}),
        correlationId: ctx.correlationId,
      });
    });
  }

  async function login(input: { email: string; password: string }, ctx: RequestContext) {
    const found = await pool.query<UserRow & { password_hash: string }>(
      `SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE u.email = $1`,
      [input.email],
    );
    const row = found.rows[0];
    const valid = await verifyPassword(input.password, row?.password_hash ?? (await getDummyHash()));
    if (!row || !valid) {
      await recordAudit(pool, {
        actorUserId: null,
        action: 'auth.login_failed',
        targetType: 'user',
        ...(row ? { targetId: row.id } : {}),
        correlationId: ctx.correlationId,
        metadata: { reason: row ? 'bad_password' : 'unknown_user' },
      });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos');
    }
    if (row.status !== 'active') {
      await recordAudit(pool, {
        actorUserId: null,
        action: 'auth.login_denied',
        targetType: 'user',
        targetId: row.id,
        correlationId: ctx.correlationId,
        metadata: { status: row.status },
      });
      if (row.status === 'pending') throw new AppError(403, 'ACCOUNT_PENDING', 'Cadastro aguardando aprovação');
      throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'Conta indisponível. Procure a administração.');
    }

    const token = newSessionToken();
    const issuedAt = now();
    const session = await withTransaction(pool, async (db) => {
      const created = await db.query<{ id: string; expires_at: Date }>(
        `INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at, user_agent)
         VALUES ($1, $2, $3, $3, $4, $5) RETURNING id, expires_at`,
        [row.id, hashToken(token), issuedAt, new Date(issuedAt.getTime() + ttlMs), ctx.userAgent?.slice(0, 256) ?? null],
      );
      const createdSession = created.rows[0]!;
      await recordAudit(db, {
        actorUserId: row.id,
        action: 'auth.login',
        targetType: 'session',
        targetId: createdSession.id,
        correlationId: ctx.correlationId,
      });
      return createdSession;
    });
    return { token, expiresAt: session.expires_at, user: toPublicUser(row) };
  }

  /** Valida o token e recarrega usuário e associações; qualquer estado não ativo invalida a sessão. */
  async function authenticate(token: string): Promise<{ actor: Actor; sessionId: string; user: PublicUser } | null> {
    const current = now();
    const result = await pool.query<UserRow & { session_id: string; last_seen_at: Date }>(
      `SELECT s.id AS session_id, s.last_seen_at, ${USER_COLUMNS}
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND s.last_seen_at > $3`,
      [hashToken(token), current, new Date(current.getTime() - idleMs)],
    );
    const row = result.rows[0];
    if (!row || row.status !== 'active') return null;
    if (current.getTime() - row.last_seen_at.getTime() > 60_000) {
      await pool.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [row.session_id, current]);
    }
    const memberships = await pool.query<{ team_id: string; role: TeamRole }>(
      'SELECT team_id, role FROM team_memberships WHERE user_id = $1',
      [row.id],
    );
    return {
      sessionId: row.session_id,
      user: toPublicUser(row),
      actor: {
        id: row.id,
        status: row.status,
        orgRole: row.org_role,
        memberships: new Map(memberships.rows.map((membership) => [membership.team_id, membership.role])),
      },
    };
  }

  async function listMemberships(userId: string): Promise<Membership[]> {
    const result = await pool.query<{ team_id: string; name: string; role: TeamRole }>(
      `SELECT m.team_id, t.name, m.role FROM team_memberships m JOIN teams t ON t.id = m.team_id
        WHERE m.user_id = $1 ORDER BY t.name`,
      [userId],
    );
    return result.rows.map((row) => ({ teamId: row.team_id, teamName: row.name, role: row.role }));
  }

  async function logout(ctx: AuthenticatedContext) {
    await withTransaction(pool, async (db) => {
      await db.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1 AND revoked_at IS NULL`, [
        ctx.sessionId,
      ]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'auth.logout',
        targetType: 'session',
        targetId: ctx.sessionId,
        correlationId: ctx.correlationId,
      });
    });
  }

  async function listOwnSessions(ctx: AuthenticatedContext) {
    const result = await pool.query<{ id: string; created_at: Date; last_seen_at: Date; expires_at: Date; user_agent: string | null }>(
      `SELECT id, created_at, last_seen_at, expires_at, user_agent FROM sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 100`,
      [ctx.actor.id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      userAgent: row.user_agent,
      current: row.id === ctx.sessionId,
    }));
  }

  /** Revoga uma sessão própria; sessão de outra pessoa é tratada como inexistente. */
  async function revokeOwnSession(ctx: AuthenticatedContext, sessionId: string) {
    await withTransaction(pool, async (db) => {
      const result = await db.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'user'
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [sessionId, ctx.actor.id],
      );
      if (result.rowCount === 0) throw notFound('Sessão não encontrada');
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'session.revoked',
        targetType: 'session',
        targetId: sessionId,
        correlationId: ctx.correlationId,
        metadata: { scope: 'single' },
      });
    });
  }

  async function revokeAllSessionsOf(ctx: AuthenticatedContext, userId: string) {
    if (!canRevokeSessionsOf(ctx.actor, userId)) throw forbidden();
    return withTransaction(pool, async (db) => {
      const exists = await db.query('SELECT 1 FROM users WHERE id = $1', [userId]);
      if (exists.rowCount === 0) throw notFound('Usuário não encontrado');
      const reason = ctx.actor.id === userId ? 'user' : 'director';
      const result = await db.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, reason],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'session.revoked',
        targetType: 'user',
        targetId: userId,
        correlationId: ctx.correlationId,
        metadata: { scope: 'all', count: result.rowCount ?? 0 },
      });
      return result.rowCount ?? 0;
    });
  }

  return { signup, login, authenticate, listMemberships, logout, listOwnSessions, revokeOwnSession, revokeAllSessionsOf };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
