import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

export const defaultMigrationsDir = fileURLToPath(new URL('../../../../packages/database/migrations', import.meta.url));

const MIGRATION_LOCK = 724_001;

/** Aplica, em ordem e uma única vez, os arquivos `NNNN_nome.sql`. Cada arquivo roda em sua própria transação. */
export async function migrate(pool: Pool, directory = defaultMigrationsDir, log: (message: string) => void = () => undefined) {
  const files = (await readdir(directory)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
    for (const file of files) {
      const version = path.basename(file, '.sql');
      if (done.has(version)) continue;
      const sql = await readFile(path.join(directory, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [version]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Falha ao aplicar migração ${version}`, { cause: error });
      }
      applied.push(version);
      log(`Migração aplicada: ${version}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return applied;
}
