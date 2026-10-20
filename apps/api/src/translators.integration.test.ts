import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import JSZip from 'jszip';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { processNextJob } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import { renderMaskTemplate } from '@tradutor/core/translation';
import { approvedTranscriptDraft } from '@tradutor/core/fixtures';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient, submitReady, allowTranslatorNotes } from './test/helpers.js';

/** Tradutores juramentados com máscara própria e numeração digitada (ADR-012). */
const PASSWORD = 'senha-de-teste-123';
const fixture = (name: string) => readFile(new URL(`../../../packages/core/fixtures/historico-escolar/${name}`, import.meta.url));

let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
const ids: Record<string, string> = {};
const c: Record<string, TestClient> = {};
let template: Buffer;

async function login(email: string) {
  const client = new TestClient(app);
  assert.equal((await client.post('/api/v1/auth/login', { email, password: PASSWORD })).status, 200);
  return client;
}

const text = async (docx: Buffer) => {
  const zip = await JSZip.loadAsync(docx);
  const parts = Object.keys(zip.files).filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name));
  return (await Promise.all(parts.map((name) => zip.file(name)!.async('string')))).join('\n').replace(/<[^>]+>/g, '');
};

/** Máscara de um tradutor: o modelo do sistema com o nome dele escrito no timbre (cabeçalho). */
async function maskOf(name: string) {
  const zip = await JSZip.loadAsync(template);
  for (const part of Object.keys(zip.files).filter((file) => /^word\/header\d*\.xml$/.test(file))) {
    zip.file(part, (await zip.file(part)!.async('string')).replace('{{TRADUTOR}}', name.toUpperCase()));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Documento pronto para concluir, enviado pelo Usuário. */
async function ready(seed: string) {
  await pool.query(`UPDATE translation_jobs SET run_after = now() + interval '1 hour' WHERE status = 'queued'`);
  const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from(`\n%${seed}`)]);
  const batch = await c.op!.request('POST', '/api/v1/batches', { files: [{ name: `${seed}.pdf`, size: pdf.length }] });
  const documentId = batch.body.documents[0].id as string;
  await c.op!.putContent(`/api/v1/documents/${documentId}/content`, pdf);
  const job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
  await processNextJob({ pool, storage, workerId: 'teste' });
  await c.op!.request('PUT', `/api/v1/translations/${job}/draft`, { baseRevision: 1, draft: approvedTranscriptDraft });
  await submitReady(c.op!, job);
  return job;
}

before(async () => {
  ({ app, pool, storage } = await createTestApp('translators'));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  await allowTranslatorNotes(pool);
  c.director = await login('diretor@exemplo.test');
  for (const name of ['sup', 'op']) {
    const email = `${name}@exemplo.test`;
    await new TestClient(app).post('/api/v1/auth/signup', { email, displayName: name, password: PASSWORD });
    ids[name] = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!.id;
    await c.director.post(`/api/v1/users/${ids[name]}/approve`);
  }
  ids.team = (await c.director.post('/api/v1/teams', { name: 'Equipe' })).body.team.id;
  await c.director.post(`/api/v1/teams/${ids.team}/members`, { userId: ids.sup, role: 'leader' });
  await c.director.post(`/api/v1/teams/${ids.team}/members`, { userId: ids.op, role: 'operator' });
  c.sup = await login('sup@exemplo.test');
  c.op = await login('op@exemplo.test');
  // As máscaras reais chegam por upload; nos testes, o modelo do sistema faz o papel delas.
  template = await renderMaskTemplate('en');
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('cadastro de tradutores juramentados', () => {
  it('só o Supervisor cadastra e altera; todos consultam a lista', async () => {
    const body = { name: 'Ana Beatriz Moreira Lima', languages: 'Inglês' };
    assert.equal((await c.op!.post('/api/v1/sworn-translators', body)).status, 403);
    assert.equal((await c.director!.post('/api/v1/sworn-translators', body)).status, 403);
    const created = await c.sup!.post('/api/v1/sworn-translators', body);
    assert.equal(created.status, 201);
    ids.ana = created.body.translator.id;
    assert.equal(created.body.translator.ready, false);
    assert.equal((await c.sup!.post('/api/v1/sworn-translators', { name: 'ana beatriz moreira lima' })).status, 409);
    ids.bruno = (await c.sup!.post('/api/v1/sworn-translators', { name: 'Bruno Carvalho Dias' })).body.translator.id;
    const list = (await c.op!.get('/api/v1/sworn-translators')).body.items;
    assert.deepEqual(
      list.map((item: { name: string; permissions: { edit: boolean } }) => [item.name, item.permissions.edit]),
      [
        ['Ana Beatriz Moreira Lima', false],
        ['Bruno Carvalho Dias', false],
      ],
    );
    const edited = await c.sup!.request('PATCH', `/api/v1/sworn-translators/${ids.ana}`, { registration: 'JUCESP nº 0000' });
    assert.equal(edited.body.translator.registration, 'JUCESP nº 0000');
    // Regras de numeração não são campo do cadastro: serão programadas por tradutor.
    assert.equal((await c.sup!.request('PATCH', `/api/v1/sworn-translators/${ids.ana}`, { numberingRules: 'x' })).status, 400);
    assert.equal((await c.director!.request('PATCH', `/api/v1/sworn-translators/${ids.ana}`, { active: false })).status, 403);
  });

  it('máscara por upload: só Word com {{texto}}; cada envio é uma edição numerada', async () => {
    const put = (id: string, data: Buffer, name: string, client = c.sup!) =>
      client.putContent(`/api/v1/sworn-translators/${id}/masks`, data, { 'x-file-name': encodeURIComponent(name) }, 'POST');
    assert.equal((await put(ids.ana!, Buffer.from('não é word'), 'x.docx')).status, 422);
    const withoutText = await JSZip.loadAsync(template);
    withoutText.file('word/document.xml', (await withoutText.file('word/document.xml')!.async('string')).replace('{{texto}}', ''));
    // Máscara é sempre Word: PDF e .doc antigo são recusados com a orientação certa.
    const pdf = await put(ids.ana!, await fixture('original.pdf'), 'mascara.pdf');
    assert.equal(pdf.status, 422);
    assert.match(pdf.body.error.message, /PDF não é aceito/);
    const oldWord = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
    assert.match((await put(ids.ana!, oldWord, 'mascara.doc')).body.error.message, /Salvar como/);
    // Word sem marcadores é guardado e fica aguardando configuração; não serve para concluir.
    const pending = await put(ids.bruno!, await withoutText.generateAsync({ type: 'nodebuffer' }), 'sem-texto.docx');
    assert.equal(pending.status, 201, JSON.stringify(pending.body));
    assert.equal(pending.body.translator.mask.configured, false);
    assert.match(pending.body.translator.mask.issues[0], /\{\{texto\}\}/);
    assert.equal(pending.body.translator.ready, false);
    assert.equal((await put(ids.ana!, template, 'x.docx', c.op!)).status, 403);
    const accepted = await put(ids.ana!, await maskOf('Ana Beatriz Moreira Lima'), 'Máscara Ana.docx');
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
    assert.equal(accepted.body.edition, 1);
    assert.equal(accepted.body.translator.ready, true);
    assert.equal(accepted.body.translator.mask.name, 'Máscara Ana.docx');
    assert.equal(accepted.body.translator.mask.edition, 1);
    assert.ok(accepted.body.translator.mask.markers.includes('numero'));
    await put(ids.bruno!, await maskOf('Bruno Carvalho Dias'), 'bruno.docx');
    // Envio recusado não gasta número de edição.
    assert.equal((await c.sup!.get(`/api/v1/sworn-translators/${ids.ana}`)).body.translator.masks.length, 1);
    // Não há mais download de modelo de máscara: as máscaras chegam só por upload.
    assert.notEqual((await c.op!.raw('GET', '/api/v1/sworn-translators/mask-template')).statusCode, 200);
  });

  it('PDF de referência do tradutor; download da máscara para Supervisor e Diretor', async () => {
    const pdf = await fixture('original.pdf');
    const putPdf = (data: Buffer) =>
      c.sup!.putContent(`/api/v1/sworn-translators/${ids.ana}/reference-pdf`, data, {
        'content-type': 'application/pdf',
        'x-file-name': 'ana.pdf',
      });
    assert.equal((await putPdf(Buffer.from('nada'))).status, 422);
    assert.equal((await putPdf(pdf)).body.translator.referencePdf.name, 'ana.pdf');
    assert.equal((await c.director!.raw('GET', `/api/v1/sworn-translators/${ids.ana}/mask`)).statusCode, 200);
    assert.equal((await c.director!.raw('GET', `/api/v1/sworn-translators/${ids.ana}/reference-pdf`)).statusCode, 200);
    assert.equal((await c.op!.raw('GET', `/api/v1/sworn-translators/${ids.ana}/mask`)).statusCode, 403);
  });
});

describe('edições da máscara', () => {
  it('nova edição passa a valer; dá para voltar a uma edição anterior e baixar cada uma', async () => {
    const second = await c.sup!.putContent(
      `/api/v1/sworn-translators/${ids.ana}/masks`,
      await maskOf('Ana B. M. Lima'),
      { 'x-file-name': 'Ana v2.docx', 'x-notes': encodeURIComponent('Timbre novo') },
      'POST',
    );
    assert.equal(second.body.edition, 2);
    const translator = second.body.translator;
    assert.deepEqual(
      translator.masks.map((mask: { edition: number; current: boolean }) => [mask.edition, mask.current]),
      [
        [2, true],
        [1, false],
      ],
    );
    assert.equal(translator.masks[0].notes, 'Timbre novo');
    const first = translator.masks[1].id;
    assert.equal((await c.director!.raw('GET', `/api/v1/sworn-translators/${ids.ana}/masks/${first}`)).statusCode, 200);
    assert.equal((await c.op!.post(`/api/v1/sworn-translators/${ids.ana}/masks/${first}/use`)).status, 403);
    const back = await c.sup!.post(`/api/v1/sworn-translators/${ids.ana}/masks/${first}/use`);
    assert.equal(back.body.translator.mask.edition, 1);
  });
});

describe('conclusão com o tradutor escolhido', () => {
  it('a prévia sai na máscara escolhida, sem número', async () => {
    const job = await ready('previa');
    ids.job1 = job;
    const preview = await c.op!.raw('GET', `/api/v1/translations/${job}/preview?translatorId=${ids.bruno}`);
    const body = await text(preview.rawPayload);
    assert.match(body, /BRUNO CARVALHO DIAS/);
    assert.match(body, /TRADUÇÃO PÚBLICA Nº ____/);
  });

  it('o número digitado vai para a máscara; não se repete no mesmo tradutor, mas pode em outro', async () => {
    const done = await c.sup!.post(`/api/v1/translations/${ids.job1}/approve`, {
      translatorId: ids.ana,
      number: '123/2026',
      book: '7',
      sheet: '45-V',
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.translation.number, '123/2026 – Livro 7 – Folha 45-V');
    assert.equal(done.body.translation.translator.name, 'Ana Beatriz Moreira Lima');
    assert.equal(done.body.translation.translator.maskEdition, 1);
    const final = await text((await c.op!.raw('GET', `/api/v1/translations/${ids.job1}/final`)).rawPayload);
    assert.match(final, /ANA BEATRIZ MOREIRA LIMA/);
    assert.match(final, /TRADUÇÃO PÚBLICA Nº 123\/2026/);
    assert.match(final, /LIVRO Nº 7 – FOLHA Nº 45-V/);
    assert.doesNotMatch(final, /\{\{|DRAFT/);

    const job2 = await ready('segunda');
    const repeated = await c.sup!.post(`/api/v1/translations/${job2}/approve`, { translatorId: ids.ana, number: '123/2026' });
    assert.equal(repeated.status, 409);
    assert.equal(repeated.body.error.details.reason, 'number_taken');
    assert.equal((await c.sup!.get(`/api/v1/translations/${job2}`)).body.translation.status, 'awaiting_approval');
    const other = await c.sup!.post(`/api/v1/translations/${job2}/approve`, { translatorId: ids.bruno, number: '123/2026' });
    assert.equal(other.status, 200);
  });

  it('tradutor inativo ou sem número não conclui', async () => {
    const job = await ready('terceira');
    assert.equal((await c.sup!.post(`/api/v1/translations/${job}/approve`, { translatorId: ids.ana })).status, 400);
    await c.sup!.request('PATCH', `/api/v1/sworn-translators/${ids.ana}`, { active: false });
    assert.equal((await c.sup!.post(`/api/v1/translations/${job}/approve`, { translatorId: ids.ana, number: '9' })).status, 409);
    assert.deepEqual(
      (await c.op!.get('/api/v1/sworn-translators?active=true')).body.items.map((item: { name: string }) => item.name),
      ['Bruno Carvalho Dias'],
    );
    const audit = await pool.query(`SELECT 1 FROM audit_events WHERE action LIKE 'translator.%'`);
    assert.ok((audit.rowCount ?? 0) >= 5);
  });
});
