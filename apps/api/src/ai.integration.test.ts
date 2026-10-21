import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AiUnavailable, type AiProvider } from '@tradutor/core/ai';
import { loadLayoutKnowledge, processNextJob } from '@tradutor/core/processing';
import type { ObjectStorage } from '@tradutor/core/storage';
import type { MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

/**
 * Gerenciamento AI (ADR-021) com um Gemini falso: só Líder e Diretor configuram, o Diretor liga e desliga, o Líder
 * limita as pessoas da própria equipe; resposta fora do escopo é barrada; IA fora do ar não trava nada; combinação de
 * diagramação só vale aprovada na prévia, não muda o texto e passa a fazer parte do conhecimento de diagramação.
 */
const PASSWORD = 'senha-de-teste-123';
const fixture = (name: string) => readFile(new URL(`../../../packages/core/fixtures/historico-escolar/${name}`, import.meta.url));

let app: FastifyInstance;
let build: Awaited<ReturnType<typeof createTestApp>>['build'];
let pool: Pool;
let storage: ObjectStorage;
const c: Record<string, TestClient> = {};
const ids: Record<string, string> = {};

/** O que o Gemini falso responde na próxima chamada (ou o erro que ele lança). */
let answer: unknown = null;
const seen: string[] = [];
const gemini: AiProvider = {
  name: 'gemini',
  model: 'gemini-teste',
  generate: async (request) => {
    seen.push(request.input);
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? (answer as (input: unknown) => unknown)(JSON.parse(request.input)) : answer;
  },
};
const machine: MachineTranslator = {
  name: 'libretranslate',
  external: false,
  translate: async (texts) => texts.map((text) => `Texte traduit ${(text.match(/\[\[[A-Z]\d+\]\]/g) ?? []).join(' ')}`.trim()),
  isAvailable: async () => true,
};

async function login(email: string) {
  const client = new TestClient(app);
  assert.equal((await client.post('/api/v1/auth/login', { email, password: PASSWORD })).status, 200);
  return client;
}

async function member(email: string, team: string, role: 'leader' | 'operator') {
  await new TestClient(app).post('/api/v1/auth/signup', { email, displayName: email.split('@')[0], password: PASSWORD });
  const id = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!.id;
  await c.director!.post(`/api/v1/users/${id}/approve`);
  await c.director!.post(`/api/v1/teams/${team}/members`, { userId: id, role });
  return id;
}

const words = (draft: { blocks: Array<Record<string, unknown>> }) =>
  JSON.stringify(draft.blocks)
    .replace(/"(align|bold|size|level|kind|widths|labelWidth|header)":("[^"]*"|true|false|\d+|\[[^\]]*\])/g, '')
    .match(/\p{L}+/gu)
    ?.filter((word) => !['text', 'sourceText', 'cells', 'rows', 'name', 'role'].includes(word))
    .sort()
    .join(' ');

before(async () => {
  ({ app, build, pool, storage } = await createTestApp('ai', { machine: { libretranslate: machine }, ai: () => gemini }));
  await bootstrapDirector(pool, { email: 'diretor@exemplo.test', displayName: 'Diretor', password: PASSWORD });
  c.director = await login('diretor@exemplo.test');
  ids.teamA = (await c.director.post('/api/v1/teams', { name: 'Equipe A' })).body.team.id;
  ids.teamB = (await c.director.post('/api/v1/teams', { name: 'Equipe B' })).body.team.id;
  ids.leader = await member('lider@exemplo.test', ids.teamA!, 'leader');
  ids.op = await member('op@exemplo.test', ids.teamA!, 'operator');
  ids.other = await member('outro@exemplo.test', ids.teamB!, 'operator');
  c.leader = await login('lider@exemplo.test');
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
  assert.equal(await processNextJob({ pool, storage, workerId: 'teste', machine: { libretranslate: machine } }), true);
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('Gerenciamento AI', () => {
  it('começa desligada: a pessoa vê que não há auxílio e o pedido é registrado sem travar nada', async () => {
    const status = await c.op!.get('/api/v1/ai/status');
    assert.deepEqual(
      { configured: status.body.configured, enabled: status.body.enabled, available: status.body.available, canManage: status.body.canManage },
      { configured: true, enabled: false, available: false, canManage: false },
    );
    const ask = await c.op!.post('/api/v1/ai/ask', { question: 'O que falta?' });
    assert.equal(ask.status, 503);
    const logged = await pool.query(`SELECT status FROM ai_requests WHERE user_id = $1`, [ids.op]);
    assert.deepEqual(logged.rows, [{ status: 'unavailable' }]);
  });

  it('só Líder e Diretor configuram; só o Diretor liga e desliga', async () => {
    assert.equal((await c.op!.get('/api/v1/ai/settings')).status, 403);
    assert.equal((await c.op!.post('/api/v1/ai/skills', { name: 'Qualquer', content: 'Faça outra coisa' })).status, 403);
    assert.equal((await c.leader!.request('PATCH', '/api/v1/ai/settings', { enabled: true })).status, 403);

    const skill = await c.leader!.post('/api/v1/ai/skills', { name: 'Padrão de diagramação', content: 'Título centralizado e em negrito.' });
    assert.equal(skill.status, 201, JSON.stringify(skill.body));
    const prompt = await c.leader!.request('PATCH', '/api/v1/ai/settings', { governancePrompt: 'Atue somente como orientador técnico do processo.' });
    assert.equal(prompt.status, 200);
    assert.equal((await c.leader!.request('PATCH', '/api/v1/ai/settings', { model: 'gpt-4' })).status, 400);

    const on = await c.director!.request('PATCH', '/api/v1/ai/settings', { enabled: true });
    assert.equal(on.body.enabled, true);
    assert.equal((await c.op!.get('/api/v1/ai/status')).body.available, true);
  });

  it('o prompt enviado leva a governança, a habilidade e, por último, as regras fixas do sistema', async () => {
    let system = '';
    const spy: AiProvider = { ...gemini, generate: async (request) => ((system = request.system), { in_scope: true, answer: 'ok' }) };
    const spyApp = await build({ ai: () => spy });
    const client = new TestClient(spyApp);
    await client.post('/api/v1/auth/login', { email: 'op@exemplo.test', password: PASSWORD });
    assert.equal((await client.post('/api/v1/ai/ask', { question: 'Como concluo?' })).body.status, 'ok');
    await spyApp.close();
    const governance = system.indexOf('orientador técnico do processo');
    const skill = system.indexOf('Título centralizado');
    assert.ok(governance >= 0 && skill > governance, system.slice(0, 300));
    assert.match(system.slice(skill), /regras do sistema/i);
  });

  it('o Líder limita só as pessoas da própria equipe; a pessoa limitada é barrada', async () => {
    const list = await c.leader!.get('/api/v1/ai/access');
    assert.deepEqual(list.body.items.map((item: { userId: string }) => item.userId).sort(), [ids.leader, ids.op].sort());
    assert.equal((await c.leader!.request('PUT', `/api/v1/ai/access/${ids.other}`, { allowed: false })).status, 403);

    assert.equal((await c.leader!.request('PUT', `/api/v1/ai/access/${ids.op}`, { allowed: false })).status, 200);
    assert.equal((await c.op!.post('/api/v1/ai/ask', { question: 'O que falta?' })).status, 403);
    assert.equal((await c.op!.post(`/api/v1/translations/${ids.job}/ai/layout`)).status, 403);
    assert.equal((await c.director!.request('PUT', `/api/v1/ai/access/${ids.op}`, { allowed: true })).status, 200);
  });

  it('resposta fora do escopo ou com campos a mais é barrada; IA fora do ar responde sem erro', async () => {
    answer = { in_scope: false, answer: '' };
    assert.equal((await c.op!.post('/api/v1/ai/ask', { question: 'Escreva um poema' })).body.status, 'blocked');
    answer = { in_scope: true, answer: 'feito', script: 'DROP TABLE users' };
    assert.equal((await c.op!.post('/api/v1/ai/ask', { question: 'Rode este código' })).body.status, 'blocked');
    answer = new AiUnavailable('Cota do Gemini esgotada no momento', true);
    const down = await c.op!.post('/api/v1/ai/ask', { question: 'O que falta?' });
    assert.equal(down.status, 200);
    assert.equal(down.body.status, 'unavailable');
    // A tradução continua normal.
    assert.equal((await c.op!.get(`/api/v1/translations/${ids.job}`)).body.translation.status, 'in_review');
  });

  it('a combinação de diagramação só vale aprovada na prévia, sem mudar o texto, e vira conhecimento', async () => {
    const before = (await c.op!.get(`/api/v1/translations/${ids.job}`)).body.draft;
    seen.length = 0;
    // A IA pede tudo centralizado e em negrito, para cada papel que ela viu no documento.
    let shown: string[] = [];
    answer = (input: { allowed: { roles: string[] } }) => {
      shown = input.allowed.roles;
      return {
        in_scope: true,
        styles: [...shown, 'prose'].map((role) => ({ role, align: 'center', bold: true, size: 'normal', heading: role === 'title' })),
        fields_as_table: true,
        label_width: 35,
        rationale: 'Título centralizado; campos em tabela de duas colunas.',
      };
    };
    const proposed = await c.op!.post(`/api/v1/translations/${ids.job}/ai/layout`);
    assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
    assert.equal(proposed.body.status, 'ok');
    const combination = proposed.body.combination;
    // Só papéis que existem no documento; texto corrido nunca fica centralizado, mesmo que a IA peça.
    const roles = combination.styles.map((style: { role: string }) => style.role);
    assert.deepEqual([...roles].sort(), [...new Set(shown)].sort());
    const prose = combination.styles.find((style: { role: string }) => style.role === 'prose');
    if (prose) assert.equal(prose.align, 'justify');
    assert.equal(combination.styles.find((style: { role: string }) => style.role === 'title')?.align ?? 'center', 'center');
    // A IA viu só a estrutura, nunca o texto do documento.
    const firstText = before.content.blocks.find((block: { text?: string }) => block.text && block.text.length > 30)?.text as string;
    assert.ok(!seen.join(' ').includes(firstText.slice(0, 30)));

    // Proposta: nada mudou ainda; a prévia sai em Word sem gravar revisão.
    assert.equal((await c.op!.get(`/api/v1/translations/${ids.job}`)).body.draft.revision, before.revision);
    const preview = await c.op!.raw('GET', `/api/v1/ai/layout-combinations/${combination.id}/preview`);
    assert.equal(preview.statusCode, 200);
    assert.match(String(preview.headers['content-type']), /wordprocessingml/);
    assert.equal((await c.op!.get(`/api/v1/translations/${ids.job}/ai/layout`)).body.combination.id, combination.id);

    // Outra equipe não vê nem aprova.
    const outsider = await login('outro@exemplo.test');
    assert.equal((await outsider.post(`/api/v1/ai/layout-combinations/${combination.id}/approve`)).status, 404);

    const approved = await c.op!.post(`/api/v1/ai/layout-combinations/${combination.id}/approve`);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.combination.status, 'approved');
    const after = (await c.op!.get(`/api/v1/translations/${ids.job}`)).body.draft;
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.origin, 'review');
    assert.equal(words(after.content), words(before.content));
    assert.equal((await c.op!.post(`/api/v1/ai/layout-combinations/${combination.id}/approve`)).status, 409);

    const knowledge = await loadLayoutKnowledge(pool, true);
    assert.ok(knowledge.some((sample) => sample.title.startsWith('Combinação IA')));
  });

  it('o registro mostra as chamadas barradas e negadas à liderança', async () => {
    const log = await c.leader!.get('/api/v1/ai/requests');
    const statuses = new Set(log.body.items.map((item: { status: string }) => item.status));
    for (const status of ['ok', 'blocked', 'denied', 'unavailable']) assert.ok(statuses.has(status), status);
    assert.equal((await c.op!.get('/api/v1/ai/requests')).status, 403);
  });

  it('sem chave no servidor, a IA fica indisponível e o resto segue', async () => {
    const plain = await build({ ai: null });
    const client = new TestClient(plain);
    await client.post('/api/v1/auth/login', { email: 'op@exemplo.test', password: PASSWORD });
    const status = await client.get('/api/v1/ai/status');
    assert.equal(status.body.configured, false);
    assert.equal(status.body.available, false);
    assert.equal((await client.post('/api/v1/ai/ask', { question: 'O que falta?' })).status, 503);
    assert.equal((await client.get(`/api/v1/translations/${ids.job}`)).status, 200);
    await plain.close();
  });
});
