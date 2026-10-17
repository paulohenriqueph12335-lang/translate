import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';

const config = loadConfig();
const database = createPool(config.DATABASE_URL);
const app = await buildApp({ config, pool: database });

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
