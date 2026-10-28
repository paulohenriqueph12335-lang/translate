import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TEST_TOKENS, TestClient } from './test/helpers.js';

/**
 * Esqueci a senha (pedido do produto, 2026-10-28): o Diretor autoriza de vez com o Token do Diretor; o Líder libera
 * o Usuário da equipe por 24 horas com o Token do Líder, até 3 vezes seguidas; depois só o Diretor.
 */
const PASSWORD = 'senha-de-teste-123';
const HOUR = 3_600_000;
let clock = Date.now();

let app: FastifyInstance;
let pool: Pool;
const ids: Record<string, string> = {};
const c: Record<string, TestClient> = {};

async function login(email: string, password = PASSWORD) {
  const client = new TestClient(app);
  const response = await client.post('/api/v1/auth/login', { email, password });
  return { client, response };
}

async function requestFor(email: string, newPassword: string) {
  const response = await new TestClient(app).post('/api/v1/auth/password-reset', { email, newPassword });
  assert.equal(response.status, 202, JSON.stringify(response.body));
  return (
    await pool.query<{ id: string }>(
      `SELECT r.id FROM password_reset_requests r JOIN users u ON u.id = r.user_id
     WHERE u.email = $1 AND r.status = 'pending'`,
      [email],
    )
  ).rows[0]?.id;
}

before(async () => {
  ({ app, pool } = await createTestApp('recovery', {
    now: () => new Date(clock),
    rateLimits: {
      login: { limit: 10_000, windowMs: 60_000 },
      signup: { limit: 10_000, windowMs: 60_000 },
      password: { limit: 10_000, windowMs: 60_000 },
    },
  }));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  c.director = (await login('diretor@exemplo.test')).client;
  for (const name of ['lider', 'ana', 'carla']) {
    const email = `${name}@exemplo.test`;
    await new TestClient(app).post('/api/v1/auth/signup', { email, displayName: name, password: PASSWORD });
    ids[name] = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!.id;
    await c.director.post(`/api/v1/users/${ids[name]}/approve`);
  }
  ids.teamA = (await c.director.post('/api/v1/teams', { name: 'Equipe A' })).body.team.id;
  ids.teamB = (await c.director.post('/api/v1/teams', { name: 'Equipe B' })).body.team.id;
  await c.director.post(`/api/v1/teams/${ids.teamA}/members`, { userId: ids.lider, role: 'leader' });
  await c.director.post(`/api/v1/teams/${ids.teamA}/members`, { userId: ids.ana, role: 'operator' });
  await c.director.post(`/api/v1/teams/${ids.teamB}/members`, { userId: ids.carla, role: 'operator' });
  c.lider = (await login('lider@exemplo.test')).client;
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('esqueci a senha', () => {
  it('e-mail desconhecido recebe a mesma resposta e não cria pedido', async () => {
    const response = await new TestClient(app).post('/api/v1/auth/password-reset', {
      email: 'ninguem@exemplo.test',
      newPassword: 'nova-senha-1234',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, { status: 'pending' });
    assert.equal((await pool.query('SELECT 1 FROM password_reset_requests')).rowCount, 0);
  });

  it('o pedido avisa o Diretor e o Líder da equipe; o Líder de outra equipe não vê', async () => {
    ids.request = (await requestFor('ana@exemplo.test', 'nova-senha-ana-1'))!;
    assert.ok(ids.request);
    const leaderList = await c.lider!.get('/api/v1/password-resets');
    assert.equal(leaderList.status, 200);
    assert.equal(leaderList.body.items.length, 1);
    assert.equal(leaderList.body.items[0].authorizeAs, 'leader');
    assert.equal(leaderList.body.items[0].user.email, 'ana@exemplo.test');
    assert.equal((await c.director!.get('/api/v1/password-resets')).body.items[0].authorizeAs, 'director');
    const notified = await pool.query<{ user_id: string }>(`SELECT user_id FROM notifications WHERE kind = 'password_reset_requested'`);
    assert.deepEqual(
      notified.rows.map((row) => row.user_id).sort(),
      [ids.lider, (await c.director!.get('/api/v1/auth/me')).body.user.id].sort(),
    );
    // Usuário comum não vê pedidos.
    const ana = (await login('ana@exemplo.test')).client;
    assert.equal((await ana.get('/api/v1/password-resets')).status, 403);
  });

  it('o Líder precisa do Token do Líder; o do Diretor não serve para ele', async () => {
    const wrong = await c.lider!.post(`/api/v1/password-resets/${ids.request}/approve`, { token: 'LID-ERRADO' });
    assert.equal(wrong.status, 403);
    assert.match(wrong.body.error.message, /Token do Líder incorreto/);
    assert.equal((await c.lider!.post(`/api/v1/password-resets/${ids.request}/approve`, { token: TEST_TOKENS.director })).status, 403);
    const audit = await pool.query(`SELECT 1 FROM audit_events WHERE action = 'password_reset.token_rejected'`);
    assert.equal(audit.rowCount, 2);
  });

  it('liberado pelo Líder, a pessoa entra com a senha nova por 24 horas; depois é barrada', async () => {
    const ana = (await login('ana@exemplo.test')).client;
    const approved = await c.lider!.post(`/api/v1/password-resets/${ids.request}/approve`, { token: TEST_TOKENS.leader.toLowerCase() });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status, 'approved');
    assert.equal(new Date(approved.body.accessUntil).getTime(), clock + 24 * HOUR);
    // A troca derruba as sessões antigas e a senha antiga.
    assert.equal((await ana.get('/api/v1/auth/me')).status, 401);
    assert.equal((await login('ana@exemplo.test')).response.status, 401);
    const fresh = await login('ana@exemplo.test', 'nova-senha-ana-1');
    assert.equal(fresh.response.status, 200);
    assert.ok(fresh.response.body.user.accessExpiresAt);

    clock += 25 * HOUR;
    assert.equal((await fresh.client.get('/api/v1/auth/me')).status, 401);
    const barred = await login('ana@exemplo.test', 'nova-senha-ana-1');
    assert.equal(barred.response.status, 403);
    assert.equal(barred.response.body.error.code, 'ACCESS_EXPIRED');
  });

  it('o Líder libera no máximo 3 vezes seguidas; depois só o Diretor', async () => {
    for (const round of [2, 3]) {
      c.lider = (await login('lider@exemplo.test')).client;
      const id = await requestFor('ana@exemplo.test', `nova-senha-ana-${round}`);
      assert.equal((await c.lider!.post(`/api/v1/password-resets/${id}/approve`, { token: TEST_TOKENS.leader })).status, 200);
      assert.equal((await login('ana@exemplo.test', `nova-senha-ana-${round}`)).response.status, 200);
      clock += 25 * HOUR;
    }
    const barred = await login('ana@exemplo.test', 'nova-senha-ana-3');
    assert.match(barred.response.body.error.message, /só o Diretor/);
    const id = await requestFor('ana@exemplo.test', 'nova-senha-ana-4');
    c.lider = (await login('lider@exemplo.test')).client;
    c.director = (await login('diretor@exemplo.test')).client;
    assert.equal((await c.lider!.get('/api/v1/password-resets')).body.items[0].authorizeAs, null);
    const refused = await c.lider!.post(`/api/v1/password-resets/${id}/approve`, { token: TEST_TOKENS.leader });
    assert.equal(refused.status, 409);
    assert.equal((await c.director!.post(`/api/v1/password-resets/${id}/approve`, { token: TEST_TOKENS.leader })).status, 403);
    const approved = await c.director!.post(`/api/v1/password-resets/${id}/approve`, { token: TEST_TOKENS.director });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.accessUntil, null);
    clock += 30 * 24 * HOUR;
    const ok = await login('ana@exemplo.test', 'nova-senha-ana-4');
    assert.equal(ok.response.status, 200);
    assert.equal(ok.response.body.user.accessExpiresAt, null);
    const row = (await pool.query('SELECT leader_unlocks, access_expires_at FROM users WHERE id = $1', [ids.ana])).rows[0];
    assert.equal(row.leader_unlocks, 0);
    assert.equal(row.access_expires_at, null);
  });

  it('o Líder não decide pedidos de outro Líder nem de outra equipe; recusar não troca a senha', async () => {
    c.lider = (await login('lider@exemplo.test')).client;
    c.director = (await login('diretor@exemplo.test')).client;
    const carla = await requestFor('carla@exemplo.test', 'nova-senha-carla');
    assert.equal((await c.lider!.post(`/api/v1/password-resets/${carla}/approve`, { token: TEST_TOKENS.leader })).status, 404);
    const own = await requestFor('lider@exemplo.test', 'nova-senha-lider');
    const visible = await c.lider!.get('/api/v1/password-resets');
    assert.equal(visible.body.items.length, 0, JSON.stringify(visible.body));
    assert.equal((await c.lider!.post(`/api/v1/password-resets/${own}/approve`, { token: TEST_TOKENS.leader })).status, 404);
    assert.equal((await c.director!.post(`/api/v1/password-resets/${carla}/reject`)).status, 200);
    assert.equal((await login('carla@exemplo.test')).response.status, 200);
    assert.equal((await login('carla@exemplo.test', 'nova-senha-carla')).response.status, 401);
    assert.equal((await c.director!.post(`/api/v1/password-resets/${carla}/reject`)).status, 409);
  });

  it('com o Token do Diretor, a própria tela troca a senha na hora, inclusive do Diretor', async () => {
    const wrong = await new TestClient(app).post('/api/v1/auth/password-reset', {
      email: 'diretor@exemplo.test',
      newPassword: 'senha-nova-diretor',
      directorToken: TEST_TOKENS.leader,
    });
    assert.equal(wrong.status, 403);
    const changed = await new TestClient(app).post('/api/v1/auth/password-reset', {
      email: 'diretor@exemplo.test',
      newPassword: 'senha-nova-diretor',
      directorToken: TEST_TOKENS.director,
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.deepEqual(changed.body, { status: 'changed' });
    assert.equal((await c.director!.get('/api/v1/auth/me')).status, 401);
    assert.equal((await login('diretor@exemplo.test', 'senha-nova-diretor')).response.status, 200);
    const unknown = await new TestClient(app).post('/api/v1/auth/password-reset', {
      email: 'ninguem@exemplo.test',
      newPassword: 'senha-nova-diretor',
      directorToken: TEST_TOKENS.director,
    });
    assert.equal(unknown.status, 404);
  });
});
