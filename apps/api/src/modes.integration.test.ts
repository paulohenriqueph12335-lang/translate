import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { processNextJob, type ProcessingDeps } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import { SKILL_GLOSSARY, seedSkillGlossary, type MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

/**
 * Modalidades (ADR-015): juramentada, certificada, técnica e simples, cada uma com suas etapas, regras por idioma de
 * destino, checklist obrigatório antes de "Pronta" e conclusão sem numeração fora da juramentada; glossário das skills.
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
  translate: async (texts) => texts.map((text) => `[FR] ${text}`),
  isAvailable: async () => true,
};
const processing = (): ProcessingDeps => ({ pool, storage, workerId: 'teste', machine: { libretranslate: machine } });

async function login(email: string) {
  const client = new TestClient(app);
  assert.equal((await client.post('/api/v1/auth/login', { email, password: PASSWORD })).status, 200);
  return client;
}

async function upload(name: string, seed: string, mode: string, targetLanguage: string) {
  const pdf = Buffer.concat([await fixture('original.pdf'), Buffer.from(`\n%${seed}`)]);
  const batch = await c.op!.request('POST', '/api/v1/batches', {
    mode,
    translation: { sourceLanguage: 'pt', targetLanguage },
    files: [{ name, size: pdf.length }],
  });
  assert.equal(batch.status, 201, JSON.stringify(batch.body));
  const documentId = batch.body.documents[0].id as string;
  assert.equal((await c.op!.putContent(`/api/v1/documents/${documentId}/content`, pdf)).status, 200);
  return (await pool.query<{ id: string }>('SELECT id FROM translation_jobs WHERE document_id = $1', [documentId])).rows[0]!.id;
}

before(async () => {
  ({ app, pool, storage } = await createTestApp('modes'));
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
  for (const name of ['lider', 'op']) c[name] = await login(`${name}@exemplo.test`);
});

after(async () => {
  await app.close();
  await pool.end();
});

type Overview = {
  canEdit: boolean;
  modes: Array<{
    mode: string;
    stages: Array<{ stage: string }>;
    languages: Array<{ target: string; customized: boolean; rules: Record<string, unknown> }>;
  }>;
};
const rulesOf = (overview: Overview, mode: string, target: string) =>
  overview.modes.find((item) => item.mode === mode)!.languages.find((item) => item.target === target)!;

describe('modalidades de tradução', () => {
  it('cada modalidade tem suas etapas e o padrão das skills por idioma de destino', async () => {
    const overview = (await c.op!.get('/api/v1/translation-profiles')).body as Overview;
    assert.equal(overview.canEdit, false);
    const stages = Object.fromEntries(overview.modes.map((item) => [item.mode, item.stages.map((stage) => stage.stage)]));
    assert.deepEqual(stages, {
      sworn: ['correction', 'translation', 'review'],
      certified: ['translation', 'layout', 'review'],
      technical: ['translation', 'layout', 'review'],
      simple: ['translation', 'review'],
    });
    assert.equal(rulesOf(overview, 'sworn', 'en').rules.font, 'Calibri Light');
    assert.equal(rulesOf(overview, 'sworn', 'fr').rules.fileSuffix, '-FRA');
    assert.equal(rulesOf(overview, 'sworn', 'it').rules.dates, 'as_original');
    assert.equal(rulesOf(overview, 'sworn', 'es').rules.visualElements, 'markers');
  });

  it('Supervisor ajusta e volta ao padrão; Operador não ajusta', async () => {
    const path = '/api/v1/translation-profiles/technical/es';
    const base = rulesOf((await c.lider!.get('/api/v1/translation-profiles')).body, 'technical', 'es').rules;
    assert.equal((await c.op!.request('PUT', path, { rules: { ...base, fontSize: 11 } })).status, 403);
    assert.equal((await c.lider!.request('PUT', path, { rules: { ...base, fontSize: 11 } })).status, 200);
    let entry = rulesOf((await c.op!.get('/api/v1/translation-profiles')).body, 'technical', 'es');
    assert.equal(entry.customized, true);
    assert.equal(entry.rules.fontSize, 11);
    assert.equal((await c.lider!.request('PUT', path, { rules: null })).status, 200);
    entry = rulesOf((await c.op!.get('/api/v1/translation-profiles')).body, 'technical', 'es');
    assert.equal(entry.customized, false);
    assert.equal(entry.rules.fontSize, 10);
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE action LIKE 'translation.profile_%' ORDER BY occurred_at`,
    );
    assert.deepEqual(
      audit.rows.map((row) => row.action),
      ['translation.profile_set', 'translation.profile_reset'],
    );
  });

  it('certificada: checklist de diagramação e revisão antes de "Pronta", conclusão sem numeração', async () => {
    const job = await upload('historico.pdf', 'certificada', 'certified', 'fr');
    assert.equal(await processNextJob(processing()), true);
    const detail = await c.op!.get(`/api/v1/translations/${job}`);
    assert.equal(detail.body.translation.translationMode, 'certified');
    const checklist = detail.body.checklist as Array<{ key: string; stage: string }>;
    assert.deepEqual([...new Set(checklist.map((item) => item.stage))].sort(), ['layout', 'review']);

    const early = await c.op!.post(`/api/v1/translations/${job}/submit`);
    assert.equal(early.status, 409);
    assert.equal(early.body.error.details.reason, 'checklist_incomplete');

    const keys = checklist.map((item) => item.key);
    assert.equal((await c.op!.request('PUT', `/api/v1/translations/${job}/checks`, { keys: keys.slice(1), checked: true })).status, 200);
    assert.equal((await c.op!.post(`/api/v1/translations/${job}/submit`)).status, 409);
    assert.equal((await c.op!.request('PUT', `/api/v1/translations/${job}/checks`, { keys: [keys[0]], checked: true })).status, 200);
    assert.equal((await c.op!.post(`/api/v1/translations/${job}/submit`)).body.translation.status, 'awaiting_approval');

    // Sem tradutor juramentado nem número: só a juramentada usa a máscara e a numeração.
    const done = await c.lider!.post(`/api/v1/translations/${job}/approve`, {});
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.translation.status, 'approved');
    assert.equal(done.body.translation.number, null);
    const file = await c.op!.raw('GET', `/api/v1/translations/${job}/final`);
    assert.equal(file.statusCode, 200);
    assert.match(String(file.headers['content-disposition']), /historico-FRA\.docx/);
  });

  it('juramentada exige a correção no checklist', async () => {
    const job = await upload('certidao.pdf', 'juramentada', 'sworn', 'en');
    assert.equal(await processNextJob(processing()), true);
    const detail = await c.op!.get(`/api/v1/translations/${job}`);
    const stages = new Set((detail.body.checklist as Array<{ stage: string }>).map((item) => item.stage));
    assert.deepEqual([...stages].sort(), ['correction', 'review']);
    // Marcadores no lugar de notas do tradutor: o rascunho não traz "Translator's note".
    assert.doesNotMatch(JSON.stringify(detail.body.draft ?? {}), /Translator's note/i);
  });

  it('glossário das skills organizado por idioma de destino, sem duplicar', async () => {
    const inserted = await seedSkillGlossary(pool);
    const expected = SKILL_GLOSSARY.reduce((sum, skill) => sum + skill.terms.length, 0);
    assert.ok(inserted > 0 && inserted <= expected);
    assert.equal(await seedSkillGlossary(pool), 0);
    for (const target of ['en', 'fr', 'it', 'es']) {
      const list = await c.op!.get(`/api/v1/glossary?sourceLanguage=pt&targetLanguage=${target}`);
      const items = list.body.items as Array<{ origin: string | null; targetLanguage: string }>;
      assert.ok(items.length > 0, target);
      assert.ok(items.every((item) => item.targetLanguage === target));
      assert.ok(items.some((item) => item.origin?.startsWith('Skill traducao-')));
    }
  });
});
