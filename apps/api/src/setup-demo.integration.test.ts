import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createTestApp, TestClient } from './test/helpers.js';

/** Contas de demonstração: Diretor, Líder e Usuário de teste criados juntos e excluídos juntos (ADR-004). */
const PASSWORD = 'senha-de-teste-123';
const codes: string[] = [];

let app: FastifyInstance;
let pool: Pool;

before(async () => {
  ({ app, pool } = await createTestApp('setupdemo', { announceSetupCode: (value) => codes.push(value) }));
});

after(async () => {
  await app.close();
  await pool.end();
});

const login = async (email: string) => {
  const client = new TestClient(app);
  const response = await client.post('/api/v1/auth/login', { email, password: PASSWORD });
  return { client, response };
};

describe('contas de demonstração', () => {
  it('cria Diretor, Líder e Usuário de teste com a mesma senha, na Equipe de Teste', async () => {
    const director = new TestClient(app);
    const created = await director.post('/api/v1/setup', {
      code: codes.at(-1),
      email: 'diretor.teste@exemplo.com',
      displayName: 'Diretor de Teste',
      password: PASSWORD,
      demoAccounts: true,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    // Contas de demonstração são sempre de teste, mesmo sem marcar.
    assert.equal(created.body.user.testAccount, true);

    const leader = await login('lider.teste@exemplo.com');
    assert.equal(leader.response.status, 200, JSON.stringify(leader.response.body));
    assert.deepEqual(
      leader.response.body.memberships.map((m: { teamName: string; role: string }) => [m.teamName, m.role]),
      [['Equipe de Teste', 'leader']],
    );
    const operator = await login('usuario.teste@exemplo.com');
    assert.deepEqual(
      operator.response.body.memberships.map((m: { role: string }) => m.role),
      ['operator'],
    );
    assert.equal(operator.response.body.user.testAccount, true);

    const list = await director.get('/api/v1/test-accounts');
    assert.deepEqual(
      (list.body.items as Array<{ role: string; email: string }>).map((item) => [item.role, item.email]),
      [
        ['Diretor', 'diretor.teste@exemplo.com'],
        ['Líder', 'lider.teste@exemplo.com'],
        ['Usuário', 'usuario.teste@exemplo.com'],
      ],
    );
    assert.equal((await leader.client.get('/api/v1/test-accounts')).status, 403);
    assert.equal((await leader.client.post('/api/v1/test-accounts/delete-all')).status, 403);
  });

  it('um botão exclui todas, a equipe de teste sai e a configuração inicial volta', async () => {
    const { client } = await login('diretor.teste@exemplo.com');
    const { client: leader } = await login('lider.teste@exemplo.com');
    const removed = await client.post('/api/v1/test-accounts/delete-all');
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(removed.body, { removed: 3, setupNeeded: true });
    assert.equal((await client.get('/api/v1/auth/me')).status, 401);
    assert.equal((await leader.get('/api/v1/auth/me')).status, 401);
    for (const email of ['diretor.teste@exemplo.com', 'lider.teste@exemplo.com', 'usuario.teste@exemplo.com']) {
      assert.equal((await login(email)).response.status, 401);
    }
    assert.equal((await pool.query(`SELECT 1 FROM teams WHERE name = 'Equipe de Teste'`)).rowCount, 0);
    assert.deepEqual((await new TestClient(app).get('/api/v1/setup')).body, { needed: true });

    // Dá para recriar tudo com os mesmos e-mails.
    const again = await new TestClient(app).post('/api/v1/setup', {
      code: codes.at(-1),
      email: 'diretor.teste@exemplo.com',
      displayName: 'Diretor de Teste',
      password: PASSWORD,
      demoAccounts: true,
    });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.equal((await login('usuario.teste@exemplo.com')).response.status, 200);
  });
});
