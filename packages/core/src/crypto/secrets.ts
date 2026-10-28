import { readFileSync } from 'node:fs';

/** Segredos que também podem vir de arquivo (`NOME_FILE`), como os segredos do Docker e do Kubernetes (ADR-032). */
export const FILE_SECRETS = [
  'DATABASE_URL',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'DEEPL_API_KEY',
  'GEMINI_API_KEY',
  'LIBRETRANSLATE_API_KEY',
  'DIRECTOR_TOKEN',
  'LEADER_TOKEN',
] as const;

/**
 * Lê `NOME_FILE` para cada segredo sem valor direto. O valor direto vence; o arquivo perde a quebra de linha final.
 * Nada é registrado em log.
 */
export function withFileSecrets(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...env };
  for (const name of FILE_SECRETS) {
    const file = env[`${name}_FILE`];
    if (env[name] || !file) continue;
    try {
      resolved[name] = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    } catch (error) {
      throw new Error(`Não foi possível ler ${name}_FILE (${file}): ${(error as Error).message}`);
    }
  }
  return resolved;
}
