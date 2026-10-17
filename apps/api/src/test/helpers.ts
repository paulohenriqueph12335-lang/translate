import pg from 'pg';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type AppDeps } from '../app.js';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';

/** Banco descartável por arquivo de teste, criado no PostgreSQL local (porta do host) ou em TEST_DATABASE_URL. */
export function testDatabaseUrl(name: string) {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const user = encodeURIComponent(process.env.POSTGRES_USER ?? 'tradutor');
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD ?? 'dev-only-change-me');
  const host = process.env.TEST_DATABASE_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5433';
  return `postgres://${user}:${password}@${host}:${port}/tradutor_test_${name}`;
}

export async function createTestDatabase(name: string) {
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

const relaxedLimits = { login: { limit: 10_000, windowMs: 60_000 }, signup: { limit: 10_000, windowMs: 60_000 } };

export async function createTestApp(name: string, options: Omit<Partial<AppDeps>, 'config' | 'pool'> = {}) {
  const { url, pool } = await createTestDatabase(name);
  const config = loadConfig({ DATABASE_URL: url, LOG_LEVEL: 'silent' });
  const build = (overrides: Omit<Partial<AppDeps>, 'config' | 'pool'> = {}) =>
    buildApp({ config, pool, logger: false, rateLimits: relaxedLimits, ...options, ...overrides });
  return { app: await build(), build, pool, config };
}

export interface TestResponse {
  status: number;
  body: any;
  raw: LightMyRequestResponse;
}

/** Cliente HTTP mínimo com "cookie jar" e cabeçalho CSRF. */
export class TestClient {
  cookie: string | undefined;

  constructor(
    private readonly app: FastifyInstance,
    private readonly options: { csrf?: boolean } = {},
  ) {}

  async request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<TestResponse> {
    const headers: Record<string, string> = {};
    if (this.options.csrf !== false) headers['x-csrf-protection'] = '1';
    if (this.cookie) headers.cookie = this.cookie;
    const response = await this.app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    const setCookie = response.cookies.find((cookie) => cookie.name === 'sid');
    if (setCookie) this.cookie = setCookie.value ? `sid=${setCookie.value}` : undefined;
    return { status: response.statusCode, body: response.body ? response.json() : undefined, raw: response };
  }

  get = (url: string): Promise<TestResponse> => this.request('GET', url);
  post = (url: string, body: unknown = {}): Promise<TestResponse> => this.request('POST', url, body);
}
