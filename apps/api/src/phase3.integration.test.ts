import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import JSZip from 'jszip';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { processNextJob, type ProcessingDeps } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import { approvedTranscriptDraft } from '@tradutor/core/fixtures';
import { MachineTranslationFailed, type MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, swornTranslator, TestClient, submitReady, allowTranslatorNotes } from './test/helpers.js';

/**
 * Fase 3 (ADR-007): rascunho → revisão → aprovação humana → DOCX juramentado.
 * Nenhuma tradução é aprovada sem a ação de Líder ou Diretor; o provedor gratuito é simulado aqui (ADR-008, ADR-010).
 */
const PASSWORD = 'senha-de-teste-123';
const fixture = (name: string) => readFile(new URL(`../../../packages/core/fixtures/historico-escolar/${name}`, import.meta.url));

let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
const ids: Record<string, string> = {};
const c: Record<string, TestClient> = {};
const processing = (machine?: MachineTranslator): ProcessingDeps => ({
  pool,
  storage,
  workerId: 'teste',
  ...(machine ? { machine: { libretranslate: machine } } : {}),
});

/** Provedor gratuito simulado: devolve "[EN] trecho" e registra as chamadas. */
const fakeMachine = (() => {
  const calls: string[][] = [];
  const translator: MachineTranslator = {
    name: 'libretranslate',
    external: false,
    async translate(texts) {
      calls.push(texts);
      return texts.map((text) => `[EN] ${text}`);
    },
    async isAvailable() {
      return true;
    },
  };
  return { calls, translator };
})();

async function login(email: string) {
  const client = new TestClient(app);
  assert.equal((await client.post('/api/v1/auth/login', { email, password: PASSWORD })).status, 200);
  return client;
}

/** Cria um lote do Líder com o arquivo e envia o conteúdo; devolve o id do documento. */
async function storedDocument(name: string, content: Buffer) {
  const batch = await c.op!.request('POST', '/api/v1/batches', { files: [{ name, size: content.length }] });
  const documentId = batch.body.documents[0].id;
  assert.equal((await c.op!.putContent(`/api/v1/documents/${documentId}/content`, content)).status, 200);
  return documentId as string;
}

/** Trabalho criado sozinho para o documento armazenado (todo envio é processado, ADR-010). */
const jobOf = async (documentId: string) =>
  (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;

/** Documento novo (variação do histórico) com o seu trabalho à frente da fila; os demais esperam. */
async function freshJob(name: string, seed: string) {
  await pool.query(`UPDATE translation_jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued'`);
  const doc = await storedDocument(name, Buffer.concat([await fixture('original.pdf'), Buffer.from(`\n%${seed}`)]));
  return jobOf(doc);
}

const start = (client: TestClient, documentId: string, body: Record<string, unknown> = { sourceLanguage: 'pt', targetLanguage: 'en' }) =>
  client.post(`/api/v1/documents/${documentId}/translations`, body);

async function docxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parts = await Promise.all(
    Object.keys(zip.files)
      .filter((name) => /^word\/(document|header\d*)\.xml$/.test(name))
      .map((name) => zip.file(name)!.async('string')),
  );
  return parts.join('\n').replace(/<[^>]+>/g, '');
}

let translator: Awaited<ReturnType<typeof swornTranslator>>;

before(async () => {
  ({ app, pool, storage } = await createTestApp('phase3'));
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
  ids.doc = await storedDocument('historico.pdf', await fixture('original.pdf'));
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('início e rascunho', () => {
  it('documento enviado já entra na fila; não aceita duplicata nem outra equipe', async () => {
    ids.job = await jobOf(ids.doc!);
    const detail = await c.op!.get(`/api/v1/translations/${ids.job}`);
    assert.equal(detail.body.translation.status, 'queued');
    assert.equal((await start(c.op!, ids.doc!)).status, 409);
    assert.equal((await start(c.op!, ids.doc!, { sourceLanguage: 'pt', targetLanguage: 'pt' })).status, 400);
    assert.equal((await start(c.opb!, ids.doc!)).status, 404);
  });

  it('sem tradutor automático, o rascunho mantém a estrutura com o texto original e explica o motivo', async () => {
    assert.equal(await processNextJob(processing()), true);
    const response = await c.op!.get(`/api/v1/translations/${ids.job}`);
    assert.equal(response.body.translation.status, 'in_review');
    assert.match(response.body.translation.extractedText, /HISTÓRICO ESCOLAR/);
    assert.match(response.body.translation.notice, /fora do ar/);
    assert.equal(response.body.translation.patternKnown, false);
    assert.equal(response.body.draft.origin, 'manual');
    assert.equal(response.body.draft.revision, 1);
    assert.ok(response.body.draft.content.blocks.some((block: { kind: string }) => block.kind === 'table'));
    const codes = response.body.draft.issues.map((issue: { code: string }) => issue.code);
    // O modelo de corpo (ADR-019) preenche o tipo pelo título do original; o texto continua sem tradução.
    assert.ok(codes.includes('untranslated') && !codes.includes('missing_document_type'));
    assert.equal(response.body.draft.content.documentType, 'SCHOOL TRANSCRIPT');
    assert.equal(response.body.translation.permissions.approve, false);
    assert.match(response.body.frame.draftMark, /DRAFT/);
    assert.equal(await processNextJob(processing()), false);
  });

  it('outra equipe não vê a tradução', async () => {
    assert.equal((await c.opb!.get(`/api/v1/translations/${ids.job}`)).status, 404);
    const list = await c.opb!.get('/api/v1/translations');
    assert.equal(list.body.items.length, 0);
  });
});

describe('revisão humana', () => {
  it('cada gravação vira revisão imutável; edição concorrente é recusada', async () => {
    const saved = await c.op!.request('PUT', `/api/v1/translations/${ids.job}/draft`, { baseRevision: 1, draft: approvedTranscriptDraft });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.revision, 2);
    assert.deepEqual(
      saved.body.issues.filter((issue: { severity: string }) => issue.severity === 'error'),
      [],
    );
    const stale = await c.lider!.request('PUT', `/api/v1/translations/${ids.job}/draft`, {
      baseRevision: 1,
      draft: approvedTranscriptDraft,
    });
    assert.equal(stale.status, 409);
    const wrongLanguages = { ...approvedTranscriptDraft, sourceLanguage: 'en', targetLanguage: 'pt' };
    assert.equal(
      (await c.op!.request('PUT', `/api/v1/translations/${ids.job}/draft`, { baseRevision: 2, draft: wrongLanguages })).status,
      400,
    );
    const revisions = await c.op!.get(`/api/v1/translations/${ids.job}/revisions`);
    assert.deepEqual(
      revisions.body.items.map((item: { revision: number; origin: string }) => [item.revision, item.origin]),
      [
        [2, 'human'],
        [1, 'manual'],
      ],
    );
    await assert.rejects(pool.query(`UPDATE translation_drafts SET origin = 'human'`), /imutável/);
  });

  it('prévia sai como rascunho não aprovado', async () => {
    const response = await c.op!.raw('GET', `/api/v1/translations/${ids.job}/preview`);
    assert.equal(response.statusCode, 200);
    const text = await docxText(response.rawPayload);
    // Sem tradutor escolhido, a prévia usa o modelo de máscara do sistema, com número em branco.
    assert.match(text, /DRAFT – NOT APPROVED/);
    assert.match(text, /TRADUÇÃO PÚBLICA Nº ____/);
    assert.match(text, /\[tradutor a escolher\]/i);
  });
});

describe('aprovação', () => {
  it('Operador envia para aprovação, mas não aprova nem devolve', async () => {
    assert.equal((await submitReady(c.op!, ids.job)).body.translation.status, 'awaiting_approval');
    assert.equal((await c.op!.post(`/api/v1/translations/${ids.job}/approve`)).status, 403);
    assert.equal((await c.op!.post(`/api/v1/translations/${ids.job}/return`, { comment: 'revisar' })).status, 403);
    assert.equal(
      (await c.op!.request('PUT', `/api/v1/translations/${ids.job}/draft`, { baseRevision: 2, draft: approvedTranscriptDraft })).status,
      409,
    );
  });

  it('Líder devolve com comentário; a revisão volta para a equipe', async () => {
    const returned = await c.lider!.post(`/api/v1/translations/${ids.job}/return`, { comment: 'Conferir as notas da 3ª série.' });
    assert.equal(returned.body.translation.status, 'in_review');
    assert.equal(returned.body.translation.reviewComment, 'Conferir as notas da 3ª série.');
    assert.equal((await submitReady(c.op!, ids.job)).status, 200);
  });

  it('não conclui sem escolher o tradutor juramentado; só Supervisor cadastra tradutores', async () => {
    const response = await c.lider!.post(`/api/v1/translations/${ids.job}/approve`);
    assert.equal(response.status, 409);
    assert.equal(response.body.error.details.reason, 'translator_required');
    assert.equal((await c.op!.post('/api/v1/sworn-translators', { name: 'Tradutor X' })).status, 403);
    assert.equal((await c.director!.post('/api/v1/sworn-translators', { name: 'Tradutor X' })).status, 403);
    translator = await swornTranslator(c.lider!);
  });

  it('Líder aprova: numeração atribuída e DOCX final igual ao modelo', async () => {
    const approved = await translator.conclude(c.lider!, ids.job!);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.translation.status, 'approved');
    const year = new Date().getUTCFullYear();
    assert.equal(approved.body.translation.number, `0001/${year} – Livro 001 – Folha 001`);
    const final = await c.op!.raw('GET', `/api/v1/translations/${ids.job}/final`);
    assert.equal(final.statusCode, 200);
    const text = await docxText(final.rawPayload);
    assert.match(text, new RegExp(`TRADUÇÃO PÚBLICA Nº 0001/${year}`));
    assert.match(text, /SCHOOL TRANSCRIPT \[Histórico Escolar\]/);
    assert.doesNotMatch(text, /DRAFT/);
    assert.equal(approved.body.translation.translator.name, 'Ana Beatriz Moreira Lima');
    assert.equal((await translator.conclude(c.lider!, ids.job!)).status, 409);
  });

  it('com problema de checagem em aberto, aprovar exige justificativa registrada', async () => {
    const second = await start(c.op!, ids.doc!, { sourceLanguage: 'pt', targetLanguage: 'en', mode: 'manual' });
    assert.equal(second.status, 409); // já há tradução aprovada ativa para EN
    const job = await freshJob('historico-2.pdf', '2');
    await processNextJob(processing());
    const blocked = await c.director!.post(`/api/v1/translations/${job}/approve`, { ...translator.next() });
    assert.equal(blocked.status, 409);
    assert.ok(blocked.body.error.details.issues.length > 0);
    const forced = await translator.conclude(c.director!, job, { overrideReason: 'Teste de justificativa obrigatória.' });
    assert.equal(forced.status, 200);
    const audit = await pool.query<{ metadata: { overrideReason?: string; number: string } }>(
      `SELECT metadata FROM audit_events WHERE action = 'translation.approved' AND target_id = $1`,
      [job],
    );
    assert.equal(audit.rows[0]!.metadata.overrideReason, 'Teste de justificativa obrigatória.');
    // A tentativa recusada não grava número; vale o da conclusão justificada.
    assert.match(audit.rows[0]!.metadata.number, /^0004\//);
  });
});

describe('fila', () => {
  it('lease vencido devolve o trabalho a outro worker', async () => {
    const job = await freshJob('historico-5.pdf', '5');
    await pool.query(
      `UPDATE translation_jobs SET status = 'processing', lease_owner = 'morto', lease_expires_at = now() - interval '1 minute', attempts = 1 WHERE id = $1`,
      [job],
    );
    assert.equal(await processNextJob(processing()), true);
    const row = await pool.query<{ status: string }>('SELECT status FROM translation_jobs WHERE id = $1', [job]);
    assert.equal(row.rows[0]!.status, 'in_review');
  });
});

describe('glossário', () => {
  it('Diretor cuida do glossário da organização; Líder, do da equipe; Operador só consulta', async () => {
    const term = { sourceLanguage: 'pt', targetLanguage: 'en', sourceTerm: 'Histórico Escolar', targetTerm: 'School Transcript' };
    assert.equal((await c.op!.post('/api/v1/glossary', term)).status, 403);
    assert.equal((await c.lider!.post('/api/v1/glossary', term)).status, 403);
    assert.equal((await c.director!.post('/api/v1/glossary', term)).status, 201);
    assert.equal((await c.director!.post('/api/v1/glossary', term)).status, 409);
    const teamTerm = { ...term, sourceTerm: 'Carga horária', targetTerm: 'Workload', teamId: ids.teamA };
    assert.equal((await c.lider!.post('/api/v1/glossary', teamTerm)).status, 201);
    assert.equal((await c.lider!.post('/api/v1/glossary', { ...teamTerm, teamId: ids.teamB })).status, 404);
    const list = await c.op!.get('/api/v1/glossary?sourceLanguage=pt');
    assert.deepEqual(
      list.body.items.map((item: { sourceTerm: string; canEdit: boolean }) => [item.sourceTerm, item.canEdit]),
      [
        ['Carga horária', false],
        ['Histórico Escolar', false],
      ],
    );
    assert.equal((await c.opb!.get('/api/v1/glossary')).body.items.length, 1);
  });

  it('termos do glossário saem com a tradução aprovada, sem passar pelo provedor', async () => {
    const job = await freshJob('historico-6.pdf', '6');
    fakeMachine.calls.length = 0;
    await processNextJob(processing(fakeMachine.translator));
    assert.ok(fakeMachine.calls.flat().every((text) => !/Histórico Escolar/i.test(text)));
    const detail = await c.op!.get(`/api/v1/translations/${job}`);
    // O título do original está em maiúsculas: o termo aprovado sai em maiúsculas também.
    assert.match(JSON.stringify(detail.body.draft.content), /SCHOOL TRANSCRIPT/);
  });
});

describe('processamento automático', () => {
  const pair = { sourceLanguage: 'pt', targetLanguage: 'en' };

  it('documento armazenado entra sozinho na fila com o par do lote', async () => {
    await pool.query(`UPDATE translation_jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued'`);
    const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from('\n%auto')]);
    const batch = await c.lider!.request('POST', '/api/v1/batches', {
      translation: { sourceLanguage: 'en', targetLanguage: 'pt' },
      files: [{ name: 'auto.pdf', size: pdf.length }],
    });
    assert.deepEqual(batch.body.batch.translation, { sourceLanguage: 'en', targetLanguage: 'pt' });
    const documentId = batch.body.documents[0].id;
    await c.lider!.putContent(`/api/v1/documents/${documentId}/content`, pdf);
    const jobs = await pool.query<{ status: string; requested_mode: string; target_language: string }>(
      'SELECT status, requested_mode, target_language FROM translation_jobs WHERE document_id = $1',
      [documentId],
    );
    assert.deepEqual(
      jobs.rows.map((job) => [job.status, job.requested_mode, job.target_language]),
      [['queued', 'auto', 'pt']],
    );
  });

  it('sem par informado, o lote é processado como PT → EN', async () => {
    const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from('\n%none')]);
    const batch = await c.lider!.request('POST', '/api/v1/batches', { files: [{ name: 'padrao.pdf', size: pdf.length }] });
    assert.deepEqual(batch.body.batch.translation, pair);
    await c.lider!.putContent(`/api/v1/documents/${batch.body.documents[0].id}/content`, pdf);
    const jobs = await pool.query('SELECT 1 FROM translation_jobs WHERE document_id = $1', [batch.body.documents[0].id]);
    assert.equal(jobs.rowCount, 1);
  });

  it('lote do Diretor é processado logo após o envio, antes do direcionamento', async () => {
    const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from('\n%dir')]);
    const batch = await c.director!.request('POST', '/api/v1/batches', {
      translation: pair,
      files: [{ name: 'diretoria.pdf', size: pdf.length }],
    });
    const documentId = batch.body.documents[0].id;
    await c.director!.putContent(`/api/v1/documents/${documentId}/content`, pdf);
    assert.equal(
      (await pool.query(`SELECT 1 FROM translation_jobs WHERE document_id = $1 AND status = 'queued'`, [documentId])).rowCount,
      1,
    );
    assert.equal((await c.op!.get('/api/v1/translations?q=diretoria')).body.items.length, 0);
    await c.director!.post(`/api/v1/batches/${batch.body.batch.id}/assign`, { teamId: ids.teamA });
    assert.equal((await pool.query('SELECT 1 FROM translation_jobs WHERE document_id = $1', [documentId])).rowCount, 1);
    assert.equal((await c.op!.get('/api/v1/translations?q=diretoria')).body.items.length, 1);
  });

  it('DOCX é traduzido a partir do texto extraído, com o motivo quando não há tradutor automático', async () => {
    await pool.query(`UPDATE translation_jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued'`);
    const docx = await fixture('esperado.docx');
    const batch = await c.director!.request('POST', '/api/v1/batches', {
      translation: { sourceLanguage: 'en', targetLanguage: 'pt' },
      files: [{ name: 'traducao.docx', size: docx.length }],
    });
    const documentId = batch.body.documents[0].id;
    await c.director!.putContent(`/api/v1/documents/${documentId}/content`, docx);
    await c.director!.post(`/api/v1/batches/${batch.body.batch.id}/assign`, { teamId: ids.teamB });
    await processNextJob(processing());
    const detail = await c.opb!.get(`/api/v1/translations/${await jobOf(documentId)}`);
    assert.equal(detail.body.translation.status, 'in_review');
    assert.equal(detail.body.draft.origin, 'manual');
    assert.match(detail.body.translation.notice, /"libretranslate"\) está fora do ar/);
    assert.match(detail.body.translation.extractedText, /SCHOOL TRANSCRIPT \[Histórico Escolar\]/);
  });

  it('a interface sabe se há worker ativo, tradução automática e tradutor público configurado', async () => {
    await pool.query('DELETE FROM worker_heartbeats');
    assert.deepEqual((await c.op!.get('/api/v1/translation-capabilities')).body, {
      workerOnline: false,
      lastSeenAt: null,
      machineProviders: [],
      machineProvider: 'libretranslate',
      machineAvailable: false,
      translatorsReady: true,
    });
    const { recordHeartbeat } = await import('@tradutor/core/processing');
    await recordHeartbeat({ pool, workerId: 'w1' });
    const without = (await c.op!.get('/api/v1/translation-capabilities')).body;
    assert.deepEqual([without.workerOnline, without.machineAvailable], [true, false]);
    await recordHeartbeat({ pool, workerId: 'w2', machine: { libretranslate: fakeMachine.translator } });
    const withAll = (await c.op!.get('/api/v1/translation-capabilities')).body;
    assert.deepEqual([withAll.machineAvailable, withAll.machineProviders], [true, ['libretranslate']]);
  });
});

describe('tradução automática gratuita (ADR-008)', () => {
  const pair = { sourceLanguage: 'pt', targetLanguage: 'en' };
  let firstJob = '';

  async function autoDocument(name: string, seed: string, client = c.op!) {
    await pool.query(`UPDATE translation_jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued'`);
    const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from(`\n%${seed}`)]);
    const batch = await client.request('POST', '/api/v1/batches', { translation: pair, files: [{ name, size: pdf.length }] });
    await client.putContent(`/api/v1/documents/${batch.body.documents[0].id}/content`, pdf);
    return (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [batch.body.documents[0].id]))
      .rows[0]!.id;
  }

  it('o provedor gratuito traduz o rascunho trecho a trecho; o tipo já conhecido vem do exemplo', async () => {
    firstJob = await autoDocument('gratuito.pdf', 'free1');
    fakeMachine.calls.length = 0;
    await processNextJob(processing(fakeMachine.translator));
    const detail = await c.op!.get(`/api/v1/translations/${firstJob}`);
    assert.equal(detail.body.draft.origin, 'machine');
    assert.match(detail.body.translation.notice, /Traduzido automaticamente \(LibreTranslate\)/);
    assert.equal(detail.body.translation.patternKnown, true);
    assert.ok(fakeMachine.calls.flat().length > 20);
    // O exemplo aprovado do mesmo tipo informa tipo e título do documento.
    assert.equal(detail.body.draft.content.documentType, 'SCHOOL TRANSCRIPT');
    const audit = await pool.query(`SELECT metadata FROM audit_events WHERE action = 'translation.machine_translated' AND target_id = $1`, [
      firstJob,
    ]);
    assert.equal(audit.rowCount, 1);
  });

  it('aprovar ensina a memória; o próximo documento igual não chama o provedor', async () => {
    const detail = await c.op!.get(`/api/v1/translations/${firstJob}`);
    const draft = detail.body.draft.content;
    // O revisor corrige um trecho; é a correção que a memória aprende.
    const corrected = {
      ...draft,
      blocks: draft.blocks.map((block: { kind: string; sourceText: string | null; text?: string }) =>
        (block.kind === 'heading' || block.kind === 'paragraph') && block.sourceText === 'HISTÓRICO ESCOLAR'
          ? { ...block, text: 'SCHOOL TRANSCRIPT', origin: 'human' }
          : block,
      ),
    };
    const saved = await c.op!.request('PUT', `/api/v1/translations/${firstJob}/draft`, {
      baseRevision: detail.body.draft.revision,
      draft: corrected,
    });
    assert.deepEqual(
      saved.body.issues.filter((issue: { severity: string }) => issue.severity === 'error'),
      [],
    );
    assert.equal((await translator.conclude(c.lider!, firstJob)).status, 200);
    const learned = await pool.query<{ target_text: string }>(
      `SELECT target_text FROM translation_memory WHERE source_language = 'pt' AND target_language = 'en' AND source_text = 'HISTÓRICO ESCOLAR'`,
    );
    assert.equal(learned.rows[0]?.target_text, 'SCHOOL TRANSCRIPT');

    fakeMachine.calls.length = 0;
    const second = await autoDocument('gratuito-2.pdf', 'free2');
    await processNextJob(processing(fakeMachine.translator));
    const secondDetail = await c.op!.get(`/api/v1/translations/${second}`);
    const blocks = secondDetail.body.draft.content.blocks as Array<{ origin: string; sourceText: string | null; text: string }>;
    assert.equal(blocks.find((block) => block.sourceText === 'HISTÓRICO ESCOLAR')?.text, 'SCHOOL TRANSCRIPT');
    assert.ok(blocks.every((block) => block.origin === 'memory' || block.origin === 'rules'));
    assert.equal(fakeMachine.calls.flat().length, 0);
  });

  it('aprovação com erro justificado não ensina a memória', async () => {
    await pool.query('DELETE FROM translation_memory');
    const job = await autoDocument('com-erro.pdf', 'free3');
    await processNextJob(processing(fakeMachine.translator));
    const detail = await c.op!.get(`/api/v1/translations/${job}`);
    const broken = { ...detail.body.draft.content, documentType: '' };
    await c.op!.request('PUT', `/api/v1/translations/${job}/draft`, { baseRevision: detail.body.draft.revision, draft: broken });
    assert.equal((await translator.conclude(c.lider!, job, { overrideReason: 'Teste: erro justificado.' })).status, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM translation_memory')).rows[0].n, 0);
  });

  it('o Diretor escolhe o provedor; "none" desliga a tradução gratuita', async () => {
    assert.equal((await c.lider!.request('PUT', '/api/v1/machine-translation-settings', { provider: 'none' })).status, 403);
    assert.equal((await c.director!.request('PUT', '/api/v1/machine-translation-settings', { provider: 'none' })).status, 200);
    const job = await autoDocument('desligado.pdf', 'free4');
    await processNextJob(processing(fakeMachine.translator));
    const detail = await c.op!.get(`/api/v1/translations/${job}`);
    assert.equal(detail.body.draft.origin, 'manual');
    assert.match(detail.body.translation.notice, /desligada nas Configurações/);
    await c.director!.request('PUT', '/api/v1/machine-translation-settings', { provider: 'libretranslate' });
  });

  it('falha temporária do provedor devolve o trabalho para a fila', async () => {
    await pool.query('DELETE FROM translation_memory');
    const job = await autoDocument('instavel.pdf', 'free5');
    const flaky: MachineTranslator = {
      ...fakeMachine.translator,
      translate: async () => Promise.reject(new MachineTranslationFailed('fora do ar', true)),
    };
    await processNextJob(processing(flaky));
    const row = await pool.query<{ status: string; failure_code: string }>(
      'SELECT status, failure_code FROM translation_jobs WHERE id = $1',
      [job],
    );
    assert.deepEqual(row.rows[0], { status: 'queued', failure_code: 'machine_libretranslate' });
  });
});
