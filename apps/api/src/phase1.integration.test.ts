import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { bootstrapDirector, BootstrapRefused } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

/**
 * Critérios de aceite da Fase 1 (docs/roadmap.md): conta pública sem acesso antes de aprovação,
 * Diretor administra, Líder não ultrapassa o escopo, isolamento negativo e revogação de sessão.
 */
const PASSWORD = 'senha-de-teste-123';

let app: FastifyInstance;
let pool: Pool;
let build: Awaited<ReturnType<typeof createTestApp>>['build'];
const ids: Record<string, string> = {};

const client = (options?: { csrf?: boolean }) => new TestClient(app, options);

async function signup(email: string, displayName = email.split('@')[0]!) {
  const response = await client().post('/api/v1/auth/signup', { email, displayName, password: PASSWORD });
  assert.equal(response.status, 202);
}

async function login(email: string, password = PASSWORD) {
  const c = client();
  const response = await c.post('/api/v1/auth/login', { email, password });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return c;
}

async function userId(email: string) {
  const result = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  return result.rows[0]!.id;
}

let director: TestClient;

before(async () => {
  ({ app, pool, build } = await createTestApp('phase1'));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  director = await login('diretor@exemplo.test');
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('bootstrap do Diretor', () => {
  it('recusa um segundo bootstrap', async () => {
    await assert.rejects(
      bootstrapDirector(pool, { email: 'outro@exemplo.test', displayName: 'Outro', password: PASSWORD }),
      BootstrapRefused,
    );
  });

  it('registra auditoria do bootstrap', async () => {
    const result = await pool.query(`SELECT 1 FROM audit_events WHERE action = 'director.bootstrapped'`);
    assert.equal(result.rowCount, 1);
  });
});

describe('cadastro público e aprovação', () => {
  it('cadastro fica pendente e não autentica', async () => {
    await signup('pendente@exemplo.test');
    const c = client();
    const response = await c.post('/api/v1/auth/login', { email: 'pendente@exemplo.test', password: PASSWORD });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'ACCOUNT_PENDING');
    assert.equal(c.cookie, undefined);
    assert.equal((await c.get('/api/v1/teams')).status, 401);
  });

  it('não aceita campos privilegiados no cadastro', async () => {
    const response = await client().post('/api/v1/auth/signup', {
      email: 'esperto@exemplo.test',
      displayName: 'Esperto',
      password: PASSWORD,
      orgRole: 'director',
      status: 'active',
    });
    assert.equal(response.status, 400);
    assert.equal((await pool.query(`SELECT 1 FROM users WHERE email = 'esperto@exemplo.test'`)).rowCount, 0);
  });

  it('cadastro duplicado responde igual e não altera a conta', async () => {
    const response = await client().post('/api/v1/auth/signup', {
      email: 'PENDENTE@exemplo.test',
      displayName: 'X',
      password: 'outra-senha-longa',
    });
    assert.equal(response.status, 202);
    const users = await pool.query(`SELECT display_name FROM users WHERE email = 'pendente@exemplo.test'`);
    assert.equal(users.rows[0].display_name, 'pendente');
  });

  it('senha errada e e-mail inexistente têm a mesma resposta', async () => {
    const wrong = await client().post('/api/v1/auth/login', { email: 'diretor@exemplo.test', password: 'senha-incorreta-000' });
    const unknown = await client().post('/api/v1/auth/login', { email: 'ninguem@exemplo.test', password: 'senha-incorreta-000' });
    assert.equal(wrong.status, 401);
    assert.deepEqual([wrong.body.error.code, unknown.status, unknown.body.error.code], ['INVALID_CREDENTIALS', 401, 'INVALID_CREDENTIALS']);
  });

  it('somente o Diretor lista e aprova pendentes', async () => {
    const pending = await director.get('/api/v1/users?status=pending');
    assert.equal(pending.status, 200);
    const target = pending.body.items.find((user: { email: string }) => user.email === 'pendente@exemplo.test');
    assert.ok(target);

    const approved = await director.post(`/api/v1/users/${target.id}/approve`);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.user.status, 'active');
    assert.equal((await director.post(`/api/v1/users/${target.id}/approve`)).status, 409);

    const me = await login('pendente@exemplo.test');
    assert.equal((await me.get('/api/v1/auth/me')).body.user.status, 'active');
    assert.equal((await me.get('/api/v1/users')).status, 403);
  });

  it('rejeição impede login', async () => {
    await signup('rejeitado@exemplo.test');
    const id = await userId('rejeitado@exemplo.test');
    assert.equal((await director.post(`/api/v1/users/${id}/reject`)).status, 200);
    const response = await client().post('/api/v1/auth/login', { email: 'rejeitado@exemplo.test', password: PASSWORD });
    assert.equal(response.body.error.code, 'ACCOUNT_UNAVAILABLE');
  });
});

describe('equipes e hierarquia', () => {
  let leaderA: TestClient;
  let operatorA: TestClient;
  let leaderB: TestClient;

  before(async () => {
    for (const email of [
      'lider-a@exemplo.test',
      'operador-a@exemplo.test',
      'lider-b@exemplo.test',
      'livre@exemplo.test',
      'outro-lider-a@exemplo.test',
    ]) {
      await signup(email);
      ids[email] = await userId(email);
      assert.equal((await director.post(`/api/v1/users/${ids[email]}/approve`)).status, 200);
    }
    const teamA = await director.post('/api/v1/teams', { name: 'Equipe A' });
    const teamB = await director.post('/api/v1/teams', { name: 'Equipe B' });
    assert.equal(teamA.status, 201);
    ids.teamA = teamA.body.team.id;
    ids.teamB = teamB.body.team.id;
    const add = (team: string, email: string, role: string) => director.post(`/api/v1/teams/${team}/members`, { email, role });
    assert.equal((await add(ids.teamA!, 'lider-a@exemplo.test', 'leader')).status, 201);
    assert.equal((await add(ids.teamA!, 'outro-lider-a@exemplo.test', 'leader')).status, 201);
    assert.equal((await add(ids.teamA!, 'operador-a@exemplo.test', 'operator')).status, 201);
    assert.equal((await add(ids.teamB!, 'lider-b@exemplo.test', 'leader')).status, 201);
    leaderA = await login('lider-a@exemplo.test');
    operatorA = await login('operador-a@exemplo.test');
    leaderB = await login('lider-b@exemplo.test');
  });

  it('nomes de equipe são únicos', async () => {
    assert.equal((await director.post('/api/v1/teams', { name: 'equipe a' })).status, 409);
  });

  it('cada pessoa vê apenas as próprias equipes', async () => {
    const teams = await leaderA.get('/api/v1/teams');
    assert.deepEqual(
      teams.body.items.map((team: { name: string; myRole: string }) => [team.name, team.myRole]),
      [['Equipe A', 'leader']],
    );
    assert.equal((await director.get('/api/v1/teams')).body.items.length, 2);
  });

  it('equipe de outra pessoa responde 404 (sem revelar existência)', async () => {
    assert.equal((await leaderA.get(`/api/v1/teams/${ids.teamB}`)).status, 404);
    assert.equal((await leaderA.get(`/api/v1/teams/${ids.teamB}/members`)).status, 404);
    assert.equal((await leaderA.post(`/api/v1/teams/${ids.teamB}/members`, { email: 'livre@exemplo.test', role: 'operator' })).status, 404);
    assert.equal((await leaderB.request('DELETE', `/api/v1/teams/${ids.teamA}/members/${ids['operador-a@exemplo.test']}`)).status, 404);
  });

  it('operador vê a equipe mas não administra', async () => {
    assert.equal((await operatorA.get(`/api/v1/teams/${ids.teamA}`)).status, 200);
    assert.equal((await operatorA.get(`/api/v1/teams/${ids.teamA}/members`)).status, 403);
    assert.equal(
      (await operatorA.post(`/api/v1/teams/${ids.teamA}/members`, { email: 'livre@exemplo.test', role: 'operator' })).status,
      403,
    );
    assert.equal((await operatorA.post('/api/v1/teams', { name: 'Equipe do Operador' })).status, 403);
  });

  it('líder adiciona operador na própria equipe, mas não líderes', async () => {
    assert.equal((await leaderA.post(`/api/v1/teams/${ids.teamA}/members`, { email: 'livre@exemplo.test', role: 'leader' })).status, 403);
    const added = await leaderA.post(`/api/v1/teams/${ids.teamA}/members`, { email: 'livre@exemplo.test', role: 'operator' });
    assert.equal(added.status, 201);
    assert.equal((await leaderA.post(`/api/v1/teams/${ids.teamA}/members`, { email: 'livre@exemplo.test', role: 'operator' })).status, 409);
  });

  it('líder não adiciona contas pendentes nem Diretores', async () => {
    await signup('ainda-pendente@exemplo.test');
    const pending = await leaderA.post(`/api/v1/teams/${ids.teamA}/members`, { email: 'ainda-pendente@exemplo.test', role: 'operator' });
    assert.equal(pending.status, 404);
    const directorTarget = await leaderA.post(`/api/v1/teams/${ids.teamA}/members`, { email: 'diretor@exemplo.test', role: 'operator' });
    assert.equal(directorTarget.status, 403);
  });

  it('líder não remove outro líder, não muda funções e não se promove', async () => {
    const otherLeader = ids['outro-lider-a@exemplo.test'];
    assert.equal((await leaderA.request('DELETE', `/api/v1/teams/${ids.teamA}/members/${otherLeader}`)).status, 403);
    assert.equal(
      (await leaderA.request('PATCH', `/api/v1/teams/${ids.teamA}/members/${ids['operador-a@exemplo.test']}`, { role: 'leader' })).status,
      403,
    );
    assert.equal((await leaderA.request('PATCH', `/api/v1/teams/${ids.teamA}`, { name: 'Renomeada' })).status, 403);
    assert.equal(
      (await leaderA.request('PUT', `/api/v1/users/${ids['lider-a@exemplo.test']}/org-role`, { orgRole: 'director' })).status,
      403,
    );
    assert.equal((await leaderA.post(`/api/v1/users/${ids['operador-a@exemplo.test']}/suspend`)).status, 403);
    // Supervisor vê só a auditoria das equipes que supervisiona (plano de hierarquia); Operador não vê.
    const audit = await leaderA.get('/api/v1/audit-events');
    assert.equal(audit.status, 200);
    assert.ok(audit.body.items.every((event: { team: { id: string } | null }) => event.team?.id === ids.teamA));
    assert.equal((await operatorA.get('/api/v1/audit-events')).status, 403);
  });

  it('líder remove operador da própria equipe', async () => {
    const response = await leaderA.request('DELETE', `/api/v1/teams/${ids.teamA}/members/${ids['livre@exemplo.test']}`);
    assert.equal(response.status, 204);
  });

  it('Diretor altera função e o efeito vale na próxima requisição', async () => {
    const changed = await director.request('PATCH', `/api/v1/teams/${ids.teamA}/members/${ids['operador-a@exemplo.test']}`, {
      role: 'leader',
    });
    assert.equal(changed.status, 200);
    assert.equal((await operatorA.get(`/api/v1/teams/${ids.teamA}/members`)).status, 200);
    await director.request('PATCH', `/api/v1/teams/${ids.teamA}/members/${ids['operador-a@exemplo.test']}`, { role: 'operator' });
    assert.equal((await operatorA.get(`/api/v1/teams/${ids.teamA}/members`)).status, 403);
  });

  it('Diretor não se suspende nem remove o próprio papel', async () => {
    const self = await userId('diretor@exemplo.test');
    assert.equal((await director.post(`/api/v1/users/${self}/suspend`)).status, 403);
    assert.equal((await director.request('PUT', `/api/v1/users/${self}/org-role`, { orgRole: 'member' })).status, 403);
  });
});

describe('sessões', () => {
  it('logout revoga a sessão no servidor', async () => {
    const c = await login('lider-b@exemplo.test');
    const stolenCookie = c.cookie;
    assert.equal((await c.post('/api/v1/auth/logout')).status, 204);
    const replay = new TestClient(app);
    replay.cookie = stolenCookie;
    assert.equal((await replay.get('/api/v1/auth/me')).status, 401);
  });

  it('pessoa revoga outra sessão própria, mas não a de terceiros', async () => {
    const first = await login('lider-b@exemplo.test');
    const second = await login('lider-b@exemplo.test');
    const sessions = await second.get('/api/v1/auth/sessions');
    const other = sessions.body.items.find((session: { current: boolean }) => !session.current);
    assert.ok(other);
    const intruder = await login('lider-a@exemplo.test');
    assert.equal((await intruder.request('DELETE', `/api/v1/auth/sessions/${other.id}`)).status, 404);
    assert.equal((await second.request('DELETE', `/api/v1/auth/sessions/${other.id}`)).status, 204);
    assert.equal((await first.get('/api/v1/auth/me')).status, 401);
    assert.equal((await second.get('/api/v1/auth/me')).status, 200);
  });

  it('Diretor revoga todas as sessões de um usuário', async () => {
    const c = await login('operador-a@exemplo.test');
    const id = ids['operador-a@exemplo.test']!;
    const revoked = await director.post(`/api/v1/users/${id}/sessions/revoke`);
    assert.equal(revoked.status, 200);
    assert.ok(revoked.body.revoked >= 1);
    assert.equal((await c.get('/api/v1/auth/me')).status, 401);
  });

  it('suspensão invalida sessões imediatamente e reativação permite novo login', async () => {
    const c = await login('lider-b@exemplo.test');
    const id = ids['lider-b@exemplo.test']!;
    assert.equal((await director.post(`/api/v1/users/${id}/suspend`)).status, 200);
    assert.equal((await c.get('/api/v1/teams')).status, 401);
    const blocked = await client().post('/api/v1/auth/login', { email: 'lider-b@exemplo.test', password: PASSWORD });
    assert.equal(blocked.body.error.code, 'ACCOUNT_UNAVAILABLE');
    assert.equal((await director.post(`/api/v1/users/${id}/reactivate`)).status, 200);
    await login('lider-b@exemplo.test');
  });

  it('sessão expira por inatividade', async () => {
    let now = new Date();
    const clockApp = await build({ now: () => now });
    try {
      const c = new TestClient(clockApp);
      assert.equal((await c.post('/api/v1/auth/login', { email: 'lider-a@exemplo.test', password: PASSWORD })).status, 200);
      assert.equal((await c.get('/api/v1/auth/me')).status, 200);
      now = new Date(now.getTime() + 121 * 60_000);
      assert.equal((await c.get('/api/v1/auth/me')).status, 401);
    } finally {
      await clockApp.close();
    }
  });

  it('cookie de sessão é HttpOnly e SameSite=Strict', async () => {
    const response = await client().post('/api/v1/auth/login', { email: 'lider-a@exemplo.test', password: PASSWORD });
    const cookie = response.raw.cookies.find((item) => item.name === 'sid');
    assert.equal(cookie?.httpOnly, true);
    assert.equal(cookie?.sameSite, 'Strict');
  });
});

describe('proteções transversais', () => {
  it('métodos que alteram estado exigem cabeçalho CSRF', async () => {
    const noCsrf = client({ csrf: false });
    noCsrf.cookie = director.cookie;
    const response = await noCsrf.post('/api/v1/teams', { name: 'Equipe Forjada' });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'CSRF_HEADER_MISSING');
  });

  it('erros têm envelope com correlation ID', async () => {
    const response = await client().get('/api/v1/teams');
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'UNAUTHENTICATED');
    assert.equal(response.body.error.correlationId, response.raw.headers['x-correlation-id']);
  });

  it('login é limitado por taxa', async () => {
    const limited = await build({ rateLimits: { login: { limit: 2, windowMs: 60_000 }, signup: { limit: 2, windowMs: 60_000 } } });
    try {
      const c = new TestClient(limited);
      const body = { email: 'ninguem@exemplo.test', password: 'senha-incorreta-000' };
      assert.equal((await c.post('/api/v1/auth/login', body)).status, 401);
      assert.equal((await c.post('/api/v1/auth/login', body)).status, 401);
      assert.equal((await c.post('/api/v1/auth/login', body)).status, 429);
    } finally {
      await limited.close();
    }
  });
});

describe('auditoria', () => {
  it('registra ações administrativas sem dados sensíveis', async () => {
    const response = await director.get('/api/v1/audit-events?limit=100');
    assert.equal(response.status, 200);
    const actions = new Set(response.body.items.map((event: { action: string }) => event.action));
    for (const action of [
      'auth.login',
      'auth.login_failed',
      'user.approved',
      'user.suspended',
      'team.created',
      'team.member_added',
      'team.member_removed',
      'session.revoked',
    ]) {
      assert.ok(actions.has(action), `falta ${action}`);
    }
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(PASSWORD));
  });

  it('paginação por cursor não repete eventos', async () => {
    const first = await director.get('/api/v1/audit-events?limit=5');
    const second = await director.get(`/api/v1/audit-events?limit=5&cursor=${first.body.nextCursor}`);
    const firstIds = new Set(first.body.items.map((event: { id: string }) => event.id));
    assert.ok(second.body.items.every((event: { id: string }) => !firstIds.has(event.id)));
  });

  it('eventos de auditoria não podem ser alterados nem removidos', async () => {
    await assert.rejects(pool.query(`UPDATE audit_events SET action = 'x.y'`), /somente inserção/);
    await assert.rejects(pool.query('DELETE FROM audit_events'), /somente inserção/);
  });
});

describe('candidatos para equipes', () => {
  let leaderA: TestClient;
  let operatorA: TestClient;
  const names = (response: { body: { items: Array<{ email: string }> } }) => response.body.items.map((item) => item.email).sort();
  const candidates = (c: TestClient, query = '') => c.get(`/api/v1/teams/${ids.teamA}/candidates${query}`);

  before(async () => {
    leaderA = await login('lider-a@exemplo.test');
    operatorA = await login('operador-a@exemplo.test');
  });

  it('Diretor vê pessoas ativas fora da equipe (sem Diretores), com as equipes de cada uma', async () => {
    const response = await candidates(director);
    assert.equal(response.status, 200);
    assert.deepEqual(names(response), ['lider-b@exemplo.test', 'livre@exemplo.test', 'pendente@exemplo.test']);
    const liderB = response.body.items.find((item: { email: string }) => item.email === 'lider-b@exemplo.test');
    assert.deepEqual([liderB.teamCount, liderB.teams], [1, ['Equipe B']]);
  });

  it('Líder não vê Diretores nem as equipes das pessoas', async () => {
    const response = await candidates(leaderA);
    assert.equal(response.status, 200);
    assert.deepEqual(names(response), ['lider-b@exemplo.test', 'livre@exemplo.test', 'pendente@exemplo.test']);
    assert.ok(response.body.items.every((item: object) => !('teams' in item)));
  });

  it('filtra por busca e por pertencer a equipes', async () => {
    assert.deepEqual(names(await candidates(leaderA, '?q=LIVRE')), ['livre@exemplo.test']);
    assert.deepEqual(names(await candidates(leaderA, '?assignment=unassigned')), ['livre@exemplo.test', 'pendente@exemplo.test']);
    assert.deepEqual(names(await candidates(leaderA, '?assignment=assigned')), ['lider-b@exemplo.test']);
    assert.deepEqual(names(await candidates(leaderA, '?q=%25')), []);
    assert.equal((await candidates(leaderA, '?assignment=x')).status, 400);
  });

  it('pagina sem repetir pessoas', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof candidates>> = await candidates(director, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.body.items.map((item: { email: string }) => item.email));
      cursor = page.body.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 3);
    assert.equal(new Set(seen).size, 3);
  });

  it('Operador e Líder de outra equipe não listam candidatos', async () => {
    assert.equal((await candidates(operatorA)).status, 403);
    assert.equal((await leaderA.get(`/api/v1/teams/${ids.teamB}/candidates`)).status, 404);
  });

  it('adição pela lista usa o ID, com as mesmas regras', async () => {
    const add = (userId: string) => leaderA.post(`/api/v1/teams/${ids.teamA}/members`, { userId, role: 'operator' });
    assert.equal((await add(await userId('diretor@exemplo.test'))).status, 403);
    assert.equal((await add(await userId('ainda-pendente@exemplo.test'))).status, 404);
    assert.equal((await add(ids['livre@exemplo.test']!)).status, 201);
    assert.ok(!names(await candidates(leaderA)).includes('livre@exemplo.test'));
    const both = await leaderA.post(`/api/v1/teams/${ids.teamA}/members`, {
      userId: ids['livre@exemplo.test'],
      email: 'livre@exemplo.test',
      role: 'operator',
    });
    assert.equal(both.status, 400);
  });
});

describe('busca de candidatos', () => {
  it('ignora acentos no nome', async () => {
    await signup('fabio@exemplo.test', 'Fábio Nunes');
    const id = await userId('fabio@exemplo.test');
    assert.equal((await director.post(`/api/v1/users/${id}/approve`)).status, 200);
    const response = await director.get(`/api/v1/teams/${ids.teamA}/candidates?q=fabio%20nu`);
    assert.deepEqual(
      response.body.items.map((item: { email: string }) => item.email),
      ['fabio@exemplo.test'],
    );
  });
});

describe('ninguém se atribui cargos', () => {
  it('Diretor não entra em equipe, nem por e-mail nem por ID', async () => {
    const self = await userId('diretor@exemplo.test');
    const byId = await director.post(`/api/v1/teams/${ids.teamA}/members`, { userId: self, role: 'operator' });
    assert.equal(byId.status, 403);
    assert.match(byId.body.error.message, /próprio cargo/);
    const byEmail = await director.post(`/api/v1/teams/${ids.teamA}/members`, { email: 'diretor@exemplo.test', role: 'leader' });
    assert.equal(byEmail.status, 403);
  });

  it('Diretor não muda a própria função nem se remove de equipe', async () => {
    const self = await userId('diretor@exemplo.test');
    assert.equal((await director.request('PATCH', `/api/v1/teams/${ids.teamA}/members/${self}`, { role: 'operator' })).status, 403);
    assert.equal((await director.request('DELETE', `/api/v1/teams/${ids.teamA}/members/${self}`)).status, 403);
  });

  it('Líder não muda a própria função', async () => {
    const leaderA = await login('lider-a@exemplo.test');
    const self = ids['lider-a@exemplo.test']!;
    assert.equal((await leaderA.request('PATCH', `/api/v1/teams/${ids.teamA}/members/${self}`, { role: 'operator' })).status, 403);
    assert.equal((await leaderA.request('DELETE', `/api/v1/teams/${ids.teamA}/members/${self}`)).status, 403);
  });

  it('promoção a Diretor remove as associações de equipe, com auditoria', async () => {
    const target = ids['outro-lider-a@exemplo.test']!;
    const promoted = await director.request('PUT', `/api/v1/users/${target}/org-role`, { orgRole: 'director' });
    assert.equal(promoted.status, 200);
    const memberships = await pool.query('SELECT 1 FROM team_memberships WHERE user_id = $1', [target]);
    assert.equal(memberships.rowCount, 0);
    const audit = await pool.query(
      `SELECT 1 FROM audit_events WHERE action = 'team.member_removed' AND target_id = $1 AND metadata->>'reason' = 'promoted_to_director'`,
      [target],
    );
    assert.equal(audit.rowCount, 1);
    const asMember = await director.post(`/api/v1/teams/${ids.teamA}/members`, { userId: target, role: 'leader' });
    assert.equal(asMember.status, 403);
    assert.match(asMember.body.error.message, /Diretores/);
  });

  it('o banco recusa Diretor em equipe mesmo fora da API', async () => {
    const target = ids['outro-lider-a@exemplo.test']!;
    const creator = await userId('diretor@exemplo.test');
    await assert.rejects(
      pool.query(`INSERT INTO team_memberships (team_id, user_id, role, created_by) VALUES ($1, $2, 'operator', $3)`, [
        ids.teamA,
        target,
        creator,
      ]),
      /Diretor não pode ocupar cargo de equipe/,
    );
    const operator = ids['operador-a@exemplo.test']!;
    await assert.rejects(pool.query(`UPDATE users SET org_role = 'director' WHERE id = $1`, [operator]), /Remova as associações/);
  });
});
