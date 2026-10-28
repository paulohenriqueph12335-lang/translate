import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createTestApp, TEST_TOKENS, TestClient } from './test/helpers.js';

/** Configuração inicial com o Token do Diretor e conta de teste que pode ser excluída (ADR-004, revisões de 2026-10-22 e 2026-10-28). */
const PASSWORD = 'senha-de-teste-123';
const code = () => TEST_TOKENS.director;

let app: FastifyInstance;
let pool: Pool;

before(async () => {
  ({ app, pool } = await createTestApp('setup'));
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('configuração inicial', () => {
  it('sem Diretor, a tela de configuração aparece', async () => {
    assert.deepEqual((await new TestClient(app).get('/api/v1/setup')).body, { needed: true });
  });

  it('token errado é recusado, inclusive o do Líder; dados inválidos também', async () => {
    const client = new TestClient(app);
    const wrong = await client.post('/api/v1/setup', {
      code: 'AAAA-AAAA',
      email: 'teste@exemplo.test',
      displayName: 'Teste',
      password: PASSWORD,
    });
    assert.equal(wrong.status, 403);
    assert.match(wrong.body.error.message, /Token do Diretor incorreto/);
    const leader = await client.post('/api/v1/setup', {
      code: TEST_TOKENS.leader,
      email: 'teste@exemplo.test',
      displayName: 'Teste',
      password: PASSWORD,
    });
    assert.equal(leader.status, 403);
    const short = await client.post('/api/v1/setup', {
      code: code(),
      email: 'teste@exemplo.test',
      displayName: 'Teste',
      password: 'curta',
    });
    assert.equal(short.status, 400);
    assert.deepEqual((await client.get('/api/v1/setup')).body, { needed: true });
  });

  it('com o token, cria o Diretor de teste e já entra', async () => {
    const client = new TestClient(app);
    // O token vale com minúsculas e sem hífens, como a pessoa digitar.
    const created = await client.post('/api/v1/setup', {
      code: code().replaceAll('-', '').toLowerCase(),
      email: 'teste@exemplo.test',
      displayName: 'Diretor de Teste',
      password: PASSWORD,
      testAccount: true,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.user.orgRole, 'director');
    assert.equal(created.body.user.testAccount, true);
    const me = await client.get('/api/v1/auth/me');
    assert.equal(me.body.user.email, 'teste@exemplo.test');
    assert.deepEqual((await client.get('/api/v1/setup')).body, { needed: false });

    // Com Diretor, ninguém mais usa a configuração inicial, nem com o token.
    const again = await new TestClient(app).post('/api/v1/setup', {
      code: code(),
      email: 'outro@exemplo.test',
      displayName: 'Outro',
      password: PASSWORD,
    });
    assert.equal(again.status, 409);
  });

  it('só a própria pessoa ou um Diretor exclui; conta definitiva não pode ser excluída por aqui', async () => {
    const director = new TestClient(app);
    await director.post('/api/v1/auth/login', { email: 'teste@exemplo.test', password: PASSWORD });
    await new TestClient(app).post('/api/v1/auth/signup', { email: 'membro@exemplo.test', displayName: 'Membro', password: PASSWORD });
    const memberId = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = 'membro@exemplo.test'`)).rows[0]!.id;
    await director.post(`/api/v1/users/${memberId}/approve`);
    const member = new TestClient(app);
    await member.post('/api/v1/auth/login', { email: 'membro@exemplo.test', password: PASSWORD });
    const directorId = (await director.get('/api/v1/auth/me')).body.user.id as string;

    assert.equal((await member.post(`/api/v1/users/${directorId}/delete-test-account`)).status, 403);
    // O membro não é conta de teste: nem o Diretor exclui por aqui.
    assert.equal((await director.post(`/api/v1/users/${memberId}/delete-test-account`)).status, 403);
  });

  it('excluída, a conta some, o e-mail fica livre, a sessão cai e a configuração inicial volta', async () => {
    const client = new TestClient(app);
    await client.post('/api/v1/auth/login', { email: 'teste@exemplo.test', password: PASSWORD });
    const id = (await client.get('/api/v1/auth/me')).body.user.id as string;

    const removed = await client.post(`/api/v1/users/${id}/delete-test-account`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(removed.body, { setupNeeded: true });
    assert.equal((await client.get('/api/v1/auth/me')).status, 401);
    assert.equal((await new TestClient(app).post('/api/v1/auth/login', { email: 'teste@exemplo.test', password: PASSWORD })).status, 401);

    const row = (await pool.query(`SELECT email, display_name, org_role, status FROM users WHERE id = $1`, [id])).rows[0];
    assert.match(row.email, /@conta-de-teste\.invalid$/);
    assert.equal(row.display_name, 'Conta de teste excluída');
    assert.equal(row.org_role, 'member');
    const audit = await pool.query(`SELECT action FROM audit_events WHERE target_id = $1 ORDER BY id`, [id]);
    assert.ok(audit.rows.some((event: { action: string }) => event.action === 'user.test_account_deleted'));

    // A conta definitiva pode usar o mesmo e-mail.
    const definitive = await new TestClient(app).post('/api/v1/setup', {
      code: code(),
      email: 'teste@exemplo.test',
      displayName: 'Diretor Definitivo',
      password: PASSWORD,
    });
    assert.equal(definitive.status, 201, JSON.stringify(definitive.body));
    assert.equal(definitive.body.user.testAccount, false);
    const users = await new TestClient(app).request('GET', '/api/v1/users');
    assert.equal(users.status, 401);
  });
});
