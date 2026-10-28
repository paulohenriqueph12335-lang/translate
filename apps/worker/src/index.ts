import os from 'node:os';
import { configureEncryption, loadKeyring, withFileSecrets } from '@tradutor/core/crypto';
import { createPool } from '@tradutor/core/db';
import { processNextJob, recordHeartbeat } from '@tradutor/core/processing';
import { createS3Storage } from '@tradutor/core/storage';
import { machineTranslatorsFromEnv } from '@tradutor/core/translation';
import { createGemini } from '@tradutor/core/ai';
import { z } from 'zod';

const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    S3_ENDPOINT: z.url(),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_REGION: z.string().min(1).default('us-east-1'),
    /** Tradução automática gratuita (ADR-008). */
    LIBRETRANSLATE_URL: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    LIBRETRANSLATE_API_KEY: z.string().optional(),
    DEEPL_API_KEY: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    WORKER_POLL_MS: z.coerce.number().int().min(200).max(60_000).default(2000),
    /** IA de apoio (ADR-021): sem chave, o sistema segue sem ela. */
    GEMINI_API_KEY: z
      .string()
      .optional()
      .transform((value) => value || undefined),
  })
  .parse(withFileSecrets(process.env));

// Documentos cifrados em repouso (ADR-032): sem as chaves, o worker não sobe.
configureEncryption(loadKeyring(process.env));

const silent = config.LOG_LEVEL === 'silent';
const log = (level: 'info' | 'warn' | 'error', message: string, details: Record<string, unknown> = {}) => {
  if (silent) return;
  process.stdout.write(`${JSON.stringify({ level, message, time: new Date().toISOString(), ...details })}\n`);
};

const database = createPool(config.DATABASE_URL, 5);
const deps = {
  pool: database,
  storage: createS3Storage(config),
  machine: machineTranslatorsFromEnv({
    ...(config.LIBRETRANSLATE_URL ? { LIBRETRANSLATE_URL: config.LIBRETRANSLATE_URL } : {}),
    ...(config.LIBRETRANSLATE_API_KEY ? { LIBRETRANSLATE_API_KEY: config.LIBRETRANSLATE_API_KEY } : {}),
    ...(config.DEEPL_API_KEY ? { DEEPL_API_KEY: config.DEEPL_API_KEY } : {}),
  }),
  ai: config.GEMINI_API_KEY ? (model: string) => createGemini(config.GEMINI_API_KEY!, model) : null,
  workerId: `${os.hostname()}:${process.pid}`,
  log,
};

let stopping = false;
const shutdown = async (signal: string) => {
  log('info', 'Encerrando worker', { signal });
  stopping = true;
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await database.query('SELECT 1');
  log('info', 'Worker iniciado', {
    tradutoresGratuitos: Object.keys(deps.machine),
    workerId: deps.workerId,
  });
} catch (error) {
  log('error', 'Worker não conseguiu conectar ao banco', { error: String(error) });
  process.exit(1);
}

const heartbeat = () =>
  recordHeartbeat(deps).catch((error: unknown) => log('warn', 'Falha ao registrar sinal do worker', { error: String(error) }));
await heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
heartbeatTimer.unref();

// Processa enquanto houver trabalho; quando a fila esvazia, espera o intervalo de consulta.
while (!stopping) {
  let worked = false;
  try {
    worked = await processNextJob(deps);
  } catch (error) {
    log('error', 'Erro ao consultar a fila', { error: String(error) });
  }
  if (!worked) await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
}
await database.end();
process.exit(0);
