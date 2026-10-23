import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { hashPassword } from './modules/identity/passwords.js';
import { createIdentityService } from './modules/identity/service.js';
import { createTestApp, TestClient } from './test/helpers.js';

const PASSWORD = 'senha-de-teste-123';
const NEW_PASSWORD = 'nova-senha-de-teste-456';
const defaults = { notificationsEnabled: true, notificationFrequency: 'immediate', theme: 'light' };
let app: FastifyInstance;
let pool: Pool;
let testApp: Awaited<ReturnType<typeof createTestApp>>;
let initialHash: string;
let sequence = 0;

before(async () => {
  testApp = await createTestApp('accountsettings', {
    rateLimits: {
      login: { limit: 10_000, windowMs: 60_000 },
      signup: { limit: 10_000, windowMs: 60_000 },
      password: { limit: 10_000, windowMs: 60_000 },
    },
  });
  ({ app, pool } = testApp);
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  initialHash = await hashPassword(PASSWORD);
});

after(async () => {
  await app?.close();
  await pool?.end();
});

async function account() {
  sequence += 1;
  const email = `pessoa-${sequence}@exemplo.test`;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, 'Pessoa de teste', $2, 'active') RETURNING id`,
    [email, initialHash],
  );
  const id = created.rows[0]!.id;
  const login = async (targetApp = app, password = PASSWORD) => {
    const client = new TestClient(targetApp);
    const response = await client.post('/api/v1/auth/login', { email, password });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return client;
  };
  return { id, email, login, client: await login() };
}

describe('preferências pessoais', () => {
  it('exige autenticação e CSRF nas alterações', async () => {
    const anonymous = new TestClient(app);
    assert.equal((await anonymous.get('/api/v1/auth/preferences')).status, 401);
    assert.equal((await anonymous.request('PUT', '/api/v1/auth/preferences', defaults)).status, 401);
    assert.equal((await anonymous.request('PATCH', '/api/v1/auth/preferences', { theme: 'dark' })).status, 401);
    assert.equal((await anonymous.post('/api/v1/auth/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status, 401);
    const { client } = await account();
    const noCsrf = new TestClient(app, { csrf: false });
    noCsrf.cookie = client.cookie;
    assert.equal((await noCsrf.request('PUT', '/api/v1/auth/preferences', defaults)).body.error.code, 'CSRF_HEADER_MISSING');
    assert.equal((await noCsrf.request('PATCH', '/api/v1/auth/preferences', { theme: 'dark' })).body.error.code, 'CSRF_HEADER_MISSING');
    assert.equal(
      (await noCsrf.post('/api/v1/auth/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).body.error.code,
      'CSRF_HEADER_MISSING',
    );
  });

  it('fornece os padrões também às contas anteriores à migração', async () => {
    const client = new TestClient(app);
    assert.equal((await client.post('/api/v1/auth/login', { email: 'diretor@exemplo.test', password: PASSWORD })).status, 200);
    assert.deepEqual((await client.get('/api/v1/auth/preferences')).body, defaults);
  });

  it('persiste por usuário, compartilha entre sessões e sobrevive à reconstrução da API', async () => {
    const owner = await account();
    const another = await account();
    const saved = { notificationsEnabled: false, notificationFrequency: '15m', theme: 'dark' };
    const response = await owner.client.request('PUT', '/api/v1/auth/preferences', saved);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, saved);
    assert.deepEqual((await (await owner.login()).get('/api/v1/auth/preferences')).body, saved);
    assert.deepEqual((await another.client.get('/api/v1/auth/preferences')).body, defaults);
    const restarted = await testApp.build();
    try {
      const client = new TestClient(restarted);
      client.cookie = owner.client.cookie;
      assert.deepEqual((await client.get('/api/v1/auth/preferences')).body, saved);
    } finally {
      await restarted.close();
    }
  });

  it('valida os valores, exige objeto completo e recusa a escolha de outro usuário', async () => {
    const { client } = await account();
    for (const body of [
      { ...defaults, notificationFrequency: 'daily' },
      { ...defaults, notificationsEnabled: 'false' },
      { ...defaults, theme: 'other' },
      { theme: 'dark' },
      { ...defaults, userId: 'outra-pessoa' },
    ]) {
      assert.equal((await client.request('PUT', '/api/v1/auth/preferences', body)).status, 400);
    }
    assert.deepEqual((await client.get('/api/v1/auth/preferences')).body, defaults);
    for (const notificationFrequency of ['immediate', '5m', '15m', '1h']) {
      assert.equal((await client.request('PUT', '/api/v1/auth/preferences', { ...defaults, notificationFrequency })).status, 200);
    }
    for (const theme of ['light', 'dark', 'system']) {
      assert.equal((await client.request('PUT', '/api/v1/auth/preferences', { ...defaults, theme })).status, 200);
    }
  });

  it('preserva alterações independentes de duas sessões ao atualizar preferências parcialmente', async () => {
    const owner = await account();
    const otherSession = await owner.login();
    const responses = await Promise.all([
      owner.client.request('PATCH', '/api/v1/auth/preferences', { theme: 'dark' }),
      otherSession.request('PATCH', '/api/v1/auth/preferences', { notificationsEnabled: false }),
    ]);
    assert.ok(responses.every((response) => response.status === 200));
    assert.ok(responses.every((response) => Object.keys(response.body).length === 3));
    assert.deepEqual((await owner.client.get('/api/v1/auth/preferences')).body, {
      notificationsEnabled: false,
      notificationFrequency: 'immediate',
      theme: 'dark',
    });
    const frequency = await otherSession.request('PATCH', '/api/v1/auth/preferences', { notificationFrequency: '1h' });
    assert.deepEqual(frequency.body, { notificationsEnabled: false, notificationFrequency: '1h', theme: 'dark' });
    const audits = await pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_events WHERE target_id = $1 AND action = 'auth.preferences_updated'`,
      [owner.id],
    );
    assert.deepEqual(audits.rows.map((audit) => Object.keys(audit.metadata).join(',')).sort(), [
      'notificationFrequency',
      'notificationsEnabled',
      'theme',
    ]);
  });

  it('recusa patches vazios, campos desconhecidos e valores inválidos sem mudar preferências', async () => {
    const { client } = await account();
    for (const body of [
      {},
      { userId: 'outra-pessoa' },
      { theme: 'dark', userId: 'outra-pessoa' },
      { notificationsEnabled: null },
      { notificationsEnabled: 'false' },
      { notificationFrequency: 'daily' },
      { theme: 'other' },
    ]) {
      assert.equal((await client.request('PATCH', '/api/v1/auth/preferences', body)).status, 400);
    }
    assert.deepEqual((await client.get('/api/v1/auth/preferences')).body, defaults);
  });
});

describe('troca da própria senha', () => {
  it('senha atual incorreta preserva a senha e todas as sessões', async () => {
    const owner = await account();
    const otherSession = await owner.login();
    const response = await owner.client.post('/api/v1/auth/password', { currentPassword: 'senha-incorreta', newPassword: NEW_PASSWORD });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_CURRENT_PASSWORD');
    assert.equal((await owner.client.get('/api/v1/auth/me')).status, 200);
    assert.equal((await otherSession.get('/api/v1/auth/me')).status, 200);
    await owner.login();
    const failedAudit = await pool.query(
      `SELECT metadata FROM audit_events WHERE action = 'auth.password_change_failed' AND target_id = $1`,
      [owner.id],
    );
    assert.deepEqual(failedAudit.rows, [{ metadata: { reason: 'bad_current_password' } }]);
  });

  it('recusa senha curta, longa, repetida, equivalente por normalização e campos de outra conta', async () => {
    const owner = await account();
    const equivalent = [...PASSWORD].map((character) => String.fromCharCode(character.charCodeAt(0) + 0xfee0)).join('');
    for (const newPassword of ['curta', 'x'.repeat(257), PASSWORD, equivalent]) {
      const response = await owner.client.post('/api/v1/auth/password', { currentPassword: PASSWORD, newPassword });
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, 'VALIDATION_FAILED');
    }
    assert.equal(
      (await owner.client.post('/api/v1/auth/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, userId: owner.id })).status,
      400,
    );
    await owner.login();
  });

  it('troca a senha, mantém a sessão atual, revoga as demais e isola outras contas', async () => {
    const owner = await account();
    const otherSession = await owner.login();
    const another = await account();
    const originalCookie = owner.client.cookie;
    const response = await owner.client.post('/api/v1/auth/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    assert.equal(response.status, 204);
    assert.equal(owner.client.cookie, originalCookie);
    assert.equal((await owner.client.get('/api/v1/auth/me')).status, 200);
    assert.equal((await otherSession.get('/api/v1/auth/me')).status, 401);
    assert.equal((await another.client.get('/api/v1/auth/me')).status, 200);
    const previousPassword = await new TestClient(app).post('/api/v1/auth/login', { email: owner.email, password: PASSWORD });
    assert.equal(previousPassword.status, 401);
    await owner.login(app, NEW_PASSWORD);
    const sessions = await pool.query<{ revoked_reason: string | null }>('SELECT revoked_reason FROM sessions WHERE user_id = $1', [
      owner.id,
    ]);
    assert.equal(sessions.rows.filter((session) => session.revoked_reason === 'password_changed').length, 1);
    const audits = await pool.query(`SELECT action, metadata FROM audit_events WHERE target_id = $1 AND action LIKE 'auth.password%'`, [
      owner.id,
    ]);
    assert.deepEqual(audits.rows, [{ action: 'auth.password_changed', metadata: { revokedSessions: 1 } }]);
    const serialized = JSON.stringify(audits.rows);
    for (const secret of [PASSWORD, NEW_PASSWORD, initialHash, originalCookie]) {
      assert.ok(secret && !serialized.includes(secret));
    }
  });

  it('limita tentativas sem encerrar a sessão', async () => {
    const limited = await testApp.build({
      rateLimits: {
        login: { limit: 100, windowMs: 60_000 },
        signup: { limit: 100, windowMs: 60_000 },
        password: { limit: 2, windowMs: 60_000 },
      },
    });
    try {
      const owner = await account();
      const client = await owner.login(limited);
      const body = { currentPassword: 'senha-incorreta', newPassword: NEW_PASSWORD };
      assert.equal((await client.post('/api/v1/auth/password', body)).status, 400);
      assert.equal((await client.post('/api/v1/auth/password', body)).status, 400);
      assert.equal((await client.post('/api/v1/auth/password', body)).body.error.code, 'RATE_LIMITED');
      assert.equal((await client.get('/api/v1/auth/me')).status, 200);
    } finally {
      await limited.close();
    }
  });

  it('duas sessões concorrentes não podem sobrescrever a senha uma da outra', async () => {
    const owner = await account();
    const otherSession = await owner.login();
    const responses = await Promise.all([
      owner.client.post('/api/v1/auth/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      otherSession.post('/api/v1/auth/password', { currentPassword: PASSWORD, newPassword: 'outra-nova-senha-789' }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [204, 401]);
    const winner = responses[0]!.status === 204 ? owner.client : otherSession;
    assert.equal((await winner.get('/api/v1/auth/me')).status, 200);
  });

  it('reconfere sessão e estado da conta mesmo com contexto autenticado anteriormente', async () => {
    const owner = await account();
    const identity = createIdentityService({ pool, config: testApp.config });
    const authentication = await identity.authenticate(owner.client.cookie!.slice('sid='.length));
    assert.ok(authentication);
    const ctx = { actor: authentication.actor, sessionId: authentication.sessionId, correlationId: 'stale-auth-test' };
    await pool.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'user' WHERE id = $1`, [ctx.sessionId]);
    await assert.rejects(identity.changeOwnPassword(ctx, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }), { status: 401 });
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [owner.id]);
    await assert.rejects(identity.changeOwnPassword(ctx, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }), { status: 401 });
    assert.equal((await pool.query('SELECT password_hash FROM users WHERE id = $1', [owner.id])).rows[0].password_hash, initialHash);
  });

  it('um login em andamento não emite sessão usando a senha anterior após uma troca concorrente', async () => {
    const owner = await account();
    const changedHash = await hashPassword(NEW_PASSWORD);
    const blocker = await pool.connect();
    let login: Promise<Awaited<ReturnType<TestClient['post']>>> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [owner.id]);
      login = new TestClient(app).post('/api/v1/auth/login', { email: owner.email, password: PASSWORD });
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const blocked = await pool.query(
          `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
             AND query LIKE 'SELECT %u.password_hash%FOR UPDATE'`,
        );
        if (blocked.rowCount) {
          waiting = true;
          break;
        }
        await setTimeout(10);
      }
      assert.ok(waiting, 'o login deve aguardar o lock da conta');
      await blocker.query('UPDATE users SET password_hash = $2 WHERE id = $1', [owner.id, changedHash]);
      await blocker.query('COMMIT');
      assert.equal((await login).status, 401);
      assert.equal((await pool.query('SELECT 1 FROM sessions WHERE user_id = $1', [owner.id])).rowCount, 1);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await login;
    }
  });
});
