import { withTransaction } from '@tradutor/core/db';
import { isDirector } from '../access/policy.js';
import { recordAudit } from '../audit/audit.js';
import { AppError, conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, RequestContext, ServiceDeps } from '../context.js';
import type { PoolClient } from 'pg';
import { BootstrapRefused, bootstrapDirector } from './bootstrap.js';
import { hashPassword } from './passwords.js';
import type { MasterTokenCheck } from './master-tokens.js';

/**
 * Contas de demonstração criadas junto com o Diretor de teste: dados fictícios fixos (domínio reservado exemplo.com) e a
 * mesma senha que a pessoa digitou na configuração inicial; nenhuma senha fica no código.
 */
export const DEMO_TEAM = 'Equipe de Teste';
export const DEMO_ACCOUNTS = [
  { role: 'leader', email: 'lider.teste@exemplo.com', displayName: 'Líder de Teste' },
  { role: 'operator', email: 'usuario.teste@exemplo.com', displayName: 'Usuário de Teste' },
] as const;

/** Tira os dados pessoais e o acesso de uma conta de teste; a auditoria e o que ela fez ficam. */
async function anonymize(db: Pick<PoolClient, 'query'>, userId: string) {
  await db.query('DELETE FROM team_memberships WHERE user_id = $1', [userId]);
  await db.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'user' WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  await db.query(
    `UPDATE users SET email = 'excluida-' || id || '@conta-de-teste.invalid', display_name = 'Conta de teste excluída',
            password_hash = '!', org_role = 'member', status = 'rejected', deleted_at = now(), updated_at = now()
      WHERE id = $1`,
    [userId],
  );
}

/**
 * Configuração inicial (ADR-004, revisões de 2026-10-22 e 2026-10-28). Enquanto não há Diretor, quem tem o Token do
 * Diretor cria o primeiro pela interface. O token é fixo; errar é registrado na auditoria e limitado por IP.
 */
export function createSetupService({ pool, checkToken }: ServiceDeps & { checkToken: MasterTokenCheck }) {
  async function needed() {
    const directors = await pool.query(`SELECT 1 FROM users WHERE org_role = 'director' LIMIT 1`);
    return directors.rowCount === 0;
  }

  async function createDirector(
    input: { code: string; email: string; displayName: string; password: string; testAccount: boolean; demoAccounts?: boolean },
    ctx: RequestContext,
  ) {
    if (!(await needed())) throw conflict('O sistema já tem um Diretor; entre com a sua conta');
    if (input.demoAccounts) {
      const taken = await pool.query(`SELECT 1 FROM users WHERE email = ANY($1::citext[])`, [
        DEMO_ACCOUNTS.map((account) => account.email),
      ]);
      if (taken.rowCount) throw conflict('Os e-mails das contas de teste do Líder e do Usuário já estão em uso');
    }
    if (!checkToken('director', input.code)) {
      await recordAudit(pool, { actorUserId: null, action: 'setup.code_rejected', correlationId: ctx.correlationId });
      throw new AppError(403, 'FORBIDDEN', 'Token do Diretor incorreto.');
    }
    try {
      const id = await bootstrapDirector(pool, {
        email: input.email,
        displayName: input.displayName,
        password: input.password,
        testAccount: input.testAccount || !!input.demoAccounts,
        via: 'web',
      });
      if (input.demoAccounts) await createDemoAccounts(id, input.password, ctx);
      return id;
    } catch (error) {
      if (error instanceof BootstrapRefused) throw conflict(error.message);
      throw error;
    }
  }

  /** Líder e Usuário de teste numa equipe de teste, criados pelo Diretor de teste recém-criado. */
  async function createDemoAccounts(directorId: string, password: string, ctx: RequestContext) {
    const hashes = await Promise.all(DEMO_ACCOUNTS.map(() => hashPassword(password)));
    await withTransaction(pool, async (db) => {
      const existing = await db.query<{ name: string }>(`SELECT name::text FROM teams WHERE name ILIKE $1`, [`${DEMO_TEAM}%`]);
      const names = new Set(existing.rows.map((row) => row.name.toLowerCase()));
      let name: string = DEMO_TEAM;
      for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${DEMO_TEAM} ${n}`;
      const teamId = (
        await db.query<{ id: string }>('INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id', [name, directorId])
      ).rows[0]!.id;
      for (const [index, account] of DEMO_ACCOUNTS.entries()) {
        const userId = (
          await db.query<{ id: string }>(
            `INSERT INTO users (email, display_name, password_hash, status, org_role, reviewed_at, reviewed_by, test_account)
             VALUES ($1, $2, $3, 'active', 'member', now(), $4, true) RETURNING id`,
            [account.email, account.displayName, hashes[index], directorId],
          )
        ).rows[0]!.id;
        await db.query('INSERT INTO team_memberships (team_id, user_id, role, created_by) VALUES ($1, $2, $3, $4)', [
          teamId,
          userId,
          account.role,
          directorId,
        ]);
      }
      await recordAudit(db, {
        actorUserId: directorId,
        action: 'setup.demo_accounts_created',
        targetType: 'team',
        targetId: teamId,
        // Sem team_id: a auditoria é imutável e prenderia a equipe de teste, que precisa poder sair.
        correlationId: ctx.correlationId,
        metadata: { accounts: DEMO_ACCOUNTS.map((account) => account.email) },
      });
    });
  }

  /** Contas de teste ainda ativas, para o aviso do Diretor. */
  async function listTestAccounts(ctx: AuthenticatedContext) {
    if (!isDirector(ctx.actor)) throw forbidden();
    const result = await pool.query<{ id: string; display_name: string; email: string; org_role: string; role: string | null }>(
      `SELECT u.id, u.display_name, u.email::text, u.org_role,
              (SELECT m.role FROM team_memberships m WHERE m.user_id = u.id LIMIT 1) AS role
         FROM users u WHERE u.test_account AND u.deleted_at IS NULL ORDER BY u.org_role, u.created_at`,
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.display_name,
        email: row.email,
        role: row.org_role === 'director' ? 'Diretor' : row.role === 'leader' ? 'Líder' : 'Usuário',
      })),
    };
  }

  /**
   * Exclui todas as contas de teste de uma vez (Diretor). A equipe de teste sai junto quando nada no sistema depende
   * dela; sem Diretor, a configuração inicial volta.
   */
  async function deleteAllTestAccounts(ctx: AuthenticatedContext) {
    if (!isDirector(ctx.actor)) throw forbidden('Só um Diretor exclui todas as contas de teste');
    const removed = await withTransaction(pool, async (db) => {
      const ids = (await db.query<{ id: string }>('SELECT id FROM users WHERE test_account AND deleted_at IS NULL FOR UPDATE')).rows.map(
        (row) => row.id,
      );
      for (const id of ids) {
        await anonymize(db, id);
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'user.test_account_deleted',
          targetType: 'user',
          targetId: id,
          correlationId: ctx.correlationId,
        });
      }
      // Equipe de teste sem ninguém: sai, se nenhum envio, glossário ou outro registro depender dela.
      const teams = await db.query<{ id: string }>(
        `SELECT t.id FROM teams t WHERE t.name ILIKE $1 AND t.created_by = ANY($2::uuid[])
            AND NOT EXISTS (SELECT 1 FROM team_memberships m WHERE m.team_id = t.id)`,
        [`${DEMO_TEAM}%`, ids],
      );
      for (const team of teams.rows) {
        await db.query('SAVEPOINT remove_test_team');
        try {
          await db.query('DELETE FROM teams WHERE id = $1', [team.id]);
          await db.query('RELEASE SAVEPOINT remove_test_team');
        } catch {
          await db.query('ROLLBACK TO SAVEPOINT remove_test_team');
        }
      }
      return ids.length;
    });
    return { removed, setupNeeded: await needed() };
  }

  /**
   * Exclui uma conta de teste: a própria pessoa ou um Diretor. Os dados pessoais saem (nome, e-mail, senha, sessões e
   * equipes) e a conta deixa de ser Diretor; o histórico de auditoria e o que ela fez no sistema ficam. Sem Diretor, a
   * configuração inicial volta.
   */
  async function deleteTestAccount(ctx: AuthenticatedContext, userId: string) {
    if (ctx.actor.id !== userId && !isDirector(ctx.actor)) throw forbidden('Só a própria pessoa ou um Diretor exclui uma conta de teste');
    await withTransaction(pool, async (db) => {
      const target = (
        await db.query<{ test_account: boolean; deleted_at: Date | null }>(
          'SELECT test_account, deleted_at FROM users WHERE id = $1 FOR UPDATE',
          [userId],
        )
      ).rows[0];
      if (!target || target.deleted_at) throw notFound('Usuário não encontrado');
      if (!target.test_account) throw forbidden('Só contas criadas como teste podem ser excluídas');
      await anonymize(db, userId);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'user.test_account_deleted',
        targetType: 'user',
        targetId: userId,
        correlationId: ctx.correlationId,
      });
    });
    return { setupNeeded: await needed() };
  }

  return { needed, createDirector, listTestAccounts, deleteTestAccount, deleteAllTestAccounts };
}

export type SetupService = ReturnType<typeof createSetupService>;
