import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { processNextJob, type ProcessingDeps } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import type { MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

/**
 * Varredura de bugs: tradução presa a quem perdeu o acesso, Diretor assumindo pela reatribuição e sessões paradas
 * listadas como abertas.
 */
const PASSWORD = 'senha-de-teste-123';
const fixture = (name: string) => readFile(new URL(`../../../packages/core/fixtures/historico-escolar/${name}`, import.meta.url));

let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
const ids: Record<string, string> = {};
const c: Record<string, TestClient> = {};

const machine: MachineTranslator = {
  name: 'libretranslate',
  external: false,
  translate: async (texts) => texts.map((text) => `[EN] ${text}`),
  isAvailable: async () => true,
};
const processing = (): ProcessingDeps => ({ pool, storage, workerId: 'teste', machine: { libretranslate: machine } });

async function login(email: string) {
  const client = new TestClient(app);
  assert.equal((await client.post('/api/v1/auth/login', { email, password: PASSWORD })).status, 200);
  return client;
}

async function sent(client: TestClient, seed: string) {
  const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from(`\n%${seed}`)]);
  const batch = await client.request('POST', '/api/v1/batches', { files: [{ name: `${seed}.pdf`, size: pdf.length }] });
  assert.equal(batch.status, 201, JSON.stringify(batch.body));
  const documentId = batch.body.documents[0].id as string;
  assert.equal((await client.putContent(`/api/v1/documents/${documentId}/content`, pdf)).status, 200);
  const job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
  await processNextJob(processing());
  return { job, batchId: batch.body.batch.id as string };
}

const assignee = async (job: string) =>
  (await pool.query<{ assignee_id: string | null }>('SELECT assignee_id FROM translation_jobs WHERE id = $1', [job])).rows[0]!.assignee_id;

const released = async (job: string) =>
  (
    await pool.query<{ reason: string }>(
      `SELECT metadata->>'reason' AS reason FROM audit_events WHERE action = 'translation.released' AND target_id = $1`,
      [job],
    )
  ).rows.map((row) => row.reason);

before(async () => {
  ({ app, pool, storage } = await createTestApp('accessrelease'));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  c.director = await login('diretor@exemplo.test');
  ids.director = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = 'diretor@exemplo.test'`)).rows[0]!.id;
  for (const name of ['sup', 'ana', 'beto', 'carla']) {
    const email = `${name}@exemplo.test`;
    await new TestClient(app).post('/api/v1/auth/signup', { email, displayName: name, password: PASSWORD });
    ids[name] = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!.id;
    await c.director.post(`/api/v1/users/${ids[name]}/approve`);
  }
  ids.teamA = (await c.director.post('/api/v1/teams', { name: 'Equipe A' })).body.team.id;
  ids.teamB = (await c.director.post('/api/v1/teams', { name: 'Equipe B' })).body.team.id;
  await c.director.post(`/api/v1/teams/${ids.teamA}/members`, { userId: ids.sup, role: 'leader' });
  await c.director.post(`/api/v1/teams/${ids.teamA}/members`, { userId: ids.ana, role: 'operator' });
  await c.director.post(`/api/v1/teams/${ids.teamA}/members`, { userId: ids.beto, role: 'operator' });
  await c.director.post(`/api/v1/teams/${ids.teamB}/members`, { userId: ids.carla, role: 'operator' });
  for (const name of ['sup', 'ana', 'beto', 'carla']) c[name] = await login(`${name}@exemplo.test`);
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('tradução não fica presa a quem perdeu o acesso', () => {
  it('quem sai da equipe solta as traduções em aberto, que voltam a "Disponíveis para assumir"', async () => {
    const { job } = await sent(c.ana!, 'saida');
    assert.equal(await assignee(job), ids.ana);
    assert.equal((await c.sup!.request('DELETE', `/api/v1/teams/${ids.teamA}/members/${ids.ana}`)).status, 204);
    assert.equal(await assignee(job), null);
    assert.deepEqual(await released(job), ['member_removed']);
    const open = (await c.beto!.get('/api/v1/translations?unclaimed=true')).body.items.map((item: { id: string }) => item.id);
    assert.ok(open.includes(job));
    assert.equal((await c.beto!.post(`/api/v1/translations/${job}/claim`)).body.translation.assignee.id, ids.beto);
    await c.director!.post(`/api/v1/teams/${ids.teamA}/members`, { userId: ids.ana, role: 'operator' });
  });

  it('lote direcionado a outra equipe: o responsável da equipe anterior é liberado', async () => {
    const { job, batchId } = await sent(c.beto!, 'redirecionado');
    assert.equal(await assignee(job), ids.beto);
    const moved = await c.director!.post(`/api/v1/batches/${batchId}/assign`, { teamId: ids.teamB });
    assert.ok([200, 204].includes(moved.status), JSON.stringify(moved.body));
    assert.equal(await assignee(job), null);
    assert.deepEqual(await released(job), ['batch_reassigned']);
    assert.equal((await c.carla!.get(`/api/v1/translations/${job}`)).body.translation.permissions.claim, true);
  });

  it('conta suspensa libera as traduções em aberto; as concluídas não mudam', async () => {
    const { job } = await sent(c.ana!, 'suspensa');
    await pool.query(`UPDATE translation_jobs SET assignee_id = $1 WHERE id = $2`, [ids.ana, job]);
    assert.equal((await c.director!.post(`/api/v1/users/${ids.ana}/suspend`)).status, 200);
    assert.equal(await assignee(job), null);
    assert.deepEqual(await released(job), ['user_suspended']);
    await c.director!.post(`/api/v1/users/${ids.ana}/reactivate`);
  });

  it('quem continua com acesso não perde nada', async () => {
    const { job } = await sent(c.beto!, 'fica');
    await c.director!.request('DELETE', `/api/v1/teams/${ids.teamB}/members/${ids.carla}`);
    assert.equal(await assignee(job), ids.beto);
    assert.deepEqual(await released(job), []);
  });
});

describe('o Diretor assume pela reatribuição', () => {
  it('o Diretor passa a tradução da equipe para si e passa a poder editar; o Supervisor não passa para o Diretor', async () => {
    const { job } = await sent(c.beto!, 'diretor-assume');
    const refused = await c.sup!.request('PUT', `/api/v1/translations/${job}/assignee`, { userId: ids.director });
    assert.equal(refused.status, 400);
    const taken = await c.director!.request('PUT', `/api/v1/translations/${job}/assignee`, { userId: ids.director });
    assert.equal(taken.status, 200, JSON.stringify(taken.body));
    assert.equal(taken.body.translation.assignee.id, ids.director);
    assert.equal((await c.director!.get(`/api/v1/translations/${job}`)).body.translation.permissions.edit, true);
  });
});

describe('sessões abertas', () => {
  it('sessão parada além do tempo de inatividade não aparece mais', async () => {
    const other = await login('beto@exemplo.test');
    const before = (await c.beto!.get('/api/v1/auth/sessions')).body.items.length;
    const mine = (await other.get('/api/v1/auth/sessions')).body.items.find((item: { current: boolean }) => item.current).id;
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '1 day' WHERE id = $1`, [mine]);
    const after = (await c.beto!.get('/api/v1/auth/sessions')).body.items;
    assert.equal(after.length, before - 1);
    assert.ok(!after.some((item: { id: string }) => item.id === mine));
  });
});
