import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import type { Pool } from 'pg';
import { processNextJob, type ProcessingDeps } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import type { MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

/** Modelos de moldura do tradutor e de corpo por tipo de documento (ADR-019). */
const PASSWORD = 'senha-de-teste-123';
const fixture = (name: string) => readFile(new URL(`../../../packages/core/fixtures/historico-escolar/${name}`, import.meta.url));

let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
const c: Record<string, TestClient> = {};
const ids: Record<string, string> = {};

const machine: MachineTranslator = {
  name: 'libretranslate',
  external: false,
  translate: async (texts) => texts.map((text) => `[FR] ${text}`),
  isAvailable: async () => true,
};
const processing = (): ProcessingDeps => ({ pool, storage, workerId: 'teste', machine: { libretranslate: machine } });

async function text(docx: Buffer) {
  const zip = await JSZip.loadAsync(docx);
  const parts = await Promise.all(
    Object.keys(zip.files)
      .filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name))
      .map((name) => zip.file(name)!.async('string')),
  );
  return parts.join('\n').replace(/<[^>]+>/g, '');
}

before(async () => {
  ({ app, pool, storage } = await createTestApp('framemodels', { machine: { libretranslate: machine } }));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  c.director = new TestClient(app);
  await c.director.post('/api/v1/auth/login', { email: 'diretor@exemplo.test', password: PASSWORD });
  await new TestClient(app).post('/api/v1/auth/signup', { email: 'lider@exemplo.test', displayName: 'Líder', password: PASSWORD });
  ids.lider = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = 'lider@exemplo.test'`)).rows[0]!.id;
  await c.director.post(`/api/v1/users/${ids.lider}/approve`);
  ids.team = (await c.director.post('/api/v1/teams', { name: 'Equipe A' })).body.team.id;
  await c.director.post(`/api/v1/teams/${ids.team}/members`, { userId: ids.lider, role: 'leader' });
  c.lider = new TestClient(app);
  await c.lider.post('/api/v1/auth/login', { email: 'lider@exemplo.test', password: PASSWORD });
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('modelos de moldura do tradutor', () => {
  it('lista os modelos e gera a prévia do modelo em Word', async () => {
    const list = await c.lider!.get('/api/v1/frame-models');
    assert.deepEqual(
      (list.body.items as Array<{ id: string }>).map((item) => item.id),
      ['classico', 'quadro', 'bilingue', 'compacto'],
    );
    const preview = await c.lider!.raw('GET', '/api/v1/frame-models/quadro/preview?format=docx&name=Helena%20Duarte&target=fr');
    assert.equal(preview.statusCode, 200);
    const content = await text(preview.rawPayload);
    assert.match(content, /HELENA DUARTE/);
    assert.match(content, /TRADUÇÃO PÚBLICA Nº 1201/);
  });

  it('o Supervisor gera a máscara de um modelo; a tradução em francês sai com a moldura em francês', async () => {
    const created = await c.lider!.post('/api/v1/sworn-translators', {
      name: 'Helena Duarte Fictícia',
      registration: 'Matrícula JUCEFIC nº 0000',
    });
    ids.translator = created.body.translator.id;
    const masked = await c.lider!.post(`/api/v1/sworn-translators/${ids.translator}/masks/model`, {
      model: 'bilingue',
      city: 'Vila Esperança',
      state: 'EF',
      contact: 'tradutora@exemplo.test',
    });
    assert.equal(masked.status, 201, JSON.stringify(masked.body));
    assert.equal(masked.body.translator.ready, true);
    assert.equal(masked.body.translator.mask.frame.model, 'bilingue');
    await c.lider!.request('PUT', `/api/v1/sworn-translators/${ids.translator}/numbering`, {
      scheme: 'book_sheet',
      config: { sheetLimit: 400, recordPages: true },
    });
    await c.lider!.post(`/api/v1/sworn-translators/${ids.translator}/numbering/books`, { book: '3', nextNumber: 77 });

    const pdf = await fixture('original.pdf');
    const batch = await c.lider!.request('POST', '/api/v1/batches', {
      mode: 'sworn',
      translatorId: ids.translator,
      translation: { sourceLanguage: 'pt', targetLanguage: 'fr' },
      files: [{ name: 'historico.pdf', size: pdf.length }],
    });
    const documentId = batch.body.documents[0].id as string;
    await c.lider!.putContent(`/api/v1/documents/${documentId}/content`, pdf);
    const job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
    assert.equal(await processNextJob(processing()), true);
    const detail = await c.lider!.get(`/api/v1/translations/${job}`);
    // Modelo de corpo pelo tipo do documento: histórico escolar.
    assert.match(detail.body.translation.notice, /Diagramação pelo modelo "Histórico escolar"/);

    const done = await c.lider!.post(`/api/v1/translations/${job}/accept`, {});
    assert.equal(done.status, 200, JSON.stringify(done.body).slice(0, 300));
    const final = await text((await c.lider!.raw('GET', `/api/v1/translations/${job}/final`)).rawPayload);
    assert.match(final, /CERTIFICO que me foi apresentado um documento redigido em português, que fielmente traduzo para o francês/);
    assert.match(final, /CERTIFIE/);
    assert.match(final, /Vila Esperança/);
    assert.doesNotMatch(final, /\{\{/);
  });
});
