import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import JSZip from 'jszip';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { processNextJob, type ProcessingDeps } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import { approvedTranscriptDraft } from '@tradutor/core/fixtures';
import type { MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, swornTranslator, TestClient, submitReady, allowTranslatorNotes } from './test/helpers.js';

/**
 * Plano de hierarquia (docs/planejamento-hierarquia): o trabalho de cada usuário é dele, cotas de numeração,
 * pedidos de alteração/anulação de número, painéis e auditoria da equipe. Cadastro sem mudança.
 */
const PASSWORD = 'senha-de-teste-123';
const fixture = (name: string) => readFile(new URL(`../../../packages/core/fixtures/historico-escolar/${name}`, import.meta.url));

let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
const ids: Record<string, string> = {};
const c: Record<string, TestClient> = {};
const year = new Date().getUTCFullYear();

const machine: MachineTranslator = {
  name: 'libretranslate',
  external: false,
  translate: async (texts) => texts.map((text) => `[EN] ${text}`),
  isAvailable: async () => true,
};
const processing = (): ProcessingDeps => ({ pool, storage, workerId: 'teste', machine: { libretranslate: machine } });

let translator: Awaited<ReturnType<typeof swornTranslator>>;

async function login(email: string) {
  const client = new TestClient(app);
  assert.equal((await client.post('/api/v1/auth/login', { email, password: PASSWORD })).status, 200);
  return client;
}

/** Envia uma variação do histórico fictício e processa; devolve o trabalho criado. */
async function sent(client: TestClient, seed: string) {
  await pool.query(`UPDATE translation_jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued'`);
  const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from(`\n%${seed}`)]);
  const batch = await client.request('POST', '/api/v1/batches', { files: [{ name: `${seed}.pdf`, size: pdf.length }] });
  assert.equal(batch.status, 201, JSON.stringify(batch.body));
  const documentId = batch.body.documents[0].id as string;
  assert.equal((await client.putContent(`/api/v1/documents/${documentId}/content`, pdf)).status, 200);
  const job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
  await processNextJob(processing());
  return { job, batchId: batch.body.batch.id as string };
}

/** Grava o rascunho de referência, marca como pronta e conclui; devolve a resposta da conclusão. */
async function finish(job: string, editor: TestClient, approver = c.lider!) {
  const detail = await editor.get(`/api/v1/translations/${job}`);
  const saved = await editor.request('PUT', `/api/v1/translations/${job}/draft`, {
    baseRevision: detail.body.draft.revision,
    draft: approvedTranscriptDraft,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const ready = await submitReady(editor, job);
  if (ready.status !== 200) return ready;
  return translator.conclude(approver, job);
}

async function docxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return (await zip.file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, '');
}

before(async () => {
  ({ app, pool, storage } = await createTestApp('hierarchy'));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  await allowTranslatorNotes(pool);
  c.director = await login('diretor@exemplo.test');
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
  c.lider = c.sup!;
  translator = await swornTranslator(c.sup!);
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('o trabalho de cada usuário é dele', () => {
  it('Usuário envia e é o responsável; colega da equipe vê, mas não edita', async () => {
    const { job } = await sent(c.ana!, 'ana1');
    ids.anaJob = job;
    const detail = await c.beto!.get(`/api/v1/translations/${job}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.translation.assignee.id, ids.ana);
    assert.equal(detail.body.translation.permissions.edit, false);
    const attempt = await c.beto!.request('PUT', `/api/v1/translations/${job}/draft`, { baseRevision: 1, draft: approvedTranscriptDraft });
    assert.equal(attempt.status, 403);
    assert.equal((await submitReady(c.beto!, job)).status, 403);
    assert.equal((await c.carla!.get(`/api/v1/translations/${job}`)).status, 404);
  });

  it('o Supervisor edita o trabalho da equipe; o Diretor não edita, só autoriza', async () => {
    assert.equal((await c.sup!.get(`/api/v1/translations/${ids.anaJob}`)).body.translation.permissions.edit, true);
    const director = await c.director!.get(`/api/v1/translations/${ids.anaJob}`);
    assert.equal(director.body.translation.permissions.edit, false);
    assert.equal(director.body.translation.permissions.reassign, true);
    const attempt = await c.director!.request('PUT', `/api/v1/translations/${ids.anaJob}/draft`, {
      baseRevision: 1,
      draft: approvedTranscriptDraft,
    });
    assert.equal(attempt.status, 403);
  });

  it('reatribuir: Supervisor e Diretor passam para alguém da equipe; Usuário não reatribui', async () => {
    assert.equal((await c.beto!.request('PUT', `/api/v1/translations/${ids.anaJob}/assignee`, { userId: ids.beto })).status, 403);
    assert.equal((await c.sup!.request('PUT', `/api/v1/translations/${ids.anaJob}/assignee`, { userId: ids.carla })).status, 400);
    const moved = await c.sup!.request('PUT', `/api/v1/translations/${ids.anaJob}/assignee`, { userId: ids.beto });
    assert.equal(moved.body.translation.assignee.id, ids.beto);
    const notice = (await c.beto!.get('/api/v1/notifications?kind=translation_assigned')).body.items[0];
    assert.equal(notice.translationId, ids.anaJob);
    await c.director!.request('PUT', `/api/v1/translations/${ids.anaJob}/assignee`, { userId: ids.ana });
    assert.equal((await c.ana!.get(`/api/v1/translations/${ids.anaJob}`)).body.translation.permissions.edit, true);
  });

  it('lote do Diretor fica sem responsável até alguém da equipe assumir', async () => {
    const { job, batchId } = await sent(c.director!, 'dir1');
    await c.director!.post(`/api/v1/batches/${batchId}/assign`, { teamId: ids.teamA });
    const before = await c.beto!.get(`/api/v1/translations/${job}`);
    assert.equal(before.body.translation.assignee, null);
    assert.equal(before.body.translation.permissions.claim, true);
    assert.equal((await submitReady(c.beto!, job)).status, 403);
    assert.deepEqual(
      (await c.beto!.get('/api/v1/translations?unclaimed=true')).body.items.map((item: { id: string }) => item.id),
      [job],
    );
    assert.equal((await c.beto!.post(`/api/v1/translations/${job}/claim`)).body.translation.assignee.id, ids.beto);
    assert.equal((await c.ana!.post(`/api/v1/translations/${job}/claim`)).status, 409);
    ids.betoJob = job;
  });

  it('"Meu workspace": filtro das próprias traduções', async () => {
    const mine = (await c.ana!.get('/api/v1/translations?mine=true')).body.items.map((item: { id: string }) => item.id);
    assert.deepEqual(mine, [ids.anaJob]);
  });
});

describe('cotas de numeração', () => {
  it('Supervisor define a cota dos Usuários da equipe (1 a 1000); limites de equipe e organização são do Diretor', async () => {
    const quota = (client: TestClient, body: Record<string, unknown>) =>
      client.request('PUT', '/api/v1/numbering/quotas', { year, ...body });
    assert.equal((await quota(c.sup!, { scope: 'user', userId: ids.ana, quota: 1001 })).status, 400);
    assert.equal((await quota(c.sup!, { scope: 'user', userId: ids.carla, quota: 5 })).status, 403);
    assert.equal((await quota(c.sup!, { scope: 'user', userId: ids.sup, quota: 5 })).status, 403);
    assert.equal((await quota(c.ana!, { scope: 'user', userId: ids.beto, quota: 5 })).status, 403);
    assert.equal((await quota(c.sup!, { scope: 'team', teamId: ids.teamA, quota: 50 })).status, 403);
    const set = await quota(c.sup!, { scope: 'user', userId: ids.ana, quota: 1 });
    assert.equal(set.status, 200);
    assert.equal(set.body.users.find((user: { id: string }) => user.id === ids.ana).quota, 1);
    assert.match((await c.ana!.get('/api/v1/notifications?kind=quota_changed')).body.items[0].title, /agora é 1/);
    assert.equal((await quota(c.director!, { scope: 'team', teamId: ids.teamA, quota: 50 })).status, 200);
    const mine = (await c.ana!.get('/api/v1/numbering')).body;
    assert.deepEqual(mine.mine, { quota: 1, used: 0 });
    assert.equal(mine.organization, null);
  });

  it('a conclusão consome a cota e avisa ao chegar a 100%; depois disso nada é concluído nem marcado como pronto', async () => {
    const done = await finish(ids.anaJob!, c.ana!);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const full = (await c.sup!.get('/api/v1/notifications?kind=quota_exhausted')).body.items[0];
    assert.match(full.title, /de ana esgotada \(1\/1\)/);
    const { job } = await sent(c.ana!, 'ana2');
    const blocked = await finish(job, c.ana!);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.details.reason, 'quota_exhausted');
    await c.sup!.request('PUT', '/api/v1/numbering/quotas', { year, scope: 'user', userId: ids.ana, quota: 10 });
    assert.equal((await finish(job, c.ana!)).status, 200);
    ids.anaJob2 = job;
  });

  it('limite da equipe também bloqueia', async () => {
    await c.director!.request('PUT', '/api/v1/numbering/quotas', { year, scope: 'team', teamId: ids.teamA, quota: 2 });
    const blocked = await finish(ids.betoJob!, c.beto!);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.details.scope, 'team');
    await c.director!.request('PUT', '/api/v1/numbering/quotas', { year, scope: 'team', teamId: ids.teamA, quota: null });
    assert.equal((await translator.conclude(c.sup!, ids.betoJob!)).status, 200);
  });
});

describe('pedidos de alteração e anulação de número', () => {
  it('o responsável pede; colega não pede; um pedido em aberto por vez', async () => {
    const body = { kind: 'change', reason: 'Folha registrada errada no livro.', sheet: '007' };
    assert.equal((await c.beto!.post(`/api/v1/translations/${ids.anaJob}/numbering-requests`, body)).status, 403);
    const created = await c.ana!.post(`/api/v1/translations/${ids.anaJob}/numbering-requests`, body);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.changeRequest = created.body.request.id;
    assert.equal((await c.ana!.post(`/api/v1/translations/${ids.anaJob}/numbering-requests`, body)).status, 409);
    assert.ok((await c.sup!.get('/api/v1/notifications?kind=numbering_request')).body.items.length > 0);
    assert.equal((await c.ana!.post(`/api/v1/numbering-requests/${ids.changeRequest}/decide`, { approve: true })).status, 403);
  });

  it('Supervisor autoriza: nova versão do DOCX com a folha certa; Diretor é avisado e pode reverter', async () => {
    const decided = await c.sup!.post(`/api/v1/numbering-requests/${ids.changeRequest}/decide`, { approve: true });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.request.status, 'approved');
    const detail = await c.ana!.get(`/api/v1/translations/${ids.anaJob}`);
    assert.match(detail.body.translation.number, /Folha 007$/);
    const final = await c.ana!.raw('GET', `/api/v1/translations/${ids.anaJob}/final`);
    assert.match(await docxText(final.rawPayload), /FOLHA Nº 007/);
    assert.ok((await c.director!.get('/api/v1/notifications?kind=numbering_decided')).body.items.length > 0);
    assert.equal((await c.sup!.post(`/api/v1/numbering-requests/${ids.changeRequest}/revert`)).status, 403);
    const reverted = await c.director!.post(`/api/v1/numbering-requests/${ids.changeRequest}/revert`);
    assert.equal(reverted.body.request.status, 'reverted');
    assert.match((await c.ana!.get(`/api/v1/translations/${ids.anaJob}`)).body.translation.number, /Folha 001$/);
  });

  it('o número não se repete no livro do mesmo tradutor', async () => {
    const taken = (await c.ana!.get(`/api/v1/translations/${ids.anaJob2}`)).body.translation.number.split(' – ')[0];
    const created = await c.ana!.post(`/api/v1/translations/${ids.anaJob}/numbering-requests`, {
      kind: 'change',
      reason: 'Número trocado por engano.',
      number: taken,
    });
    const decided = await c.sup!.post(`/api/v1/numbering-requests/${created.body.request.id}/decide`, { approve: true });
    assert.equal(decided.status, 409);
    await c.sup!.post(`/api/v1/numbering-requests/${created.body.request.id}/decide`, { approve: false, note: 'Número em uso.' });
  });

  it('anular: o número fica no livro, a tradução deixa de ser baixada e não volta para a cota', async () => {
    const created = await c.ana!.post(`/api/v1/translations/${ids.anaJob2}/numbering-requests`, {
      kind: 'annul',
      reason: 'Cliente desistiu; tradução cancelada.',
    });
    await c.director!.post(`/api/v1/numbering-requests/${created.body.request.id}/decide`, { approve: true });
    const detail = await c.ana!.get(`/api/v1/translations/${ids.anaJob2}`);
    assert.match(detail.body.translation.annulled.reason, /desistiu/);
    assert.equal(detail.body.translation.permissions.download, false);
    assert.equal((await c.ana!.raw('GET', `/api/v1/translations/${ids.anaJob2}/final`)).statusCode, 409);
    assert.equal((await c.ana!.get('/api/v1/numbering')).body.mine.used, 2);
    const requests = (await c.ana!.get('/api/v1/numbering-requests')).body.items;
    assert.equal(requests.length, 3);
    assert.equal((await c.carla!.get('/api/v1/numbering-requests')).body.items.length, 0);
  });
});

describe('painéis e auditoria da equipe', () => {
  it('painel da organização só para o Diretor, com tipos, idiomas, acertos e numeração', async () => {
    assert.equal((await c.sup!.get('/api/v1/dashboards/organization')).status, 403);
    const board = (await c.director!.get('/api/v1/dashboards/organization')).body;
    assert.equal(board.totals.approved, 3);
    assert.deepEqual(board.byPair, [{ source: 'pt', target: 'en', count: 3 }]);
    assert.equal(board.byType[0].type, 'SCHOOL TRANSCRIPT');
    assert.equal(board.byType[0].total, 3);
    assert.equal(board.numbering.organization.used, 3);
    assert.equal((await c.director!.get('/api/v1/dashboards/organization?from=2000-01-01&to=2000-01-31')).body.totals.approved, 0);
    assert.equal((await c.director!.get('/api/v1/dashboards/organization?from=2001-01-01&to=2000-01-31')).status, 400);
  });

  it('painel da equipe: Supervisor vê a própria, com entregas e tempos por pessoa; Usuário não vê', async () => {
    assert.equal((await c.ana!.get('/api/v1/dashboards/team')).status, 400);
    assert.equal((await c.ana!.get(`/api/v1/dashboards/team?teamId=${ids.teamA}`)).status, 403);
    assert.equal((await c.sup!.get(`/api/v1/dashboards/team?teamId=${ids.teamB}`)).status, 403);
    const board = (await c.sup!.get('/api/v1/dashboards/team')).body;
    assert.equal(board.team.name, 'Equipe A');
    const ana = board.users.find((user: { id: string }) => user.id === ids.ana);
    assert.deepEqual([ana.delivered, ana.quota, ana.used], [2, 10, 2]);
    assert.ok(board.documents.every((doc: { processingMinutes: number | null }) => doc.processingMinutes !== null));
    assert.equal((await c.director!.get(`/api/v1/dashboards/team?teamId=${ids.teamB}`)).status, 200);
  });

  it('Supervisor lê só a auditoria da própria equipe', async () => {
    const events = (await c.sup!.get('/api/v1/audit-events?limit=100')).body.items as Array<{ team: { id: string } | null }>;
    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.team?.id === ids.teamA));
    assert.equal((await c.ana!.get('/api/v1/audit-events')).status, 403);
  });
});
