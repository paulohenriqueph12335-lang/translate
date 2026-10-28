import pg from 'pg';
import { configureEncryption, parseKeyring } from '../crypto/index.js';
import { createPool, migrate } from '../db/index.js';
import { createS3Storage, type S3Config } from '../storage/object-storage.js';

/**
 * Infraestrutura descartável para testes de integração (docs/testing.md):
 * um banco `tradutor_test_<nome>` no PostgreSQL local (ou `TEST_DATABASE_URL`) e um bucket `tradutor-test-<nome>` no S3 local.
 */
export function testDatabaseUrl(name: string) {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const user = encodeURIComponent(process.env.POSTGRES_USER ?? 'tradutor');
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? 'dev-only-change-me');
  const host = process.env.TEST_DATABASE_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5433';
  return `postgres://${user}:${password}@${host}:${port}/tradutor_test_${name}`;
}

/**
 * Chaves só dos testes (ADR-032): a primeira é a ativa; a segunda simula uma chave antiga, para os testes de rotação.
 * TEST_ENCRYPTION_KEYS troca as duas.
 */
export const TEST_ENCRYPTION_KEYS =
  process.env.TEST_ENCRYPTION_KEYS ?? `teste:${Buffer.alloc(32, 7).toString('base64')},antiga:${Buffer.alloc(32, 3).toString('base64')}`;

export const configureTestEncryption = (spec = TEST_ENCRYPTION_KEYS) => configureEncryption(parseKeyring(spec));

/** Recria o schema do banco de teste do zero e aplica todas as migrações. */
export async function createTestDatabase(name: string) {
  configureTestEncryption();
  const url = testDatabaseUrl(name);
  if (!process.env.TEST_DATABASE_URL) {
    const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    const database = new URL(url).pathname.slice(1);
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${database}"`);
    await admin.end();
  }
  const pool = createPool(url, 5);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  return { url, pool };
}

export const testStorageEnv = (name: string): S3Config => ({
  S3_ENDPOINT: process.env.S3_TEST_ENDPOINT ?? 'http://localhost:8333',
  S3_BUCKET: `tradutor-test-${name}`,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'tradutor-local',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'dev-only-change-this-s3-secret',
  S3_REGION: 'us-east-1',
});

export async function createTestStorage(name: string) {
  configureTestEncryption();
  const storage = createS3Storage(testStorageEnv(name));
  await storage.ensureReady();
  return storage;
}
