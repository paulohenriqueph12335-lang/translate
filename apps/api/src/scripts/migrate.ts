import { createPool, migrate } from '@tradutor/core/db';
import { seedSkillGlossary } from '@tradutor/core/translation';

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL não definido\n');
  process.exit(1);
}
const pool = createPool(url, 1);
try {
  const applied = await migrate(pool, process.env.MIGRATIONS_DIR, (message) => process.stdout.write(`${message}\n`));
  process.stdout.write(applied.length ? `${applied.length} migração(ões) aplicada(s)\n` : 'Banco já está atualizado\n');
  // Glossário das skills de tradução (ADR-015): entra uma vez, quando já existe um Diretor.
  const seeded = await seedSkillGlossary(pool);
  if (seeded) process.stdout.write(`${seeded} termo(s) do glossário das skills adicionados\n`);
} catch (error) {
  process.stderr.write(`${String(error)}\n${String((error as Error).cause ?? '')}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
