import { Pool } from 'pg';
import { z } from 'zod';

const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .parse(process.env);
const database = new Pool({ connectionString: config.DATABASE_URL, max: 5 });
const log = (level: 'info' | 'error', message: string, details: Record<string, unknown> = {}) => {
  process.stdout.write(`${JSON.stringify({ level, message, time: new Date().toISOString(), ...details })}\n`);
};

try {
  await database.query('SELECT 1');
  log('info', 'Worker iniciado; processamento documental será habilitado na próxima fase');
} catch (error) {
  log('error', 'Worker não conseguiu conectar ao banco', { error: String(error) });
  process.exit(1);
}

const shutdown = async (signal: string) => {
  log('info', 'Encerrando worker', { signal });
  await database.end();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
setInterval(
  () => void database.query('SELECT 1').catch((error: unknown) => log('error', 'Verificação do banco falhou', { error: String(error) })),
  30_000,
).unref();
