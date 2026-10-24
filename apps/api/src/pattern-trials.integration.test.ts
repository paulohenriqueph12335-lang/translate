import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import JSZip from 'jszip';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Draft, MachineTranslator } from '@tradutor/core/translation';
import type { Config } from './config.js';
import { applyTrialPreset, createPatternTrialService } from './modules/patterns/trials.js';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

const PASSWORD = 'pattern-trials-test-password';
let app: FastifyInstance;
let pool: Pool;
let original: Buffer;
let config: Config;
const ids: Record<string, string> = {};
const clients: Record<string, TestClient> = {};
let current: any;
let generationCalls = 0;
const machine: MachineTranslator = {
  name: 'libretranslate',
  external: false,
  isAvailable: async () => true,
  translate: async (texts) => {
    generationCalls++;
    return texts.map(() => 'Hola, este documento confirma el ensayo de formato.');
  },
};
before(async () => {
  ({ app, pool, config } = await createTestApp('patterntrials', { machine: { libretranslate: machine } }));
  await bootstrapDirector(pool, { email: 'director-patterns@example.test', displayName: 'Diretor', password: PASSWORD });
  const director = (await pool.query<{ id: string; password_hash: string }>(`SELECT id,password_hash FROM users WHERE org_role='director'`))
    .rows[0]!;
  ids.director = director.id;
  for (const name of ['owner', 'leader', 'outsider'])
    ids[name] = (
      await pool.query<{ id: string }>(
        `INSERT INTO users(email,display_name,password_hash,status) VALUES($1,$2,$3,'active') RETURNING id`,
        [`${name}-patterns@example.test`, name, director.password_hash],
      )
    ).rows[0]!.id;
  ids.team = (
    await pool.query<{ id: string }>(`INSERT INTO teams(name,created_by) VALUES('Equipe ensaios',$1) RETURNING id`, [ids.director])
  ).rows[0]!.id;
  await pool.query(`INSERT INTO team_memberships(team_id,user_id,role,created_by) VALUES($1,$2,'operator',$4),($1,$3,'leader',$4)`, [
    ids.team,
    ids.owner,
    ids.leader,
    ids.director,
  ]);
  for (const name of ['director', 'owner', 'leader', 'outsider']) {
    clients[name] = new TestClient(app);
    assert.equal(
      (await clients[name]!.post('/api/v1/auth/login', { email: `${name}-patterns@example.test`, password: PASSWORD })).status,
      200,
    );
  }
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Bonjour, ceci est un essai synthétique. PRIVATE_SYNTHETIC_SOURCE_MARKER</w:t></w:r></w:p></w:body></w:document>',
  );
  original = await zip.generateAsync({ type: 'nodebuffer' });
});
after(async () => {
  await app?.close();
  await pool?.end();
});
const run = (client = clients.owner!, preset = 'source', data = original) =>
  client.putContent(
    `/api/v1/document-patterns/test?sourceLanguage=fr&targetLanguage=es&mode=simple&layoutPreset=${preset}`,
    data,
    { 'x-file-name': 'NOM_PRIVE_ORIGINAL.docx' },
    'POST',
  );
const inspect = (decision = 'rejected', extra: Record<string, unknown> = {}) =>
  clients.owner!.post(`/api/v1/document-patterns/trials/${current.id}/inspect`, {
    baseRevision: current.revision,
    decision,
    failedStages: decision === 'rejected' ? ['layout'] : [],
    comment: 'Ajustar alinhamento da diagramação',
    ...extra,
  });

describe('ensaio de formatação com revisão persistida, sem guardar documento', () => {
  it('gera Word, recupera o mesmo ensaio pelo digest e não cria revisão sem mudança real', async () => {
    const first = await run();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    current = first.body.trial;
    assert.ok(first.body.previewDocx);
    assert.equal(current.revision, 1);
    const second = await run();
    assert.equal(second.body.trial.id, current.id);
    assert.equal(second.body.trial.revision, 1);
    const sameLayout = await run(clients.owner!, 'left');
    assert.equal(sameLayout.body.trial.revision, 1);
    const outsider = await run(clients.outsider!);
    assert.equal(outsider.status, 200);
    assert.notEqual(outsider.body.trial.id, current.id);
  });
  it('nega outra pessoa, exige fases e motivo e rejeita revisão concorrente', async () => {
    const url = `/api/v1/document-patterns/trials/${current.id}`;
    assert.equal((await new TestClient(app).get(url)).status, 401);
    assert.equal((await clients.outsider!.get(url)).status, 404);
    assert.equal((await clients.outsider!.post(`${url}/inspect`, { baseRevision: 1, decision: 'approved', failedStages: [] })).status, 404);
    assert.equal((await clients.leader!.get(url)).status, 200);
    assert.equal((await clients.director!.get(url)).status, 200);
    assert.equal((await inspect('rejected', { failedStages: [] })).status, 400);
    assert.equal((await inspect('rejected', { comment: '' })).status, 400);
    assert.equal((await inspect('approved', { failedStages: ['translation'] })).status, 400);
    assert.equal((await inspect('rejected', { baseRevision: 99 })).status, 409);
  });
  it('registra as fases, bloqueia decisão repetida e mantém o contador ao repetir o mesmo resultado', async () => {
    const rejected = await inspect();
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    current = rejected.body.trial;
    assert.equal(current.consecutiveRejections, 1);
    assert.equal((await inspect()).status, 409);
    assert.equal((await inspect('approved')).status, 409);
    const same = await run();
    assert.equal(same.body.trial.revision, 1);
    assert.equal(same.body.trial.consecutiveRejections, 1);
    assert.equal(same.body.trial.decision, 'rejected');
  });
  it('aplica alterações reais no Word e bloqueia a quarta geração após três revisões reprovadas', async () => {
    const center = await run(clients.owner!, 'center');
    assert.equal(center.status, 200);
    current = center.body.trial;
    assert.equal(current.revision, 2);
    const word = await JSZip.loadAsync(Buffer.from(center.body.previewDocx, 'base64'));
    assert.match(await word.file('word/document.xml')!.async('string'), /<w:jc w:val="center"/);
    current = (await inspect()).body.trial;
    assert.equal(current.consecutiveRejections, 2);
    const justified = await run(clients.owner!, 'justify');
    assert.equal(justified.status, 200);
    current = justified.body.trial;
    assert.equal(current.revision, 3);
    const rejected = await inspect();
    assert.equal(rejected.status, 200);
    current = rejected.body.trial;
    assert.equal(current.blocked, true);
    assert.equal(current.consecutiveRejections, 3);
    const before = generationCalls;
    const blocked = await run(clients.owner!, 'left');
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.details.trial.id, current.id);
    assert.equal(generationCalls, before);
  });
  it('nome novo sem diferença estrutural não desbloqueia; formato real exige gerar e comparar de novo', async () => {
    const url = `/api/v1/document-patterns/trials/${current.id}/formats`;
    const input = {
      baseRevision: current.revision,
      name: 'Novo alinhamento',
      explanation: 'Parágrafos alinhados à esquerda para corrigir o ensaio',
      layoutPreset: 'justify',
    };
    assert.equal((await clients.owner!.post(url, input)).status, 400);
    assert.equal((await clients.owner!.post(url, { ...input, baseRevision: 2, layoutPreset: 'left' })).status, 409);
    const registered = await clients.owner!.post(url, { ...input, layoutPreset: 'left' });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    current = registered.body.trial;
    assert.equal(current.blocked, false);
    assert.equal(current.formatGeneration, 2);
    assert.equal(current.requiresRegeneration, true);
    assert.equal((await inspect('approved')).status, 409);
    const rerun = await run(clients.owner!, 'center');
    assert.equal(rerun.status, 200);
    current = rerun.body.trial;
    assert.equal(current.revision, 4);
    assert.equal(current.layoutPreset, 'left');
    assert.equal(current.requiresRegeneration, false);
    const word = await JSZip.loadAsync(Buffer.from(rerun.body.previewDocx, 'base64'));
    assert.match(await word.file('word/document.xml')!.async('string'), /<w:jc w:val="left"/);
    const approved = await inspect('approved');
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    current = approved.body.trial;
    assert.equal(current.consecutiveRejections, 0);
    assert.equal(current.decision, 'approved');
  });
  it('preserva trilha e estado entre sessões sem gravar binários, rascunho ou textos do arquivo', async () => {
    const again = new TestClient(app);
    await again.post('/api/v1/auth/login', { email: 'owner-patterns@example.test', password: PASSWORD });
    const state = await again.get(`/api/v1/document-patterns/trials/${current.id}`);
    assert.equal(state.status, 200);
    assert.equal(state.body.history.length, 4);
    assert.equal(state.body.history[0].decision, 'approved');
    const stored = await pool.query(
      `SELECT row_to_json(t) AS value FROM pattern_trials t UNION ALL SELECT row_to_json(r) FROM pattern_trial_reviews r UNION ALL SELECT row_to_json(f) FROM pattern_trial_formats f`,
    );
    assert.doesNotMatch(JSON.stringify(stored.rows), /PRIVATE_SYNTHETIC_SOURCE_MARKER|NOM_PRIVE_ORIGINAL|Hola, este documento|Bonjour/);
    const audit = await clients.leader!.get('/api/v1/audit-events?category=pattern');
    assert.equal(audit.status, 200);
    assert.ok(
      audit.body.items.some(
        (event: { action: string; severity: string; metadata: { consecutiveRejections: number } }) =>
          event.action === 'pattern.review_blocked' && event.severity === 'critical' && event.metadata.consecutiveRejections === 3,
      ),
    );
    assert.ok(audit.body.items.some((event: { action: string }) => event.action === 'pattern.format_registered'));
  });
  it('revalida o layout realmente regenerado e permite substituir um formato pendente sem beco sem saída', async () => {
    const trials = createPatternTrialService({ pool, config });
    const ctx = {
      actor: {
        id: ids.owner!,
        status: 'active' as const,
        orgRole: 'member' as const,
        memberships: new Map([[ids.team!, 'operator' as const]]),
      },
      correlationId: 'trial-layout-race',
      sessionId: 'test',
    };
    const source: Draft = {
      sourceLanguage: 'fr',
      targetLanguage: 'es',
      sourceTitle: 'Ensaio',
      documentType: 'Ensayo',
      blocks: [
        { kind: 'paragraph', text: 'Texto sintético', sourceText: null, origin: 'rules', align: 'left', bold: false, size: 'normal' },
      ],
    };
    const file = Buffer.from('synthetic-layout-race-only');
    const options = { sourceLanguage: 'fr' as const, targetLanguage: 'es' as const, mode: 'simple' as const };
    const started = await trials.begin(ctx, file, options);
    const generated = await trials.complete(ctx, started, source, applyTrialPreset(source, 'center'), 'center');
    const url = `/api/v1/document-patterns/trials/${generated.id}`;
    assert.equal(
      (
        await clients.owner!.post(`${url}/inspect`, {
          baseRevision: generated.revision,
          decision: 'rejected',
          failedStages: ['layout'],
          comment: 'Centralização incorreta',
        })
      ).status,
      200,
    );
    const pending = await clients.owner!.post(`${url}/formats`, {
      baseRevision: generated.revision,
      name: 'Restaurar origem',
      explanation: 'Restaurar alinhamento original da diagramação',
      layoutPreset: 'source',
    });
    assert.equal(pending.status, 200);
    const next = await trials.begin(ctx, file, options);
    // Simula a base recalculada pelo analisador/conhecimento durante a geração: ela passou a ser centralizada.
    const changedSource = applyTrialPreset(source, 'center');
    await assert.rejects(
      () => trials.complete(ctx, next, changedSource, changedSource, 'source'),
      (error: unknown) =>
        !!error &&
        typeof error === 'object' &&
        'details' in error &&
        (error.details as { reason: string }).reason === 'pattern_format_layout_unchanged',
    );
    const preserved = await clients.owner!.get(url);
    assert.equal(preserved.body.trial.requiresRegeneration, true);
    assert.equal(preserved.body.trial.revision, generated.revision);
    assert.equal(
      (await clients.owner!.post(`${url}/inspect`, { baseRevision: generated.revision, decision: 'approved', failedStages: [] })).status,
      409,
    );
    const alternative = await clients.owner!.post(`${url}/formats`, {
      baseRevision: generated.revision,
      name: 'Alinhar à esquerda',
      explanation: 'Substituir o formato pendente para mudar o layout final',
      layoutPreset: 'left',
    });
    assert.equal(alternative.status, 200, JSON.stringify(alternative.body));
    const retry = await trials.begin(ctx, file, options);
    const final = await trials.complete(ctx, retry, changedSource, applyTrialPreset(changedSource, 'left'), 'left');
    assert.equal(final.requiresRegeneration, false);
    assert.equal(final.revision, generated.revision + 1);
  });
});
