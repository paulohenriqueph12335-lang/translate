import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { processNextJob, type ProcessingDeps } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import { confidentLanguage, type MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, submitReady, TestClient } from './test/helpers.js';

/**
 * Revisão automática (ADR-016): o sistema corrige o documento em vez de só apontar. Trecho fora do idioma de destino
 * é traduzido de novo; número e data alterados voltam ao formato da regra; tudo fica registrado na revisão.
 */
const PASSWORD = 'senha-de-teste-123';
const fixture = (name: string) => readFile(new URL(`../../../packages/core/fixtures/historico-escolar/${name}`, import.meta.url));

let app: FastifyInstance;
let pool: Pool;
let storage: ObjectStorage;
const c: Record<string, TestClient> = {};
const ids: Record<string, string> = {};

/** Na primeira chamada devolve o texto sem traduzir (falha típica de provedor); depois, francês, com os marcadores. */
let calls = 0;
const french = (text: string) => `Le texte de la traduction pour ce document ${(text.match(/\[\[[A-Z]\d+\]\]/g) ?? []).join(' ')}`.trim();
const machine: MachineTranslator = {
  name: 'libretranslate',
  external: false,
  translate: async (texts) => {
    calls += 1;
    return calls === 1 ? texts : texts.map(french);
  },
  isAvailable: async () => true,
};
const processing = (): ProcessingDeps => ({ pool, storage, workerId: 'teste', machine: { libretranslate: machine } });

async function login(email: string) {
  const client = new TestClient(app);
  assert.equal((await client.post('/api/v1/auth/login', { email, password: PASSWORD })).status, 200);
  return client;
}

before(async () => {
  ({ app, pool, storage } = await createTestApp('autoreview', { machine: { libretranslate: machine } }));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  c.director = await login('diretor@exemplo.test');
  await new TestClient(app).post('/api/v1/auth/signup', { email: 'op@exemplo.test', displayName: 'Operador', password: PASSWORD });
  ids.op = (await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = 'op@exemplo.test'`)).rows[0]!.id;
  await c.director.post(`/api/v1/users/${ids.op}/approve`);
  ids.team = (await c.director.post('/api/v1/teams', { name: 'Equipe A' })).body.team.id;
  await c.director.post(`/api/v1/teams/${ids.team}/members`, { userId: ids.op, role: 'operator' });
  c.op = await login('op@exemplo.test');

  const pdf = await fixture('original.pdf');
  const batch = await c.op.request('POST', '/api/v1/batches', {
    mode: 'technical',
    translation: { sourceLanguage: 'pt', targetLanguage: 'fr' },
    files: [{ name: 'historico.pdf', size: pdf.length }],
  });
  const documentId = batch.body.documents[0].id as string;
  await c.op.putContent(`/api/v1/documents/${documentId}/content`, pdf);
  ids.job = (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
});

after(async () => {
  await app.close();
  await pool.end();
});

type Block = { kind: string; text?: string; sourceText: string | null };

describe('revisão automática', () => {
  it('no processamento, o trecho que voltou sem tradução é traduzido de novo a partir do original', async () => {
    assert.equal(await processNextJob(processing()), true);
    const detail = await c.op!.get(`/api/v1/translations/${ids.job}`);
    const corrections = detail.body.draft.corrections as Array<{ code: string }>;
    assert.ok(
      corrections.some((item) => item.code === 'untranslated'),
      JSON.stringify(corrections.slice(0, 3)),
    );
    assert.match(detail.body.translation.notice, /Revisão automática: \d+ correção/);
    const leftovers = (detail.body.draft.content.blocks as Block[]).filter(
      (block) => block.text && block.sourceText && confidentLanguage(block.text) === 'pt',
    );
    assert.deepEqual(leftovers, []);
  });

  it('o botão corrige o que a pessoa deixou errado e grava uma revisão "review"', async () => {
    const detail = await c.op!.get(`/api/v1/translations/${ids.job}`);
    const content = detail.body.draft.content;
    const index = (content.blocks as Block[]).findIndex((block) => block.kind === 'paragraph' && block.sourceText);
    const broken = structuredClone(content);
    broken.blocks[index].text = 'This paragraph was left in English by mistake during the review of the document';
    const saved = await c.op!.request('PUT', `/api/v1/translations/${ids.job}/draft`, {
      baseRevision: detail.body.draft.revision,
      draft: broken,
    });
    assert.equal(saved.status, 200);

    const reviewed = await c.op!.post(`/api/v1/translations/${ids.job}/auto-review`);
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.ok(
      reviewed.body.corrections.some((item: { code: string; block: number }) => item.code === 'wrong_language' && item.block === index + 1),
    );
    const after = await c.op!.get(`/api/v1/translations/${ids.job}`);
    assert.equal(after.body.draft.origin, 'review');
    assert.equal(after.body.draft.revision, saved.body.revision + 1);
    assert.notEqual(after.body.draft.content.blocks[index].text, broken.blocks[index].text);
    const audit = await pool.query(`SELECT 1 FROM audit_events WHERE action = 'translation.auto_reviewed' AND target_id = $1`, [ids.job]);
    assert.equal(audit.rowCount, 1);

    // Sem nada a corrigir, não cria revisão nova.
    const again = await c.op!.post(`/api/v1/translations/${ids.job}/auto-review`);
    assert.equal(again.body.corrections.length, 0);
    assert.equal(again.body.revision, after.body.draft.revision);
  });

  it('"Pronta" passa pela revisão automática antes de seguir', async () => {
    const detail = await c.op!.get(`/api/v1/translations/${ids.job}`);
    const broken = structuredClone(detail.body.draft.content);
    const index = (broken.blocks as Block[]).findIndex((block) => block.kind === 'paragraph' && block.sourceText);
    broken.blocks[index].text = 'Este trecho ficou em português por engano durante a revisão do documento';
    await c.op!.request('PUT', `/api/v1/translations/${ids.job}/draft`, { baseRevision: detail.body.draft.revision, draft: broken });
    const submitted = await submitReady(c.op!, ids.job);
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.translation.status, 'awaiting_approval');
    const final = await c.op!.get(`/api/v1/translations/${ids.job}`);
    assert.equal(final.body.draft.origin, 'review');
    assert.notEqual(confidentLanguage(final.body.draft.content.blocks[index].text), 'pt');
  });
});
