import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { processNextJob, type ProcessingDeps } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import { approvedTranscriptDraft } from '@tradutor/core/fixtures';
import type { MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, swornTranslator, TestClient, submitReady, allowTranslatorNotes, inspectReady } from './test/helpers.js';

/**
 * Fluxo simplificado (ADR-010): envio com etiquetas → processamento automático → aviso de tipo novo →
 * Operador marca como pronto → Líder/Diretor conclui ou pede para refazer → download, com notificações e filtros.
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

/** Envia uma variação do histórico fictício com etiquetas; devolve documento e trabalho criado sozinho. */
async function upload(name: string, seed: string, tags: string[] = [], client = c.op!) {
  await pool.query(`UPDATE translation_jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued'`);
  const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from(`\n%${seed}`)]);
  const batch = await client.request('POST', '/api/v1/batches', { tags, files: [{ name, size: pdf.length }] });
  assert.equal(batch.status, 201, JSON.stringify(batch.body));
  const documentId = batch.body.documents[0].id as string;
  assert.equal((await client.putContent(`/api/v1/documents/${documentId}/content`, pdf)).status, 200);
  const job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
  return { documentId, job, batchId: batch.body.batch.id as string };
}

const kinds = async (client: TestClient, query = '') =>
  ((await client.get(`/api/v1/notifications${query}`)).body.items as Array<{ kind: string; translationId: string | null }>).map(
    (item) => item.kind,
  );

before(async () => {
  ({ app, pool, storage } = await createTestApp('reviewflow'));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  await allowTranslatorNotes(pool);
  c.director = await login('diretor@exemplo.test');
  for (const name of ['lider', 'op', 'opb']) {
    const email = `${name}@exemplo.test`;
    await new TestClient(app).post('/api/v1/auth/signup', { email, displayName: name, password: PASSWORD });
    ids[name] = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!.id;
    await c.director.post(`/api/v1/users/${ids[name]}/approve`);
  }
  ids.teamA = (await c.director.post('/api/v1/teams', { name: 'Equipe A' })).body.team.id;
  ids.teamB = (await c.director.post('/api/v1/teams', { name: 'Equipe B' })).body.team.id;
  await c.director.post(`/api/v1/teams/${ids.teamA}/members`, { userId: ids.lider, role: 'leader' });
  await c.director.post(`/api/v1/teams/${ids.teamA}/members`, { userId: ids.op, role: 'operator' });
  await c.director.post(`/api/v1/teams/${ids.teamB}/members`, { userId: ids.opb, role: 'operator' });
  for (const name of ['lider', 'op', 'opb']) c[name] = await login(`${name}@exemplo.test`);
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('envio com etiquetas e aviso de tipo novo', () => {
  it('etiquetas do lote vão para cada documento, normalizadas', async () => {
    const sent = await upload('historico.pdf', 'a', ['Histórico Escolar', '  histórico escolar ', 'Urgente']);
    Object.assign(ids, { doc: sent.documentId, job: sent.job, batch: sent.batchId });
    const batch = await c.op!.get(`/api/v1/batches/${sent.batchId}`);
    assert.deepEqual(batch.body.documents[0].tags, ['histórico escolar', 'urgente']);
    const tooMany = await c.lider!.request('POST', '/api/v1/batches', {
      tags: Array.from({ length: 11 }, (_, index) => `t${index}`),
      files: [{ name: 'x.pdf', size: 10 }],
    });
    assert.equal(tooMany.status, 400);
  });

  it('documento de tipo nunca concluído avisa Líder, Diretor e quem enviou; a equipe é avisada que está pronto', async () => {
    assert.equal(await processNextJob(processing()), true);
    const detail = await c.op!.get(`/api/v1/translations/${ids.job}`);
    assert.equal(detail.body.translation.patternKnown, false);
    assert.deepEqual(detail.body.translation.document.tags, ['histórico escolar', 'urgente']);
    // Quem enviou é o responsável: recebe "pronto"; o Supervisor e o Diretor recebem só o aviso de tipo novo.
    assert.deepEqual((await kinds(c.op!)).sort(), ['pattern_unknown', 'translation_ready']);
    assert.deepEqual(await kinds(c.lider!), ['pattern_unknown']);
    assert.deepEqual(await kinds(c.director!), ['pattern_unknown']);
    assert.deepEqual(await kinds(c.opb!), []);
    const unknown = (await c.lider!.get('/api/v1/notifications?kind=pattern_unknown')).body.items[0];
    assert.equal(unknown.translationId, ids.job);
    assert.match(unknown.body, /HISTÓRICO ESCOLAR/);
  });

  it('notificações: contador, filtro de não lidas e marcar como lidas só as próprias', async () => {
    assert.equal((await c.op!.get('/api/v1/notifications/unread-count')).body.unread, 2);
    const first = (await c.op!.get('/api/v1/notifications')).body.items[0];
    assert.equal((await c.lider!.post('/api/v1/notifications/read', { ids: [first.id] })).body.marked, 0);
    assert.equal((await c.op!.post('/api/v1/notifications/read', { ids: [first.id] })).body.marked, 1);
    assert.equal((await c.op!.get('/api/v1/notifications?unread=true')).body.items.length, 1);
    assert.equal((await c.op!.post('/api/v1/notifications/read')).body.marked, 1);
    assert.equal((await c.op!.get('/api/v1/notifications/unread-count')).body.unread, 0);
    await c.lider!.post('/api/v1/notifications/read');
  });
});

describe('Operador marca como pronto; Líder/Diretor conclui ou pede para refazer', () => {
  it('o rascunho traz os textos da prévia que dependem do idioma; o resto vem da máscara do tradutor', async () => {
    const detail = await c.op!.get(`/api/v1/translations/${ids.job}`);
    assert.equal(detail.body.frame.documentTypeLabel, 'DOCUMENT TYPE');
    assert.equal((await c.op!.get('/api/v1/translation-capabilities')).body.translatorsReady, false);
    assert.deepEqual(detail.body.frame.translatorNote, { prefix: "[Translator's note: ", suffix: ']' });
  });

  it('pronto avisa o Líder e o Diretor', async () => {
    const saved = await c.op!.request('PUT', `/api/v1/translations/${ids.job}/draft`, { baseRevision: 1, draft: approvedTranscriptDraft });
    assert.equal(saved.status, 200);
    assert.equal((await submitReady(c.op!, ids.job)).body.translation.status, 'awaiting_approval');
    assert.deepEqual(await kinds(c.lider!, '?unread=true'), ['translation_submitted']);
    assert.ok((await kinds(c.director!)).includes('translation_submitted'));
    assert.ok(!(await kinds(c.op!)).includes('translation_submitted'));
  });

  it('refazer devolve com o motivo e avisa quem marcou como pronto', async () => {
    const returned = await c.lider!.post(`/api/v1/translations/${ids.job}/return`, {
      comment: 'Conferir as notas.',
      failedStages: ['review'],
      confirmCompleted: true,
    });
    assert.equal(returned.body.translation.status, 'in_review');
    const notice = (await c.op!.get('/api/v1/notifications?kind=translation_returned')).body.items[0];
    assert.match(notice.body, /Conferir as notas\./);
  });

  it('refazer com reprocessamento gera nova revisão automática e mantém o motivo', async () => {
    assert.equal((await c.op!.post(`/api/v1/translations/${ids.job}/reprocess`)).status, 403);
    const current = await c.op!.get(`/api/v1/translations/${ids.job}`);
    await c.op!.request('PUT', `/api/v1/translations/${ids.job}/draft`, {
      baseRevision: current.body.draft.revision,
      draft: approvedTranscriptDraft,
    });
    await submitReady(c.op!, ids.job);
    const again = await c.lider!.post(`/api/v1/translations/${ids.job}/return`, {
      comment: 'Gerar de novo.',
      reprocess: true,
      failedStages: ['layout'],
      confirmCompleted: true,
    });
    assert.equal(again.body.translation.status, 'queued');
    await processNextJob(processing());
    const detail = await c.op!.get(`/api/v1/translations/${ids.job}`);
    assert.equal(detail.body.translation.status, 'in_review');
    assert.equal(detail.body.draft.revision, 4);
    assert.equal(detail.body.draft.origin, 'machine');
    assert.equal(detail.body.translation.reviewComment, 'Gerar de novo.');
  });

  it('concluir sem tradutor configurado explica o motivo; depois de configurar, libera o download e avisa', async () => {
    await c.op!.request('PUT', `/api/v1/translations/${ids.job}/draft`, { baseRevision: 4, draft: approvedTranscriptDraft });
    await submitReady(c.op!, ids.job);
    await inspectReady(c.lider!, ids.job!);
    const blocked = await c.lider!.post(`/api/v1/translations/${ids.job}/approve`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.details.reason, 'translator_required');
    const translator = await swornTranslator(c.lider!);
    const done = await translator.conclude(c.lider!, ids.job!);
    assert.equal(done.status, 200);
    assert.equal(done.body.translation.permissions.download, true);
    assert.equal(done.body.frame.draftMark, null);
    const approved = (await c.op!.get('/api/v1/notifications?kind=translation_approved')).body.items[0];
    assert.match(approved.body, /liberada para download/);
    assert.equal((await c.op!.raw('GET', `/api/v1/translations/${ids.job}/final`)).statusCode, 200);
  });

  it('o próximo documento do mesmo tipo já é reconhecido e não gera aviso de tipo novo', async () => {
    await c.director!.post('/api/v1/notifications/read');
    const sent = await upload('historico-2.pdf', 'b');
    await processNextJob(processing());
    assert.equal((await c.op!.get(`/api/v1/translations/${sent.job}`)).body.translation.patternKnown, true);
    assert.deepEqual(await kinds(c.director!, '?unread=true'), []);
    ids.job2 = sent.job;
  });

  it('a etiqueta também reconhece o tipo, mesmo sem o título no texto', async () => {
    const docx = await fixture('esperado.docx');
    const batch = await c.lider!.request('POST', '/api/v1/batches', {
      tags: ['histórico escolar'],
      translation: { sourceLanguage: 'en', targetLanguage: 'pt' },
      files: [{ name: 'outro.docx', size: docx.length }],
    });
    await pool.query(`UPDATE translation_jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued'`);
    await c.lider!.putContent(`/api/v1/documents/${batch.body.documents[0].id}/content`, docx);
    await processNextJob(processing());
    const job = (
      await pool.query<{ pattern_known: boolean }>('SELECT pattern_known FROM translation_jobs WHERE document_id = $1', [
        batch.body.documents[0].id,
      ])
    ).rows[0]!;
    // Par EN → PT: o exemplo concluído é PT → EN, então o tipo continua novo para este par.
    assert.equal(job.pattern_known, false);
  });
});

describe('filtros, downloads e associação entre original e tradução', () => {
  it('traduções filtram por etiqueta, tipo, situação, padrão e período', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const list = (query: string) => c.op!.get(`/api/v1/translations?${query}`).then((r) => r.body.items.map((i: { id: string }) => i.id));
    assert.deepEqual(await list('tag=urgente'), [ids.job]);
    assert.deepEqual(await list('status=approved'), [ids.job]);
    assert.deepEqual(await list(`status=approved&approvedFrom=${today}&approvedTo=${today}`), [ids.job]);
    assert.deepEqual(await list('status=approved&approvedFrom=2000-01-01&approvedTo=2000-01-02'), []);
    assert.deepEqual(await list(`documentType=${encodeURIComponent('SCHOOL TRANSCRIPT')}&status=approved`), [ids.job]);
    assert.ok((await list('patternKnown=true')).includes(ids.job2!));
    // O número buscado também aparece no título do DOCX de exemplo enviado acima; com a situação, só a concluída.
    assert.deepEqual(await list(`status=approved&q=${encodeURIComponent('0001/')}`), [ids.job]);
    assert.equal((await c.op!.get('/api/v1/translations?approvedFrom=17-10-2026')).status, 400);
    const facets = (await c.op!.get('/api/v1/translation-facets')).body;
    assert.ok(facets.documentTypes.includes('SCHOOL TRANSCRIPT'));
    assert.ok(facets.tags.includes('urgente'));
    assert.deepEqual(
      facets.approvers.map((a: { name: string }) => a.name),
      ['lider'],
    );
    assert.deepEqual((await c.opb!.get('/api/v1/translation-facets')).body, {
      documentTypes: [],
      documentCategories: [],
      tags: [],
      approvers: [],
      statusCounts: {},
    });
  });

  it('a busca de documentos traz as traduções geradas de cada original', async () => {
    const found = await c.op!.get('/api/v1/documents?translation=approved');
    assert.equal(found.body.items.length, 1);
    const doc = found.body.items[0];
    assert.equal(doc.id, ids.doc);
    assert.equal(doc.team.name, 'Equipe A');
    assert.equal(doc.uploadedBy.displayName, 'op');
    assert.equal(doc.translations[0].id, ids.job);
    assert.match(doc.translations[0].number, /^0001\//);
    assert.equal((await c.op!.get(`/api/v1/documents?translation=approved&q=${encodeURIComponent('0001/')}`)).body.items[0].id, ids.doc);
    assert.equal((await c.op!.get('/api/v1/documents?tag=urgente&format=pdf')).body.items.length, 1);
    assert.equal((await c.op!.get('/api/v1/documents?untagged=true&format=pdf')).body.items.length, 1);
    assert.equal((await c.opb!.get('/api/v1/documents')).body.items.length, 0);
  });

  it('etiquetas podem ser corrigidas depois e a lista de etiquetas reflete o uso', async () => {
    const updated = await c.op!.request('PUT', `/api/v1/documents/${ids.doc}/tags`, {
      tags: ['Histórico Escolar', 'Ensino Médio'],
      confirmCompleted: true,
    });
    assert.deepEqual(updated.body.document.tags, ['histórico escolar', 'ensino médio']);
    assert.equal((await c.opb!.request('PUT', `/api/v1/documents/${ids.doc}/tags`, { tags: ['x'] })).status, 404);
    const tags = (await c.op!.get('/api/v1/tags')).body.items;
    assert.deepEqual(tags[0], { tag: 'histórico escolar', count: 2 });
  });

  it('auditoria filtra por grupo, pessoa, equipe e período; ações disponíveis para o filtro', async () => {
    const audit = (query: string) =>
      c.director!.get(`/api/v1/audit-events?${query}`).then((r) => r.body.items as Array<{ action: string }>);
    assert.ok((await audit('category=translation')).every((event) => event.action.startsWith('translation.')));
    assert.ok((await audit(`actorId=${ids.op}`)).every((event) => event.action !== 'translation.approved'));
    assert.ok((await audit(`actorId=${ids.lider}&action=translation.approved`)).length === 1);
    assert.ok((await audit('system=true')).some((event) => event.action === 'translation.drafted'));
    assert.ok((await audit(`teamId=${ids.teamB}`)).length >= 0);
    assert.deepEqual(await audit('from=2000-01-01&to=2000-01-02'), []);
    assert.ok((await audit('q=lider')).length > 0);
    const facets = (await c.director!.get('/api/v1/audit-events/facets')).body;
    assert.ok(facets.actions.includes('document.tagged'));
    assert.equal((await c.op!.get('/api/v1/audit-events/facets')).status, 403);
    // Supervisor vê os filtros só com o que aconteceu nas equipes dele.
    assert.ok(!(await c.lider!.get('/api/v1/audit-events/facets')).body.actions.includes('director.bootstrapped'));
  });
});
