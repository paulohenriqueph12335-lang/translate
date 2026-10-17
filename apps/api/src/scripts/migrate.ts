import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL não definido\n');
  process.exit(1);
}
const pool = createPool(url, 1);
try {
  const applied = await migrate(pool, process.env.MIGRATIONS_DIR, (message) => process.stdout.write(`${message}\n`));
  process.stdout.write(applied.length ? `${applied.length} migração(ões) aplicada(s)\n` : 'Banco já está atualizado\n');
} catch (error) {
  process.stderr.write(`${String(error)}\n${String((error as Error).cause ?? '')}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
