import { withFileSecrets } from '@tradutor/core/crypto';
import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  COOKIE_SECURE: booleanFlag,
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(43200).default(120),
  TRUST_PROXY: booleanFlag,
  // Armazenamento S3 (ADR-002/ADR-006). Credenciais sem valor padrão.
  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,62}$/),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
  // Limites de upload (ADR-006). O teto de 100 arquivos por lote é requisito do produto.
  UPLOAD_MAX_FILE_MB: z.coerce.number().int().min(1).max(1024).default(50),
  UPLOAD_MAX_BATCH_FILES: z.coerce.number().int().min(1).max(100).default(100),
  UPLOAD_MAX_BATCH_MB: z.coerce.number().int().min(1).max(10_240).default(1024),
  UPLOAD_TMP_DIR: z.string().min(1).optional(),
  // Revisão automática (ADR-016): o mesmo provedor gratuito do worker, para retraduzir trechos no idioma errado.
  LIBRETRANSLATE_URL: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  LIBRETRANSLATE_API_KEY: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  DEEPL_API_KEY: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  // Conversor Word → PDF (Gotenberg/LibreOffice) para baixar a prévia e a tradução em PDF (ADR-017).
  CONVERTER_URL: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  // Tokens fixos do Diretor e do Líder: sem valor, valem os tokens entregues com o sistema (só o hash fica no código).
  DIRECTOR_TOKEN: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  LEADER_TOKEN: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  // Gerenciamento AI (ADR-021): sem chave, a IA fica indisponível e o sistema segue normalmente.
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((value) => value || undefined),
});

export type Config = z.infer<typeof schema>;

/** Segredos podem vir de arquivo (`NOME_FILE`), como os segredos do Docker e do Kubernetes (ADR-032). */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(withFileSecrets(env));
