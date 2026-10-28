import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { configureEncryption, loadKeyring } from '@tradutor/core/crypto';
import { createPool } from '@tradutor/core/db';
import { createS3Storage } from '@tradutor/core/storage';

const config = loadConfig();
// Documentos cifrados em repouso (ADR-032): sem as chaves, a API não sobe.
configureEncryption(loadKeyring(process.env));
const database = createPool(config.DATABASE_URL);
const storage = createS3Storage(config);
const app = await buildApp({ config, pool: database, storage });

// O armazenamento pode subir depois da API no Compose: tenta criar/verificar o bucket algumas vezes.
for (let attempt = 1; ; attempt += 1) {
  try {
    await storage.ensureReady();
    break;
  } catch (error) {
    if (attempt >= 10) {
      app.log.error({ err: error }, 'Armazenamento indisponível; a API seguirá sem prontidão');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Encerrando API');
  await app.close();
  await database.end();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: '0.0.0.0', port: config.PORT });
} catch (error) {
  app.log.error(error);
  await database.end();
  process.exit(1);
}
