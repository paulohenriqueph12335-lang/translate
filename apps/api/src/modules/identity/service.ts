import type { Actor, OrgRole, TeamRole, UserStatus } from '../access/policy.js';
import { canRevokeSessionsOf } from '../access/policy.js';
import { recordAudit } from '../audit/audit.js';
import { withTransaction } from '@tradutor/core/db';
import { AppError, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, RequestContext, ServiceDeps } from '../context.js';
import { getDummyHash, hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from './passwords.js';
import { toUserPreferences, type PreferencesRow, type UserPreferences, type UserPreferencesPatch } from './preferences.js';
import { LEADER_UNLOCK_LIMIT } from './recovery.js';
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
  /** Acesso liberado pelo Líder: termina nesta hora, até o Diretor trocar a senha. */
  accessExpiresAt: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: UserStatus;
  org_role: OrgRole;
  created_at: Date;
  test_account: boolean;
  access_expires_at: Date | null;
}

export const USER_COLUMNS = 'u.id, u.email, u.display_name, u.status, u.org_role, u.created_at, u.test_account, u.access_expires_at';

export const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  status: row.status,
  orgRole: row.org_role,
  createdAt: row.created_at.toISOString(),
  testAccount: row.test_account,
  accessExpiresAt: row.access_expires_at?.toISOString() ?? null,
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
    if (row.access_expires_at && row.access_expires_at <= now()) {
      const unlocks = (await pool.query<{ leader_unlocks: number }>('SELECT leader_unlocks FROM users WHERE id = $1', [row.id])).rows[0]
        ?.leader_unlocks;
      await recordAudit(pool, {
        actorUserId: null,
        action: 'auth.login_denied',
        targetType: 'user',
        targetId: row.id,
        correlationId: ctx.correlationId,
        metadata: { reason: 'access_expired' },
      });
      throw new AppError(
        403,
        'ACCESS_EXPIRED',
        (unlocks ?? 0) >= LEADER_UNLOCK_LIMIT
          ? `O acesso liberado pelo Líder terminou e já foi liberado ${LEADER_UNLOCK_LIMIT} vezes. Agora só o Diretor troca a sua senha: peça em "Esqueci a senha".`
          : 'O acesso liberado pelo Líder terminou. Peça uma senha nova em "Esqueci a senha".',
      );
    }

    const token = newSessionToken();
    const issuedAt = now();
    const session = await withTransaction(pool, async (db) => {
      // Serializa a emissão da sessão com troca de senha/suspensão: a senha verificada acima ainda deve ser a atual.
      const locked = await db.query<UserRow & { password_hash: string }>(
        `SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE u.id = $1 FOR UPDATE`,
        [row.id],
      );
      const currentUser = locked.rows[0];
      if (!currentUser || currentUser.status !== 'active' || currentUser.password_hash !== row.password_hash) return null;
      // Acesso liberado pelo Líder: a sessão não passa do fim da liberação.
      const ttlEnd = new Date(issuedAt.getTime() + ttlMs);
      const expiresAt = currentUser.access_expires_at && currentUser.access_expires_at < ttlEnd ? currentUser.access_expires_at : ttlEnd;
      const created = await db.query<{ id: string; expires_at: Date }>(
        `INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at, user_agent)
         VALUES ($1, $2, $3, $3, $4, $5) RETURNING id, expires_at`,
        [row.id, hashToken(token), issuedAt, expiresAt, ctx.userAgent?.slice(0, 256) ?? null],
      );
      const createdSession = created.rows[0]!;
      await recordAudit(db, {
        actorUserId: row.id,
        action: 'auth.login',
        targetType: 'session',
        targetId: createdSession.id,
        correlationId: ctx.correlationId,
      });
      return { ...createdSession, user: toPublicUser(currentUser) };
    });
    if (!session) {
      await recordAudit(pool, {
        actorUserId: null,
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: row.id,
        correlationId: ctx.correlationId,
        metadata: { reason: 'account_changed' },
      });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos');
    }
    return { token, expiresAt: session.expires_at, user: session.user };
  }

  /** Valida o token e recarrega usuário e associações; qualquer estado não ativo invalida a sessão. */
  async function authenticate(token: string): Promise<{ actor: Actor; sessionId: string; user: PublicUser } | null> {
    const current = now();
    const result = await pool.query<UserRow & { session_id: string; last_seen_at: Date }>(
      `SELECT s.id AS session_id, s.last_seen_at, ${USER_COLUMNS}
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND s.last_seen_at > $3
          AND (u.access_expires_at IS NULL OR u.access_expires_at > $2)`,
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

  async function getOwnPreferences(ctx: AuthenticatedContext): Promise<UserPreferences> {
    const result = await pool.query<PreferencesRow>(
      `SELECT notifications_enabled, notification_frequency, theme FROM users WHERE id = $1 AND status = 'active'`,
      [ctx.actor.id],
    );
    if (!result.rows[0]) throw new AppError(401, 'UNAUTHENTICATED', 'Sessão ausente ou expirada');
    return toUserPreferences(result.rows[0]);
  }

  async function updateOwnPreferences(ctx: AuthenticatedContext, input: UserPreferencesPatch): Promise<UserPreferences> {
    return withTransaction(pool, async (db) => {
      const result = await db.query<PreferencesRow>(
        `UPDATE users SET notifications_enabled = COALESCE($2, notifications_enabled),
                         notification_frequency = COALESCE($3, notification_frequency),
                         theme = COALESCE($4, theme), updated_at = now()
          WHERE id = $1 AND status = 'active' RETURNING notifications_enabled, notification_frequency, theme`,
        [ctx.actor.id, input.notificationsEnabled ?? null, input.notificationFrequency ?? null, input.theme ?? null],
      );
      if (!result.rows[0]) throw new AppError(401, 'UNAUTHENTICATED', 'Sessão ausente ou expirada');
      if (input.notificationsEnabled !== undefined || input.notificationFrequency !== undefined) {
        // A preferência global também é usada pelos avisos inteligentes: reativar não reproduz o acervo antigo.
        await db.query(
          `UPDATE notification_delivery_state SET cursor_id=coalesce((SELECT max(id) FROM notifications WHERE user_id=$1),0),
             initialized_at=$2,last_delivered_at=NULL WHERE user_id=$1`,
          [ctx.actor.id, now()],
        );
      }
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'auth.preferences_updated',
        targetType: 'user',
        targetId: ctx.actor.id,
        correlationId: ctx.correlationId,
        metadata: { ...input },
      });
      return toUserPreferences(result.rows[0]);
    });
  }

  async function changeOwnPassword(ctx: AuthenticatedContext, input: { currentPassword: string; newPassword: string }) {
    if (input.newPassword.length < PASSWORD_MIN || input.newPassword.length > PASSWORD_MAX) {
      throw new AppError(400, 'VALIDATION_FAILED', `Use entre ${PASSWORD_MIN} e ${PASSWORD_MAX} caracteres`);
    }
    const changed = await withTransaction(pool, async (db) => {
      // Reconfere conta e sessão após obter o lock: outra troca de senha pode ter revogado esta sessão.
      const result = await db.query<{ password_hash: string; status: UserStatus }>(
        'SELECT password_hash, status FROM users WHERE id = $1 FOR UPDATE',
        [ctx.actor.id],
      );
      const user = result.rows[0];
      if (!user || user.status !== 'active') throw new AppError(401, 'UNAUTHENTICATED', 'Sessão ausente ou expirada');
      const current = now();
      const session = await db.query(
        `SELECT id FROM sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
          AND expires_at > $3 AND last_seen_at > $4 FOR UPDATE`,
        [ctx.sessionId, ctx.actor.id, current, new Date(current.getTime() - idleMs)],
      );
      if (!session.rowCount) throw new AppError(401, 'UNAUTHENTICATED', 'Sessão ausente ou expirada');
      if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'auth.password_change_failed',
          targetType: 'user',
          targetId: ctx.actor.id,
          correlationId: ctx.correlationId,
          metadata: { reason: 'bad_current_password' },
        });
        return false;
      }
      if (input.newPassword.normalize('NFKC') === input.currentPassword.normalize('NFKC')) {
        throw new AppError(400, 'VALIDATION_FAILED', 'A nova senha deve ser diferente da senha atual');
      }
      await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
        ctx.actor.id,
        await hashPassword(input.newPassword),
      ]);
      const revoked = await db.query(
        `UPDATE sessions SET revoked_at = $3, revoked_reason = 'password_changed'
          WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [ctx.actor.id, ctx.sessionId, current],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'auth.password_changed',
        targetType: 'user',
        targetId: ctx.actor.id,
        correlationId: ctx.correlationId,
        metadata: { revokedSessions: revoked.rowCount ?? 0 },
      });
      return true;
    });
    if (!changed) throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Senha atual incorreta');
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
      // Mantém a mesma ordem de locks da troca de senha e da suspensão: conta antes das sessões.
      const exists = await db.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
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

  return {
    signup,
    login,
    authenticate,
    listMemberships,
    getOwnPreferences,
    updateOwnPreferences,
    changeOwnPassword,
    logout,
    listOwnSessions,
    revokeOwnSession,
    revokeAllSessionsOf,
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
