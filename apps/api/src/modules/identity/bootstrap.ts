import type { Pool } from 'pg';
import { withTransaction } from '@tradutor/core/db';
import { recordAudit } from '../audit/audit.js';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from './passwords.js';

const BOOTSTRAP_LOCK = 724_002;

export class BootstrapRefused extends Error {}

/**
 * Cria o primeiro Diretor (ADR-004), pela linha de comando ou pela configuração inicial na interface. Recusa se já
 * houver Diretor ou se o e-mail existir.
 */
export async function bootstrapDirector(
  pool: Pool,
  input: { email: string; displayName: string; password: string; testAccount?: boolean; via?: 'cli' | 'web' },
) {
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) {
    throw new BootstrapRefused(`A senha deve ter entre ${PASSWORD_MIN} e ${PASSWORD_MAX} caracteres`);
  }
  const passwordHash = await hashPassword(input.password);
  return withTransaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]);
    const directors = await db.query(`SELECT 1 FROM users WHERE org_role = 'director' LIMIT 1`);
    if (directors.rowCount) throw new BootstrapRefused('Já existe um Diretor; promova novos Diretores pela aplicação');
    const existing = await db.query('SELECT 1 FROM users WHERE email = $1', [input.email]);
    if (existing.rowCount) throw new BootstrapRefused('E-mail já cadastrado');
    const created = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, status, org_role, reviewed_at, test_account)
       VALUES ($1, $2, $3, 'active', 'director', now(), $4) RETURNING id`,
      [input.email, input.displayName, passwordHash, input.testAccount ?? false],
    );
    const id = created.rows[0]!.id;
    await recordAudit(db, {
      actorUserId: null,
      action: 'director.bootstrapped',
      targetType: 'user',
      targetId: id,
      metadata: { via: input.via ?? 'cli', ...(input.testAccount ? { testAccount: true } : {}) },
    });
    return id;
  });
}
