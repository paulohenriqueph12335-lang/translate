import { randomInt, timingSafeEqual } from 'node:crypto';
import { withTransaction } from '@tradutor/core/db';
import { isDirector } from '../access/policy.js';
import { recordAudit } from '../audit/audit.js';
import { AppError, conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, RequestContext, ServiceDeps } from '../context.js';
import { BootstrapRefused, bootstrapDirector } from './bootstrap.js';

/** Sem letras e números que se confundem (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Códigos errados que fazem o código ser trocado por outro (além do limite de tentativas por IP). */
const MAX_WRONG = 10;

/**
 * Configuração inicial (ADR-004, revisão de 2026-10-22). Enquanto não há Diretor, a API gera um código de uso único e
 * o escreve no próprio log (Docker Desktop → Containers → api → Logs); quem tem esse código cria o primeiro Diretor
 * pela interface. O código muda a cada reinício, depois de erros demais e quando volta a faltar Diretor.
 */
export function createSetupService({ pool, announce }: ServiceDeps & { announce: (code: string) => void }) {
  let code: string | null = null;
  let wrong = 0;

  const newCode = () => {
    const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    code = `${pick()}-${pick()}`;
    wrong = 0;
    announce(code);
  };

  async function needed() {
    const directors = await pool.query(`SELECT 1 FROM users WHERE org_role = 'director' LIMIT 1`);
    return directors.rowCount === 0;
  }

  /** Gera e anuncia o código quando falta Diretor; chamado ao subir a API e quando uma conta de teste sai. */
  async function prepare() {
    if (await needed()) {
      if (!code) newCode();
    } else code = null;
  }

  const matches = (given: string) => {
    if (!code) return false;
    const a = Buffer.from(
      given
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, ''),
    );
    const b = Buffer.from(code.replace('-', ''));
    return a.length === b.length && timingSafeEqual(a, b);
  };

  async function createDirector(
    input: { code: string; email: string; displayName: string; password: string; testAccount: boolean },
    ctx: RequestContext,
  ) {
    if (!(await needed())) throw conflict('O sistema já tem um Diretor; entre com a sua conta');
    if (!code) newCode();
    if (!matches(input.code)) {
      wrong += 1;
      await recordAudit(pool, { actorUserId: null, action: 'setup.code_rejected', correlationId: ctx.correlationId });
      if (wrong >= MAX_WRONG) newCode();
      throw new AppError(
        403,
        'FORBIDDEN',
        'Código de configuração incorreto. Confira no log da API (Docker Desktop → Containers → api → Logs).',
      );
    }
    try {
      const id = await bootstrapDirector(pool, {
        email: input.email,
        displayName: input.displayName,
        password: input.password,
        testAccount: input.testAccount,
        via: 'web',
      });
      code = null;
      return id;
    } catch (error) {
      if (error instanceof BootstrapRefused) throw conflict(error.message);
      throw error;
    }
  }

  /**
   * Exclui uma conta de teste: a própria pessoa ou um Diretor. Os dados pessoais saem (nome, e-mail, senha, sessões e
   * equipes) e a conta deixa de ser Diretor; o histórico de auditoria e o que ela fez no sistema ficam. Sem Diretor, a
   * configuração inicial volta com um código novo.
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
      await db.query('DELETE FROM team_memberships WHERE user_id = $1', [userId]);
      await db.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'user' WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      await db.query(
        `UPDATE users SET email = 'excluida-' || id || '@conta-de-teste.invalid', display_name = 'Conta de teste excluída',
                password_hash = '!', org_role = 'member', status = 'rejected', deleted_at = now(), updated_at = now()
          WHERE id = $1`,
        [userId],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'user.test_account_deleted',
        targetType: 'user',
        targetId: userId,
        correlationId: ctx.correlationId,
      });
    });
    await prepare();
    return { setupNeeded: await needed() };
  }

  return { needed, prepare, createDirector, deleteTestAccount };
}

export type SetupService = ReturnType<typeof createSetupService>;
