import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { processNextJob } from '@tradutor/core/processing';
import { BODY_MODELS, defaultRules, renderPlainDocx, type Draft, type MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTestApp, TestClient } from './test/helpers.js';

const password = 'escala-classificacao-teste-123';
const machine: MachineTranslator = {
  name: 'libretranslate',
  external: false,
  isAvailable: async () => true,
  translate: async (texts) =>
    texts.map((text) =>
      text.includes('NAISSANCE')
        ? 'ACTA DE NACIMIENTO'
        : text.includes('CONTRAT')
          ? 'CONTRATO'
          : 'El presente documento confirma los datos de la persona y la recepción del pago.',
    ),
};
let env: Awaited<ReturnType<typeof createTestApp>>;
let director: TestClient;
let sequence = 0;
const source: Draft = {
  sourceLanguage: 'fr',
  targetLanguage: 'es',
  sourceTitle: 'ACTE DE NAISSANCE',
  documentType: '',
  blocks: [
    { kind: 'heading', text: 'ACTE DE NAISSANCE', level: 'title', align: 'center', sourceText: null, origin: 'human' },
    {
      kind: 'paragraph',
      text: 'Le présent document confirme la naissance de la personne dans la ville de Paris et les données de son registre.',
      align: 'left',
      bold: false,
      size: 'normal',
      sourceText: null,
      origin: 'human',
    },
  ],
};
before(async () => {
  env = await createTestApp('scaleclassification', { machine: { libretranslate: machine } });
  await bootstrapDirector(env.pool, { email: 'directeur@scale.test', displayName: 'Diretor de teste de escala', password });
  director = new TestClient(env.app);
  assert.equal((await director.post('/api/v1/auth/login', { email: 'directeur@scale.test', password })).status, 200);
});
after(async () => {
  await env.app.close();
  await env.pool.end();
});
async function enqueue(count = 1, category?: string) {
  sequence++;
  const buffers = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const doc = structuredClone(source);
      doc.blocks.push({
        kind: 'paragraph',
        text: `Référence synthétique ${sequence}-${i}.`,
        align: 'left',
        bold: false,
        size: 'normal',
        sourceText: null,
        origin: 'human',
      });
      return renderPlainDocx(doc, { look: defaultRules('simple', 'fr'), draft: false, issuedAt: new Date() });
    }),
  );
  const created = await director.post('/api/v1/batches', {
    protocol: `SCALE-${String(sequence).padStart(5, '0')}`,
    mode: 'simple',
    useMask: false,
    inspectionMode: 'all',
    ...(category ? { documentCategory: category } : {}),
    translation: { sourceLanguage: 'fr', targetLanguage: 'es' },
    files: buffers.map((buffer, i) => ({ name: `original-${i}.docx`, size: buffer.length })),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  for (const [i, doc] of (created.body.documents as Array<{ id: string }>).entries())
    assert.equal((await director.putContent(`/api/v1/documents/${doc.id}/content`, buffers[i]!)).status, 200);
  const jobs = (
    await env.pool.query<{ id: string }>(
      `SELECT j.id FROM translation_jobs j JOIN documents d ON d.id=j.document_id
    WHERE d.batch_id=$1 ORDER BY d.position`,
      [created.body.batch.id],
    )
  ).rows.map((j) => j.id);
  return { batchId: created.body.batch.id as string, jobs };
}
const processing = (workerId = 'scale-worker') => ({
  pool: env.pool,
  storage: env.storage,
  machine: { libretranslate: machine },
  workerId,
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('tipos documentais e fluxo em escala', () => {
  it('oferece catálogo autenticado e classifica pelo original sem IA', async () => {
    assert.equal((await new TestClient(env.app).get('/api/v1/document-categories')).status, 401);
    const catalog = await director.get('/api/v1/document-categories');
    assert.equal(catalog.status, 200);
    assert.deepEqual(
      catalog.body.categories.map((item: { value: string }) => item.value),
      [...BODY_MODELS],
    );
    const { jobs } = await enqueue();
    assert.equal(await processNextJob(processing()), true);
    const detail = await director.get(`/api/v1/translations/${jobs[0]}`);
    assert.deepEqual(detail.body.translation.classification, {
      category: 'birth_certificate',
      label: 'Certidão de nascimento',
      suggestedCategory: 'birth_certificate',
      confidence: 95,
      basis: 'title',
      source: 'automatic',
      correctedAt: null,
    });
    const filtered = await director.get('/api/v1/translations?documentCategory=birth_certificate');
    assert.ok(filtered.body.items.some((j: { id: string }) => j.id === jobs[0]));
    const facets = await director.get('/api/v1/translation-facets');
    assert.ok(
      facets.body.documentCategories.some((c: { value: string; count: number }) => c.value === 'birth_certificate' && c.count >= 1),
    );
  });
  it('preserva escolha humana e audita correção, com confirmação após pronto/concluído', async () => {
    const { jobs } = await enqueue(1, 'invoice');
    const id = jobs[0]!;
    assert.equal(await processNextJob(processing()), true);
    let detail = await director.get(`/api/v1/translations/${id}`);
    assert.equal(detail.body.translation.classification.category, 'invoice');
    assert.equal(detail.body.translation.classification.suggestedCategory, 'birth_certificate');
    assert.equal(detail.body.translation.classification.source, 'human');
    assert.equal(
      (
        await director.request('PUT', `/api/v1/translations/${id}/classification`, {
          category: 'contract',
          reason: 'Correção solicitada pela equipe de conferência.',
        })
      ).status,
      200,
    );
    assert.equal((await director.post(`/api/v1/translations/${id}/claim`)).status, 200);
    detail = await director.get(`/api/v1/translations/${id}`);
    assert.equal(
      (
        await director.post(`/api/v1/translations/${id}/inspections`, {
          baseRevision: detail.body.draft.revision,
          decision: 'approved',
          scope: 'all',
        })
      ).status,
      200,
    );
    assert.equal((await director.post(`/api/v1/translations/${id}/submit`)).status, 200);
    const rejected = await director.request('PUT', `/api/v1/translations/${id}/classification`, {
      category: 'diploma',
      reason: 'Correção do tipo documental após conferência.',
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error.details.reason, 'completed_confirmation_required');
    assert.equal(
      (
        await director.request('PUT', `/api/v1/translations/${id}/classification`, {
          category: 'diploma',
          reason: 'Correção do tipo documental após conferência.',
          confirmCompleted: true,
        })
      ).status,
      200,
    );
    detail = await director.get(`/api/v1/translations/${id}`);
    if (detail.body.translation.reviewLifecycle.lastInspectionRevision !== detail.body.draft.revision)
      assert.equal(
        (
          await director.post(`/api/v1/translations/${id}/inspections`, {
            baseRevision: detail.body.draft.revision,
            decision: 'approved',
            scope: 'all',
          })
        ).status,
        200,
      );
    const approved = await director.post(`/api/v1/translations/${id}/approve`, {
      overrideReason: 'Conferência sintética do conteúdo para testar preservação do Word.',
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const artifact = (await env.pool.query('SELECT output_key,current_revision,approved_at FROM translation_jobs WHERE id=$1', [id]))
      .rows[0];
    assert.equal(
      (
        await director.request('PUT', `/api/v1/translations/${id}/classification`, {
          category: 'identity',
          reason: 'Organização do arquivo concluído.',
          confirmCompleted: true,
        })
      ).status,
      200,
    );
    assert.deepEqual(
      (await env.pool.query('SELECT output_key,current_revision,approved_at FROM translation_jobs WHERE id=$1', [id])).rows[0],
      artifact,
    );
    const audits = (
      await env.pool.query(
        `SELECT metadata FROM audit_events WHERE target_id=$1 AND action='translation.classification_changed' ORDER BY id`,
        [id],
      )
    ).rows;
    assert.equal(audits.length, 3);
    assert.equal(audits[0].metadata.from, 'invoice');
    assert.equal(audits[0].metadata.to, 'contract');
    assert.equal(audits[2].metadata.confirmedCompleted, true);
    assert.equal(
      (await director.get(`/api/v1/translations?documentCategory=identity`)).body.items.some((j: { id: string }) => j.id === id),
      true,
    );
    assert.equal((await director.get('/api/v1/translations?documentCategory=invalid')).status, 400);
  });
  it('ensaia o modelo escolhido e herda tipo e configuração de máscara em outro par', async () => {
    const buffer = await renderPlainDocx(source, { look: defaultRules('simple', 'fr'), draft: false, issuedAt: new Date() });
    const trial = await director.putContent(
      '/api/v1/document-patterns/test?sourceLanguage=fr&targetLanguage=es&mode=simple&documentCategory=contract',
      buffer,
      { 'x-file-name': 'modelo-sintetico.docx' },
      'POST',
    );
    assert.equal(trial.status, 200, JSON.stringify(trial.body));
    assert.equal(trial.body.bodyModel, 'contract');
    assert.ok(trial.body.previewDocx.length > 1000);
    const { jobs } = await enqueue(1, 'diploma');
    const document = (await env.pool.query('SELECT document_id FROM translation_jobs WHERE id=$1', [jobs[0]])).rows[0].document_id;
    const started = await director.post(`/api/v1/documents/${document}/translations`, {
      sourceLanguage: 'fr',
      targetLanguage: 'it',
      mode: 'manual',
    });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    assert.equal(started.body.translation.useMask, false);
    assert.equal(started.body.translation.classification.category, 'diploma');
    // Retira apenas estas duas fixtures da fila, pois este caso verifica criação/herança, não processamento.
    await env.pool.query("UPDATE translation_jobs SET status='cancelled' WHERE document_id=$1", [document]);
  });
  it('processa remessa grande com workers concorrentes sem repetir ou pular documentos', async () => {
    const { jobs } = await enqueue(30);
    await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        while (await processNextJob(processing(`parallel-${i}`))) {}
      }),
    );
    const rows = (
      await env.pool.query(
        `SELECT j.id,j.status,j.attempts,j.current_revision,j.classification_confidence,j.stage_checks,
      (SELECT count(*)::int FROM translation_drafts r WHERE r.job_id=j.id) AS drafts,
      (SELECT count(*)::int FROM audit_events a WHERE a.target_id=j.id::text AND a.action='translation.drafted') AS drafted_events,
      (SELECT count(*)::int FROM audit_events a WHERE a.target_id=j.id::text AND a.action='translation.machine_translated') AS machine_events
      FROM translation_jobs j WHERE id=ANY($1::uuid[])`,
        [jobs],
      )
    ).rows;
    assert.equal(rows.length, 30);
    for (const row of rows) {
      assert.equal(row.status, 'in_review');
      assert.equal(row.attempts, 1);
      assert.equal(row.current_revision, 1);
      assert.equal(row.drafts, 1);
      assert.equal(row.drafted_events, 1);
      assert.equal(row.machine_events, 1);
      assert.ok(Object.keys(row.stage_checks).length > 0);
      assert.equal(row.classification_confidence, 95);
    }
  });
  it('descarta resultado antigo após outro lease com o mesmo workerId, sem duplicar revisão ou auditoria', async () => {
    const { jobs } = await enqueue();
    const id = jobs[0]!;
    const entered = deferred(),
      release = deferred();
    let first = true;
    const storage = {
      ...env.storage,
      get: async (key: string) => {
        if (first) {
          first = false;
          entered.resolve();
          await release.promise;
        }
        return env.storage.get(key);
      },
    };
    const stale = processNextJob({ ...processing('same-worker'), storage });
    await entered.promise;
    await env.pool.query("UPDATE translation_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1", [id]);
    assert.equal(await processNextJob(processing('same-worker')), true);
    release.resolve();
    await stale;
    const row = (
      await env.pool.query(
        `SELECT status,current_revision,attempts,
      (SELECT count(*)::int FROM translation_drafts WHERE job_id=$1) drafts,
      (SELECT count(*)::int FROM audit_events WHERE target_id=$1::text AND action='translation.machine_translated') events
      FROM translation_jobs WHERE id=$1`,
        [id],
      )
    ).rows[0];
    assert.deepEqual(row, { status: 'in_review', current_revision: 1, attempts: 2, drafts: 1, events: 1 });
  });
  it('tentativa expirada que falha não duplica erro e notificação após esgotamento do lease', async () => {
    const { jobs } = await enqueue();
    const id = jobs[0]!;
    await env.pool.query('UPDATE translation_jobs SET max_attempts=1 WHERE id=$1', [id]);
    const entered = deferred(),
      release = deferred();
    const storage = {
      ...env.storage,
      get: async () => {
        entered.resolve();
        await release.promise;
        throw new Error('Falha sintética de leitura após perda do lease');
      },
    };
    const stale = processNextJob({ ...processing('stale-failure'), storage });
    await entered.promise;
    await env.pool.query("UPDATE translation_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1", [id]);
    assert.equal(await processNextJob(processing('replacement')), false);
    release.resolve();
    await stale;
    const row = (
      await env.pool.query(
        `SELECT status,failure_code,
      (SELECT count(*)::int FROM audit_events WHERE target_id=$1::text AND action='translation.failed') events,
      (SELECT count(*)::int FROM notifications WHERE translation_id=$1::uuid AND kind='translation_failed') notices
      FROM translation_jobs WHERE id=$1::uuid`,
        [id],
      )
    ).rows[0];
    assert.equal(row.status, 'failed');
    assert.equal(row.failure_code, 'attempts_exhausted');
    assert.equal(row.events, 1);
    assert.equal(row.notices, 1);
  });
  it('uma falha transitória agenda nova tentativa e não publica rascunho parcial', async () => {
    const { jobs } = await enqueue();
    const id = jobs[0]!;
    let fail = true;
    const storage = {
      ...env.storage,
      get: async (key: string) => {
        if (fail) {
          fail = false;
          throw new Error('Leitura sintética interrompida');
        }
        return env.storage.get(key);
      },
    };
    await processNextJob({ ...processing('retry-worker'), storage });
    let row = (
      await env.pool.query(
        `SELECT status,attempts,current_revision,
      (SELECT count(*)::int FROM translation_drafts WHERE job_id=$1) drafts FROM translation_jobs WHERE id=$1`,
        [id],
      )
    ).rows[0];
    assert.deepEqual(row, { status: 'queued', attempts: 1, current_revision: null, drafts: 0 });
    const retry = (
      await env.pool.query("SELECT metadata FROM audit_events WHERE target_id=$1 AND action='translation.retry_scheduled'", [id])
    ).rows;
    assert.equal(retry.length, 1);
    assert.equal(retry[0].metadata.attempt, 1);
    assert.equal(retry[0].metadata.retryAfterSeconds, 60);
    await env.pool.query('UPDATE translation_jobs SET run_after=now() WHERE id=$1', [id]);
    await processNextJob({ ...processing('retry-worker'), storage });
    row = (
      await env.pool.query(
        `SELECT status,attempts,current_revision,
      (SELECT count(*)::int FROM translation_drafts WHERE job_id=$1) drafts FROM translation_jobs WHERE id=$1`,
        [id],
      )
    ).rows[0];
    assert.deepEqual(row, { status: 'in_review', attempts: 2, current_revision: 1, drafts: 1 });
  });
  it('uma nova revisão de documento legado exige a conferência do fluxo atual', async () => {
    const { jobs } = await enqueue();
    const id = jobs[0]!;
    await processNextJob(processing());
    await env.pool.query('UPDATE translation_jobs SET inspection_required=false WHERE id=$1', [id]);
    assert.equal((await director.post(`/api/v1/translations/${id}/claim`)).status, 200);
    const detail = await director.get(`/api/v1/translations/${id}`);
    const content = structuredClone(detail.body.draft.content) as Draft;
    const block = content.blocks.find((b) => b.kind === 'paragraph');
    assert.ok(block && block.kind === 'paragraph');
    block.align = 'justify';
    const saved = await director.request('PUT', `/api/v1/translations/${id}/draft`, {
      baseRevision: detail.body.draft.revision,
      draft: content,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const current = await director.get(`/api/v1/translations/${id}`);
    assert.equal(current.body.translation.reviewLifecycle.inspectionRequired, true);
    assert.equal(current.body.translation.reviewLifecycle.lastInspectionRevision, null);
    const approval = await director.post(`/api/v1/translations/${id}/approve`, {
      overrideReason: 'Tentativa sintética de omitir conferência.',
    });
    assert.equal(approval.status, 409);
    assert.equal(approval.body.error.details.reason, 'inspection_required');
  });
});
