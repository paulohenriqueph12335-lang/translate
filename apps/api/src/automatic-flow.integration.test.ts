import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import type { Pool } from 'pg';
import { processNextJob, type ProcessingDeps } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import type { MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, inspectReady, swornTranslator, TestClient } from './test/helpers.js';

/**
 * Fluxo automático até o Word (ADR-017): envio com ou sem máscara e com o tradutor escolhido; tradução e revisão
 * automáticas; prévia em Word e PDF com o número previsto; aprovar leva à próxima fase. Padrões de documento:
 * histórico e teste sem gravar nada.
 */
const PASSWORD = 'senha-de-teste-123';
const fixture = (name: string) => readFile(new URL(`../../../packages/core/fixtures/historico-escolar/${name}`, import.meta.url));

let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
let converter: Server;
const c: Record<string, TestClient> = {};
const ids: Record<string, string> = {};

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

async function upload(client: TestClient, name: string, seed: string, options: Record<string, unknown>) {
  const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from(`\n%${seed}`)]);
  const batch = await client.request('POST', '/api/v1/batches', {
    translation: { sourceLanguage: 'pt', targetLanguage: 'en' },
    files: [{ name, size: pdf.length }],
    ...options,
  });
  assert.equal(batch.status, 201, JSON.stringify(batch.body));
  const documentId = batch.body.documents[0].id as string;
  assert.equal((await client.putContent(`/api/v1/documents/${documentId}/content`, pdf)).status, 200);
  const job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
  assert.equal(await processNextJob(processing()), true);
  return job;
}

async function docxText(data: Buffer) {
  const zip = await JSZip.loadAsync(data);
  return (await zip.file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, '');
}

before(async () => {
  // Conversor falso no lugar do Gotenberg: devolve um PDF mínimo com o tamanho do Word recebido.
  converter = createServer((request, response) => {
    let size = 0;
    request.on('data', (chunk: Buffer) => (size += chunk.length));
    request.on('end', () => {
      response.writeHead(request.url === '/forms/libreoffice/convert' ? 200 : 404, { 'content-type': 'application/pdf' });
      response.end(`%PDF-1.7 convertido ${size}`);
    });
  });
  await new Promise<void>((resolve) => converter.listen(0, '127.0.0.1', resolve));
  const port = (converter.address() as AddressInfo).port;
  ({ app, pool, storage } = await createTestApp('autoflow', {
    machine: { libretranslate: machine },
    env: { CONVERTER_URL: `http://127.0.0.1:${port}` },
  }));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  c.director = await login('diretor@exemplo.test');
  for (const name of ['lider', 'op']) {
    const email = `${name}@exemplo.test`;
    await new TestClient(app).post('/api/v1/auth/signup', { email, displayName: name, password: PASSWORD });
    ids[name] = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!.id;
    await c.director.post(`/api/v1/users/${ids[name]}/approve`);
  }
  ids.team = (await c.director.post('/api/v1/teams', { name: 'Equipe A' })).body.team.id;
  await c.director.post(`/api/v1/teams/${ids.team}/members`, { userId: ids.lider, role: 'leader' });
  await c.director.post(`/api/v1/teams/${ids.team}/members`, { userId: ids.op, role: 'operator' });
  c.lider = await login('lider@exemplo.test');
  c.op = await login('op@exemplo.test');

  // Tradutora com máscara e numeração por livro e folha (como a da Patricia).
  ids.translator = (await swornTranslator(c.lider)).id;
  await c.lider.request('PUT', `/api/v1/sworn-translators/${ids.translator}/numbering`, {
    scheme: 'book_sheet',
    config: { sheetLimit: 400, recordPages: true },
  });
  await c.lider.post(`/api/v1/sworn-translators/${ids.translator}/numbering/books`, { book: '12', nextNumber: 501 });
});

after(async () => {
  await app.close();
  await pool.end();
  converter.close();
});

describe('fluxo automático até o Word', () => {
  it('juramentada com máscara: tradutor do envio, checklist automático, prévia com o número previsto, em Word e PDF', async () => {
    ids.sworn = await upload(c.op!, 'certidao.pdf', 'mascara', { mode: 'sworn', useMask: true, translatorId: ids.translator });
    const detail = await c.op!.get(`/api/v1/translations/${ids.sworn}`);
    const t = detail.body.translation;
    assert.equal(t.status, 'in_review');
    assert.equal(t.useMask, true);
    assert.equal(t.preferredTranslator.id, ids.translator);
    assert.equal(t.pageCount, 1);
    assert.equal(t.permissions.accept, true);
    assert.ok((detail.body.checklist as Array<{ checked: unknown }>).every((item) => item.checked));

    assert.equal(
      (await c.op!.request('PUT', `/api/v1/translations/${ids.sworn}/numbering`, { translatorId: ids.translator, pages: t.pageCount }))
        .status,
      200,
    );
    const preview = await c.op!.raw('GET', `/api/v1/translations/${ids.sworn}/preview`);
    assert.equal(preview.statusCode, 200);
    const text = await docxText(preview.rawPayload);
    assert.match(text, /501/);
    assert.match(text, /ANA BEATRIZ MOREIRA LIMA/);
    const pdf = await c.op!.raw('GET', `/api/v1/translations/${ids.sworn}/preview?format=pdf`);
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.match(String(pdf.headers['content-disposition']), /^inline;.*\.pdf/);
    assert.match(pdf.body, /^%PDF/);
  });

  it('o Usuário aprova o Word e a liderança conclui; o número sai pela regra do tradutor', async () => {
    assert.equal((await inspectReady(c.op!, ids.sworn)).status, 200);
    const accepted = await c.op!.post(`/api/v1/translations/${ids.sworn}/accept`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.translation.status, 'awaiting_approval');
    const concluded = await c.lider!.post(`/api/v1/translations/${ids.sworn}/accept`);
    assert.equal(concluded.status, 200, JSON.stringify(concluded.body));
    assert.equal(concluded.body.translation.status, 'approved');
    assert.equal(concluded.body.translation.number, '501 – Livro 12 – Folha 1');
    const final = await c.op!.raw('GET', `/api/v1/translations/${ids.sworn}/final?format=pdf&download=true`);
    assert.equal(final.statusCode, 200);
    assert.match(String(final.headers['content-disposition']), /^attachment;.*ENG\.pdf/);
  });

  it('sem numeração preenchida, a aprovação usa a regra do tradutor do envio e as páginas do original', async () => {
    const job = await upload(c.lider!, 'direto.pdf', 'direto', { mode: 'sworn', translatorId: ids.translator });
    // A prévia já mostra o próximo número antes de qualquer preenchimento.
    assert.match(await docxText((await c.lider!.raw('GET', `/api/v1/translations/${job}/preview`)).rawPayload), /502/);
    assert.equal((await inspectReady(c.lider!, job)).status, 200);
    const done = await c.lider!.post(`/api/v1/translations/${job}/accept`);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.translation.number, '502 – Livro 12 – Folha 2');
  });

  it('juramentada sem máscara: o Supervisor aprova e conclui na hora, sem tradutor nem número', async () => {
    const job = await upload(c.lider!, 'sem-mascara.pdf', 'semmascara', { mode: 'sworn', useMask: false });
    const detail = await c.lider!.get(`/api/v1/translations/${job}`);
    assert.equal(detail.body.translation.useMask, false);
    assert.equal((await inspectReady(c.lider!, job)).status, 200);
    const done = await c.lider!.post(`/api/v1/translations/${job}/accept`);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.translation.status, 'approved');
    assert.equal(done.body.translation.number, null);
    const final = await c.lider!.raw('GET', `/api/v1/translations/${job}/final`);
    assert.equal(final.statusCode, 200);
    assert.doesNotMatch(await docxText(final.rawPayload), /ANA BEATRIZ MOREIRA LIMA/i);
  });
});

describe('documento sem texto lido', () => {
  it('sem leitura nem tradução, o checklist não é confirmado pela revisão automática', async () => {
    // PNG mínimo: sem OCR disponível (ou sem texto reconhecido) não há o que traduzir nem atestar.
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const batch = await c.op!.request('POST', '/api/v1/batches', {
      mode: 'certified',
      translation: { sourceLanguage: 'pt', targetLanguage: 'en' },
      files: [{ name: 'foto.png', size: png.length }],
    });
    const documentId = batch.body.documents[0].id as string;
    assert.equal((await c.op!.putContent(`/api/v1/documents/${documentId}/content`, png)).status, 200);
    const job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
    assert.equal(await processNextJob(processing()), true);
    const detail = await c.op!.get(`/api/v1/translations/${job}`);
    assert.equal(detail.body.translation.status, 'in_review');
    assert.ok((detail.body.checklist as Array<{ checked: unknown }>).every((item) => item.checked === null));
    assert.equal((await c.op!.post(`/api/v1/translations/${job}/submit`)).body.error.details.reason, 'checklist_incomplete');
  });
});

describe('padrões de documento', () => {
  it('histórico: o tipo já concluído aparece como "consegue fazer"', async () => {
    const list = await c.lider!.get('/api/v1/document-patterns');
    assert.equal(list.status, 200);
    const item = (list.body.items as Array<{ title: string; verdict: string; approved: number }>).find((entry) =>
      /HISTÓRICO ESCOLAR/i.test(entry.title),
    );
    assert.ok(item, JSON.stringify(list.body.items));
    assert.equal(item.approved, 3);
    assert.equal(item.verdict, 'can');
  });

  it('teste: analisa sem criar tradução; imagem e arquivo desconhecido ficam como "ainda não consegue"', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM translation_jobs')).rows[0].n;
    const pdf = await fixture('original.pdf');
    const tested = await c.op!.putContent(
      '/api/v1/document-patterns/test?sourceLanguage=pt&targetLanguage=en&mode=certified',
      pdf,
      { 'x-file-name': 'novo.pdf' },
      'POST',
    );
    assert.equal(tested.status, 200, JSON.stringify(tested.body).slice(0, 300));
    assert.notEqual(tested.body.verdict, 'cannot');
    assert.equal(tested.body.format, 'pdf');
    assert.ok(tested.body.structure.tables > 0);
    assert.ok(tested.body.known, 'o tipo já tem conclusão que serve de padrão');
    assert.ok(Buffer.from(tested.body.previewDocx, 'base64').subarray(0, 2).toString() === 'PK');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM translation_jobs')).rows[0].n, before);

    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const image = await c.op!.putContent('/api/v1/document-patterns/test?sourceLanguage=pt&targetLanguage=en', png, {}, 'POST');
    assert.equal(image.body.verdict, 'cannot');
    assert.match(image.body.reasons[0], /OCR/);
    const unknown = await c.op!.putContent(
      '/api/v1/document-patterns/test?sourceLanguage=pt&targetLanguage=en',
      Buffer.from('texto'),
      {},
      'POST',
    );
    assert.equal(unknown.body.verdict, 'cannot');
  });
});
