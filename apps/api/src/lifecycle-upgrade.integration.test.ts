import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { processNextJob } from '@tradutor/core/processing';
import type { AiProvider } from '@tradutor/core/ai';
import { defaultRules, draftText, renderPlainDocx, type Draft, type MachineTranslator } from '@tradutor/core/translation';
import { bootstrapDirector } from './modules/identity/bootstrap.js';
import { createTranslationService, type TranslationService, type FinalArtifactReceipt } from './modules/translations/service.js';
import { createTranslatorNumberingService } from './modules/numbering/translator-numbering.js';
import type { AuthenticatedContext } from './modules/context.js';
import { AppError } from './http/errors.js';
import { createAiService } from './modules/ai/service.js';
import { createTestApp, TestClient } from './test/helpers.js';

const PASSWORD = 'senha-sintetica-upgrade-123';
const original: Draft = {
  sourceLanguage: 'fr',
  targetLanguage: 'es',
  documentType: 'Attestation',
  sourceTitle: 'ATTESTATION',
  blocks: [
    { kind: 'heading', text: 'ATTESTATION', level: 'title', align: 'center', sourceText: null, origin: 'human' },
    {
      kind: 'paragraph',
      text: 'Le présent document atteste la naissance de la personne dans la ville de Paris.',
      align: 'left',
      bold: false,
      size: 'normal',
      sourceText: null,
      origin: 'human',
    },
  ],
};
const calls: Array<{ from: string; to: string; texts: string[] }> = [];
const machine: MachineTranslator = {
  name: 'libretranslate',
  external: false,
  isAvailable: async () => true,
  async translate(texts, from, to) {
    calls.push({ from, to, texts });
    return texts.map((text) =>
      text === 'ATTESTATION'
        ? 'CERTIFICADO'
        : text.includes('présent document')
          ? 'El presente documento certifica el nacimiento de la persona en la ciudad de París.'
          : to === 'it'
            ? `Documento italiano ${text}`
            : `Documento español ${text}`,
    );
  },
};

let env: Awaited<ReturnType<typeof createTestApp>>;
let client: TestClient;
let service: TranslationService;
let ctx: AuthenticatedContext;
let documentBuffer: Buffer;
let sequence = 0;
const errorStatus = (status: number, reason?: string) => (error: unknown) =>
  error instanceof AppError && error.status === status && (!reason || error.details?.reason === reason);

before(async () => {
  env = await createTestApp('lifecycleupgrade', { machine: { libretranslate: machine } });
  await bootstrapDirector(env.pool, { email: 'diretor@upgrade.test', displayName: 'Diretor sintético', password: PASSWORD });
  client = new TestClient(env.app);
  assert.equal((await client.post('/api/v1/auth/login', { email: 'diretor@upgrade.test', password: PASSWORD })).status, 200);
  const id = (await env.pool.query<{ id: string }>(`SELECT id FROM users WHERE email='diretor@upgrade.test'`)).rows[0]!.id;
  ctx = {
    actor: { id, status: 'active', orgRole: 'director', memberships: new Map() },
    sessionId: randomUUID(),
    correlationId: 'lifecycle-upgrade-test',
  };
  service = createTranslationService({
    pool: env.pool,
    config: env.config,
    storage: env.storage,
    masks: async () => {
      throw new Error('Fixture simples não usa máscara');
    },
    numbering: createTranslatorNumberingService({ pool: env.pool, config: env.config }),
    machine: { libretranslate: machine },
  });
  documentBuffer = await renderPlainDocx(original, {
    look: defaultRules('simple', 'fr'),
    draft: false,
    statement: null,
    translatorName: null,
    issuedAt: new Date(),
  });
});
after(async () => {
  await env.app.close();
  await env.pool.end();
});

async function upload(options: { manual?: boolean; count?: number; inspectionMode?: 'all' | 'sample' } = {}) {
  sequence++;
  const fileBuffers = await Promise.all(
    Array.from({ length: options.count ?? 1 }, async (_, i) => {
      const zip = await JSZip.loadAsync(documentBuffer);
      zip.file('customXml/synthetic-seed.xml', `<seed>${sequence}-${i}</seed>`);
      return zip.generateAsync({ type: 'nodebuffer' });
    }),
  );
  await env.pool.query(`UPDATE translation_jobs SET run_after=now()+interval '1 hour' WHERE status='queued'`);
  const sent = await client.post('/api/v1/batches', {
    protocol: `REV-${sequence.toString().padStart(5, '0')}`,
    mode: 'simple',
    inspectionMode: options.inspectionMode ?? 'all',
    translation: { sourceLanguage: 'fr', targetLanguage: 'es' },
    files: fileBuffers.map((buffer, i) => ({
      name: `attestation-${sequence}-${i}.docx`,
      size: buffer.length,
    })),
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const docs = sent.body.documents as Array<{ id: string }>;
  for (const [i, doc] of docs.entries())
    assert.equal((await client.putContent(`/api/v1/documents/${doc.id}/content`, fileBuffers[i]!)).status, 200);
  const ids = (
    await env.pool.query<{ id: string }>(
      `SELECT j.id FROM translation_jobs j JOIN documents d ON d.id=j.document_id WHERE d.batch_id=$1 ORDER BY d.position`,
      [sent.body.batch.id],
    )
  ).rows.map((row) => row.id);
  if (options.manual) await env.pool.query(`UPDATE translation_jobs SET requested_mode='manual' WHERE id=ANY($1::uuid[])`, [ids]);
  for (const id of ids) {
    assert.equal(
      await processNextJob({ pool: env.pool, storage: env.storage, workerId: 'lifecycle-test', machine: { libretranslate: machine } }),
      true,
      id,
    );
    assert.equal((await service.get(ctx, id)).translation.status, 'in_review');
    await service.claim(ctx, id);
  }
  return { id: ids[0]!, ids, documentId: docs[0]!.id, batchId: sent.body.batch.id as string };
}

async function inspect(id: string) {
  const detail = await service.get(ctx, id);
  await service.setChecks(ctx, id, { keys: detail.checklist.map((item) => item.key), checked: true });
  return service.recordInspection(ctx, id, {
    decision: 'approved',
    failedStages: [],
    baseRevision: detail.translation.currentRevision!,
    scope: 'all',
  });
}
async function finish(id: string) {
  await inspect(id);
  return service.approve(ctx, id, { overrideReason: 'Conferência da fixture sintética de integração' });
}

describe('ciclo comparativo, idiomas arbitrários e marcos operacionais', () => {
  it('traduz FR→ES realmente no provedor sem IA e gera Word em espanhol', async () => {
    const { id } = await upload();
    const detail = await service.get(ctx, id);
    assert.equal(detail.translation.sourceLanguage, 'fr');
    assert.equal(detail.translation.targetLanguage, 'es');
    assert.equal(detail.translation.reviewLifecycle.inspectionRequired, true);
    assert.ok(calls.some((call) => call.from === 'fr' && call.to === 'es'));
    assert.match(draftText(detail.draft!.content), /certifica el nacimiento/);
    await assert.rejects(service.approve(ctx, id, {}), errorStatus(409, 'inspection_required'));
    await finish(id);
    const final = await service.openFinal(ctx, id, { trackDownload: false });
    const chunks: Buffer[] = [];
    for await (const chunk of final.stream) chunks.push(chunk as Buffer);
    const word = await JSZip.loadAsync(Buffer.concat(chunks));
    assert.match(await word.file('word/document.xml')!.async('string'), /certifica el nacimiento/);
    assert.match(final.name, /^REV-00001/);
  });

  it('três revisões reprovadas bloqueiam novas tentativas até um formato diferente registrado', async () => {
    const { id } = await upload();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const detail = await service.get(ctx, id);
      const rejected = await service.recordInspection(ctx, id, {
        decision: 'rejected',
        failedStages: ['layout', 'translation'],
        comment: `Conferir alinhamento e idioma na tentativa ${attempt}`,
        baseRevision: detail.translation.currentRevision!,
      });
      assert.equal(rejected.translation.reviewLifecycle.consecutiveRejections, attempt);
      if (attempt < 3) {
        await assert.rejects(
          service.recordInspection(ctx, id, { decision: 'approved', failedStages: [], baseRevision: detail.translation.currentRevision! }),
          errorStatus(409),
        );
        const content = structuredClone(detail.draft!.content);
        content.sourceTitle += ` revisão ${attempt}`;
        await service.saveDraft(ctx, id, { baseRevision: detail.translation.currentRevision!, draft: content });
      }
    }
    const blocked = await service.get(ctx, id);
    assert.equal(blocked.translation.reviewLifecycle.blocked, true);
    await assert.rejects(service.reprocess(ctx, id), errorStatus(409, 'review_attempts_exhausted'));
    await assert.rejects(
      service.saveDraft(ctx, id, { baseRevision: blocked.translation.currentRevision!, draft: blocked.draft!.content }),
      errorStatus(409, 'review_attempts_exhausted'),
    );
    await assert.rejects(
      service.recordInspection(ctx, id, { decision: 'approved', failedStages: [], baseRevision: blocked.translation.currentRevision! }),
      errorStatus(409, 'review_attempts_exhausted'),
    );
    await assert.rejects(
      service.registerNewFormat(ctx, id, {
        name: 'Novo formato',
        explanation: 'Ajustar a diagramação',
        baseRevision: blocked.translation.currentRevision!,
        draft: blocked.draft!.content,
      }),
      errorStatus(400),
    );
    const content = structuredClone(blocked.draft!.content);
    const paragraph = content.blocks.find((block) => block.kind === 'paragraph');
    if (paragraph?.kind === 'paragraph') paragraph.align = 'justify';
    const restored = await service.registerNewFormat(ctx, id, {
      name: 'Certificado alinhado',
      explanation: 'Parágrafos justificados após as reprovações de layout',
      baseRevision: blocked.translation.currentRevision!,
      draft: content,
    });
    assert.equal(restored.translation.reviewLifecycle.blocked, false);
    assert.equal(restored.translation.reviewLifecycle.formatGeneration, 2);
    assert.ok(restored.checklist.every((item) => !item.checked));
    await finish(id);
    const inspections = await service.inspectionHistory(ctx, id);
    assert.equal(inspections.filter((item) => item.decision === 'rejected').length, 3);
    const audits = await env.pool.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action,metadata FROM audit_events WHERE target_id=$1`,
      [id],
    );
    assert.ok(audits.rows.some((row) => row.action === 'translation.review_blocked'));
    assert.ok(audits.rows.some((row) => row.action === 'translation.format_registered' && row.metadata.formatGeneration === 2));
  });

  it('rejeição exige motivo e fase, revisão concorrente não é aprovada e outro usuário não altera', async () => {
    const { id, batchId } = await upload();
    const detail = await service.get(ctx, id);
    const baseRevision = detail.translation.currentRevision!;
    await assert.rejects(
      service.recordInspection(ctx, id, { decision: 'rejected', failedStages: [], comment: 'Falhou', baseRevision }),
      errorStatus(400),
    );
    const content = structuredClone(detail.draft!.content);
    content.sourceTitle += ' atualizada';
    await service.saveDraft(ctx, id, { baseRevision, draft: content });
    await assert.rejects(service.recordInspection(ctx, id, { decision: 'approved', failedStages: [], baseRevision }), errorStatus(409));
    const team = (
      await env.pool.query<{ id: string }>(`INSERT INTO teams(name,created_by) VALUES($1,$2) RETURNING id`, [
        `Equipe de autorização ${sequence}`,
        ctx.actor.id,
      ])
    ).rows[0]!.id;
    await env.pool.query('UPDATE batches SET team_id=$2,assigned_at=now(),assigned_by=$3 WHERE id=$1', [batchId, team, ctx.actor.id]);
    const stranger: AuthenticatedContext = {
      ...ctx,
      actor: { id: randomUUID(), status: 'active', orgRole: 'member', memberships: new Map() },
    };
    await assert.rejects(
      service.changeLanguages(stranger, id, { sourceLanguage: 'es', targetLanguage: 'fr', reason: 'Idioma digitado errado' }),
      errorStatus(404),
    );
    const teammate = { ...stranger, actor: { ...stranger.actor, memberships: new Map([[team, 'operator' as const]]) } };
    await assert.rejects(
      service.recordInspection(teammate, id, { decision: 'approved', failedStages: [], baseRevision: baseRevision + 1 }),
      errorStatus(403),
    );
  });

  it('reprovar ou devolver um documento pronto exige confirmação sem gravar alterações nas tentativas não confirmadas', async () => {
    async function state(id: string) {
      const [job, inspections, audits, notifications] = await Promise.all([
        env.pool.query(
          `SELECT status,current_revision,consecutive_rejections,review_comment,stage_checks,inspection_revision,
                  failed_stages,redo_count,updated_at,last_activity_at FROM translation_jobs WHERE id=$1`,
          [id],
        ),
        service.inspectionHistory(ctx, id),
        env.pool.query(`SELECT action,metadata FROM audit_events WHERE target_id=$1 ORDER BY occurred_at,id`, [id]),
        env.pool.query(`SELECT id FROM notifications WHERE translation_id=$1 ORDER BY id`, [id]),
      ]);
      return { job: job.rows[0], inspections, audits: audits.rows, notifications: notifications.rows };
    }

    for (const endpoint of ['inspections', 'return']) {
      const { id } = await upload();
      await inspect(id);
      const ready = await service.submit(ctx, id);
      assert.equal(ready.translation.status, 'awaiting_approval');
      const input = {
        ...(endpoint === 'inspections' ? { decision: 'rejected' } : {}),
        baseRevision: ready.translation.currentRevision!,
        failedStages: ['layout'],
        comment: 'Corrigir o alinhamento antes da conclusão',
      };
      const before = await state(id);
      for (const confirmation of [{}, { confirmCompleted: false }]) {
        const denied = await client.post(`/api/v1/translations/${id}/${endpoint}`, { ...input, ...confirmation });
        assert.equal(denied.status, 409, JSON.stringify(denied.body));
        assert.equal(denied.body.error.details.reason, 'completed_confirmation_required');
        assert.deepEqual(await state(id), before);
      }
      const returned = await client.post(`/api/v1/translations/${id}/${endpoint}`, { ...input, confirmCompleted: true });
      assert.equal(returned.status, 200, JSON.stringify(returned.body));
      assert.equal(returned.body.translation.status, 'in_review');
      assert.equal(returned.body.translation.reviewLifecycle.consecutiveRejections, 1);
      assert.deepEqual(returned.body.translation.reviewLifecycle.failedStages, ['layout']);
      const after = await state(id);
      assert.equal(after.inspections.filter((item) => item.decision === 'rejected').length, 1);
      assert.equal(after.audits.find((item) => item.action === 'translation.returned')?.metadata.confirmedCompleted, true);
    }

    const { id } = await upload();
    await finish(id);
    const completed = await service.get(ctx, id);
    const before = await state(id);
    for (const endpoint of ['inspections', 'return']) {
      const denied = await client.post(`/api/v1/translations/${id}/${endpoint}`, {
        ...(endpoint === 'inspections' ? { decision: 'rejected' } : {}),
        baseRevision: completed.translation.currentRevision!,
        failedStages: ['layout'],
        comment: 'A confirmação não permite devolver um documento concluído',
        confirmCompleted: true,
      });
      assert.equal(denied.status, 409, JSON.stringify(denied.body));
      assert.deepEqual(await state(id), before);
    }
  });

  it('corrigir par após conclusão exige confirmação, arquiva o Word anterior e reprocessa ES→IT', async () => {
    const { id } = await upload();
    await finish(id);
    const previous = (await env.pool.query<{ output_key: string }>('SELECT output_key FROM translation_jobs WHERE id=$1', [id])).rows[0]!
      .output_key;
    await assert.rejects(
      service.changeLanguages(ctx, id, { sourceLanguage: 'es', targetLanguage: 'it', reason: 'Origem e destino incorretos' }),
      errorStatus(409, 'completed_confirmation_required'),
    );
    await service.changeLanguages(ctx, id, {
      sourceLanguage: 'es',
      targetLanguage: 'it',
      reason: 'Origem e destino incorretos',
      confirmCompleted: true,
    });
    assert.equal(
      await processNextJob({ pool: env.pool, storage: env.storage, workerId: 'lifecycle-test', machine: { libretranslate: machine } }),
      true,
    );
    const revised = await service.get(ctx, id);
    assert.equal(revised.draft!.content.sourceLanguage, 'es');
    assert.equal(revised.draft!.content.targetLanguage, 'it');
    assert.ok(calls.some((call) => call.from === 'es' && call.to === 'it'));
    assert.equal(revised.translation.reviewLifecycle.lastInspectionRevision, null);
    assert.equal(
      (await env.pool.query('SELECT 1 FROM translation_completed_versions WHERE job_id=$1 AND output_key=$2', [id, previous])).rowCount,
      1,
    );
    assert.ok(await env.storage.head(previous));
    const audit = (
      await env.pool.query<{ metadata: { from: unknown; to: unknown; reason: string } }>(
        `SELECT metadata FROM audit_events WHERE target_id=$1 AND action='translation.languages_changed'`,
        [id],
      )
    ).rows[0]!;
    assert.deepEqual(audit.metadata.from, { sourceLanguage: 'fr', targetLanguage: 'es' });
    assert.deepEqual(audit.metadata.to, { sourceLanguage: 'es', targetLanguage: 'it' });
    await finish(id);
    const updated = (await env.pool.query<{ output_key: string }>('SELECT output_key FROM translation_jobs WHERE id=$1', [id])).rows[0]!
      .output_key;
    assert.notEqual(updated, previous);
  });

  it('sem IA e sem tradutor automático segue manualmente com FR→ES e preserva o par', async () => {
    const { id } = await upload({ manual: true });
    const detail = await service.get(ctx, id);
    assert.equal(detail.draft!.origin, 'manual');
    assert.equal(detail.draft!.content.sourceLanguage, 'fr');
    assert.equal(detail.draft!.content.targetLanguage, 'es');
    assert.match(detail.translation.notice ?? '', /manual/i);
    const content = structuredClone(detail.draft!.content);
    content.documentType = 'Certificado';
    content.sourceTitle = 'ATTESTATION';
    for (const block of content.blocks)
      if ('text' in block)
        block.text = block.text.includes('présent') ? 'El documento certifica el nacimiento de la persona.' : 'CERTIFICADO';
    await service.saveDraft(ctx, id, { baseRevision: detail.translation.currentRevision!, draft: content });
    assert.equal((await finish(id)).translation.status, 'approved');
  });

  it('prévia e leitura não contam como download; primeiro e último download e inatividade usam atividade real', async () => {
    const { id } = await upload();
    await finish(id);
    await env.pool.query(
      `UPDATE translation_jobs SET created_at=now()-interval '2 hours',approved_at=now()-interval '1 hour' WHERE id=$1`,
      [id],
    );
    await env.pool.query(`UPDATE translation_jobs SET last_activity_at=now()-interval '30 minutes' WHERE id=$1`, [id]);
    const beforeRead = await service.get(ctx, id);
    assert.equal(beforeRead.translation.timing.firstDownloadedAt, null);
    assert.equal(beforeRead.translation.timing.waitingDownloadSeconds! >= 3599, true);
    assert.equal(beforeRead.translation.timing.idleSeconds >= 1799, true);
    await service.preview(ctx, id);
    const opened = await service.openFinal(ctx, id, { trackDownload: false });
    opened.stream.destroy();
    const afterRead = await service.get(ctx, id);
    assert.equal(afterRead.translation.timing.lastActivityAt, beforeRead.translation.timing.lastActivityAt);
    await service.recordDownload(ctx, id, { format: 'pdf', delivery: 'zip' });
    const first = await service.get(ctx, id);
    assert.notEqual(first.translation.timing.firstDownloadedAt, null);
    assert.equal(first.translation.timing.downloadCount, 1);
    await service.recordDownload(ctx, id, { format: 'docx' });
    const second = await service.get(ctx, id);
    assert.equal(second.translation.timing.firstDownloadedAt, first.translation.timing.firstDownloadedAt);
    assert.equal(second.translation.timing.downloadCount, 2);
    assert.equal(Date.parse(second.translation.timing.lastActivityAt) > Date.parse(beforeRead.translation.timing.lastActivityAt), true);
    assert.equal(second.translation.timing.idleSeconds < beforeRead.translation.timing.idleSeconds, true);
    assert.equal(second.translation.timing.estimatedSeconds > 0, true);
    assert.equal(second.translation.timing.estimateBasis, 'comparable_history');
  });

  it('remessa por amostra só libera os demais após dez comparações da revisão vigente', async () => {
    const { ids } = await upload({ count: 20, inspectionMode: 'sample' });
    const outside = ids[19]!;
    await assert.rejects(service.approve(ctx, outside, {}), errorStatus(409, 'inspection_required'));
    for (const id of ids.slice(0, 10)) await inspect(id);
    const detail = await service.get(ctx, outside);
    assert.equal(detail.translation.reviewLifecycle.isSampleDocument, false);
    assert.equal(detail.translation.reviewLifecycle.sampleCovered, true);
    assert.equal(
      (await service.approve(ctx, outside, { overrideReason: 'Conferência por amostra autorizada' })).translation.status,
      'approved',
    );
    const inspected = await service.get(ctx, ids[0]!);
    const content = structuredClone(inspected.draft!.content);
    content.sourceTitle += ' nova revisão';
    await service.saveDraft(ctx, ids[0]!, { baseRevision: inspected.translation.currentRevision!, draft: content });
    assert.equal((await service.get(ctx, ids[18]!)).translation.reviewLifecycle.sampleCovered, false);
  });

  it('IA recebe pares atuais e uma sugestão antiga não altera a nova revisão nem reaproveita sua inspeção', async () => {
    const { id } = await upload();
    const inputs: Array<{ sourceLanguage: string; targetLanguage: string }> = [];
    const gemini: AiProvider = {
      name: 'gemini',
      model: 'gemini-teste',
      generate: async (request) => {
        inputs.push(JSON.parse(request.input));
        return {
          in_scope: true,
          styles: [],
          fields_as_table: false,
          label_width: 30,
          rationale: 'Estrutura preservada para o novo par de idiomas',
        };
      },
    };
    const ai = createAiService({ pool: env.pool, config: env.config, ai: () => gemini });
    await ai.updateSettings(ctx, { enabled: true });
    const previous = await ai.proposeLayout(ctx, id);
    assert.equal(previous.status, 'ok');
    assert.deepEqual(
      { sourceLanguage: inputs.at(-1)!.sourceLanguage, targetLanguage: inputs.at(-1)!.targetLanguage },
      { sourceLanguage: 'fr', targetLanguage: 'es' },
    );
    await service.changeLanguages(ctx, id, { sourceLanguage: 'it', targetLanguage: 'fr', reason: 'Conferência da origem em italiano' });
    assert.equal(
      await processNextJob({ pool: env.pool, storage: env.storage, workerId: 'lifecycle-test', machine: { libretranslate: machine } }),
      true,
    );
    await assert.rejects(ai.decide(ctx, previous.combination!.id, true), errorStatus(409));
    const current = await ai.proposeLayout(ctx, id);
    assert.equal(current.status, 'ok');
    assert.deepEqual(
      { sourceLanguage: inputs.at(-1)!.sourceLanguage, targetLanguage: inputs.at(-1)!.targetLanguage },
      { sourceLanguage: 'it', targetLanguage: 'fr' },
    );
    await inspect(id);
    await ai.decide(ctx, current.combination!.id, true);
    const changed = await service.get(ctx, id);
    assert.equal(changed.draft!.content.sourceLanguage, 'it');
    assert.equal(changed.draft!.content.targetLanguage, 'fr');
    assert.equal(changed.translation.reviewLifecycle.lastInspectionRevision, null);
    await assert.rejects(service.approve(ctx, id, { overrideReason: 'Teste' }), errorStatus(409, 'inspection_required'));
    await ai.updateSettings(ctx, { enabled: false });
  });

  it('reprocessamento de um documento pronto exige confirmação e preserva sua saída anterior', async () => {
    const { id } = await upload();
    await finish(id);
    await assert.rejects(service.reprocess(ctx, id), errorStatus(409, 'completed_confirmation_required'));
    const before = (await env.pool.query<{ output_key: string }>(`SELECT output_key FROM translation_jobs WHERE id=$1`, [id])).rows[0]!
      .output_key;
    await service.reprocess(ctx, id, { confirmCompleted: true, reason: 'Revisão do documento final solicitada pela liderança' });
    const archived = await env.pool.query(`SELECT 1 FROM translation_completed_versions WHERE job_id=$1 AND output_key=$2`, [id, before]);
    assert.equal(archived.rowCount, 1);
    assert.ok(await env.storage.head(before));
    assert.equal((await service.get(ctx, id)).translation.status, 'queued');
    await assert.rejects(service.openFinal(ctx, id), errorStatus(409));
  });

  it('o banco aceita todas as vinte direções entre os cinco idiomas', async () => {
    const { documentId } = await upload();
    const result = await env.pool.query(
      `INSERT INTO translation_jobs(document_id,source_language,target_language,requested_by,status)
       SELECT $1,source,target,$2,'cancelled' FROM unnest(ARRAY['pt','en','fr','it','es']) source
       CROSS JOIN unnest(ARRAY['pt','en','fr','it','es']) target WHERE source<>target RETURNING id`,
      [documentId, ctx.actor.id],
    );
    assert.equal(result.rowCount, 20);
  });

  it('entrega ZIP revalida acessos e grava contadores e auditorias de todos os arquivos em uma única transação', async () => {
    const { ids, batchId } = await upload({ count: 2 });
    for (const id of ids) await finish(id);
    const ordered = [...ids].sort();
    const finalId = ordered.at(-1)!;
    await env.pool.query(`CREATE FUNCTION reject_atomic_download_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (NEW.correlation_id='atomic-individual-failure' AND NEW.action='translation.downloaded' AND NEW.target_id='${finalId}')
           OR (NEW.correlation_id='atomic-bulk-failure' AND NEW.action='translation.archive_downloaded')
        THEN RAISE EXCEPTION 'synthetic atomic download failure'; END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER reject_atomic_download_fixture BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_atomic_download_fixture();`);
    const archiveInput = { format: 'docx' as const, delivery: 'zip' as const, archive: { batchId, bytes: 128 } };
    try {
      await assert.rejects(
        service.recordDownloads({ ...ctx, correlationId: 'atomic-individual-failure' }, [...ids].reverse(), archiveInput),
        /synthetic atomic download failure/,
      );
      await assert.rejects(
        service.recordDownloads({ ...ctx, correlationId: 'atomic-bulk-failure' }, ids, archiveInput),
        /synthetic atomic download failure/,
      );
    } finally {
      await env.pool.query('DROP TRIGGER reject_atomic_download_fixture ON audit_events;DROP FUNCTION reject_atomic_download_fixture();');
    }
    const untouched = await env.pool.query<{ download_count: number; first_downloaded_at: Date | null; last_downloaded_at: Date | null }>(
      `SELECT download_count,first_downloaded_at,last_downloaded_at FROM translation_jobs WHERE id=ANY($1::uuid[])`,
      [ids],
    );
    assert.equal(
      untouched.rows.every((row) => row.download_count === 0 && row.first_downloaded_at === null && row.last_downloaded_at === null),
      true,
    );
    assert.equal(
      (await env.pool.query(`SELECT 1 FROM audit_events WHERE action='translation.downloaded' AND target_id=ANY($1::text[])`, [ids]))
        .rowCount,
      0,
    );
    assert.equal(
      (await env.pool.query(`SELECT 1 FROM audit_events WHERE action='translation.archive_downloaded' AND target_id=$1`, [batchId]))
        .rowCount,
      0,
    );

    await env.pool.query(`UPDATE users SET status='suspended' WHERE id=$1`, [ctx.actor.id]);
    try {
      await assert.rejects(service.recordDownloads(ctx, ids, archiveInput), errorStatus(403));
    } finally {
      await env.pool.query(`UPDATE users SET status='active' WHERE id=$1`, [ctx.actor.id]);
    }
    await env.pool.query(`UPDATE translation_jobs SET annulled_at=now(),annulled_reason='Fixture de revogação de entrega' WHERE id=$1`, [
      finalId,
    ]);
    await assert.rejects(service.recordDownloads(ctx, ids, archiveInput), errorStatus(409));
    assert.equal(
      (
        await env.pool.query<{ total: number }>(`SELECT sum(download_count)::int AS total FROM translation_jobs WHERE id=ANY($1::uuid[])`, [
          ids,
        ])
      ).rows[0]!.total,
      0,
    );
    await env.pool.query(`UPDATE translation_jobs SET annulled_at=NULL,annulled_reason=NULL WHERE id=$1`, [finalId]);

    await service.recordDownloads(ctx, [ids[1]!, ids[0]!, ids[1]!], archiveInput);
    const delivered = await env.pool.query<{ download_count: number; first_downloaded_at: Date; last_downloaded_at: Date }>(
      `SELECT download_count,first_downloaded_at,last_downloaded_at FROM translation_jobs WHERE id=ANY($1::uuid[])`,
      [ids],
    );
    assert.equal(
      delivered.rows.every((row) => row.download_count === 1),
      true,
    );
    assert.equal(delivered.rows[0]!.first_downloaded_at.toISOString(), delivered.rows[1]!.first_downloaded_at.toISOString());
    assert.equal(
      (await env.pool.query(`SELECT 1 FROM audit_events WHERE action='translation.downloaded' AND target_id=ANY($1::text[])`, [ids]))
        .rowCount,
      2,
    );
    assert.equal(
      (await env.pool.query(`SELECT 1 FROM audit_events WHERE action='translation.archive_downloaded' AND target_id=$1`, [batchId]))
        .rowCount,
      1,
    );
  });

  it('uma entrega preparada antes da reaprovação ou troca de hash não é contabilizada como a versão nova', async () => {
    const { ids, batchId } = await upload({ count: 2 });
    for (const id of ids) await finish(id);
    async function prepare() {
      const expected: Record<string, FinalArtifactReceipt> = {};
      let bytes = 0;
      for (const id of ids) {
        const file = await service.openFinal(ctx, id, { trackDownload: false });
        expected[id] = file.receipt;
        for await (const chunk of file.stream) bytes += (chunk as Buffer).length;
      }
      return { expected, format: 'docx' as const, delivery: 'zip' as const, archive: { batchId, bytes } };
    }
    const prepared = await prepare();
    await service.reprocess(ctx, ids[0]!, {
      confirmCompleted: true,
      reason: 'Revisão solicitada enquanto a entrega anterior era preparada',
    });
    assert.equal(
      await processNextJob({ pool: env.pool, storage: env.storage, workerId: 'lifecycle-test', machine: { libretranslate: machine } }),
      true,
    );
    await finish(ids[0]!);
    const current = await service.get(ctx, ids[0]!);
    assert.equal(current.translation.currentRevision! > prepared.expected[ids[0]!]!.revision!, true);
    await assert.rejects(service.recordDownloads(ctx, ids, prepared), errorStatus(409, 'artifact_changed'));

    const updated = await prepare();
    const receipt = updated.expected[ids[0]!]!;
    await env.pool.query(`UPDATE translation_jobs SET output_sha256=decode(repeat('00',32),'hex') WHERE id=$1`, [ids[0]]);
    try {
      await assert.rejects(service.recordDownload(ctx, ids[0]!, { expected: receipt }), errorStatus(409, 'artifact_changed'));
    } finally {
      await env.pool.query(`UPDATE translation_jobs SET output_sha256=decode($2,'hex') WHERE id=$1`, [ids[0], receipt.outputSha256]);
    }
    const untouched = await env.pool.query<{ download_count: number; first_downloaded_at: Date | null }>(
      `SELECT download_count,first_downloaded_at FROM translation_jobs WHERE id=ANY($1::uuid[])`,
      [ids],
    );
    assert.equal(
      untouched.rows.every((row) => row.download_count === 0 && row.first_downloaded_at === null),
      true,
    );
    assert.equal(
      (await env.pool.query(`SELECT 1 FROM audit_events WHERE action='translation.downloaded' AND target_id=ANY($1::text[])`, [ids]))
        .rowCount,
      0,
    );

    await service.recordDownloads(ctx, ids, updated);
    const delivered = await env.pool.query<{ metadata: { outputKey: string; outputSha256: string; revision: number } }>(
      `SELECT metadata FROM audit_events WHERE action='translation.downloaded' AND target_id=$1`,
      [ids[0]],
    );
    assert.equal(delivered.rowCount, 1);
    assert.equal(delivered.rows[0]!.metadata.outputKey, receipt.outputKey);
    assert.equal(delivered.rows[0]!.metadata.outputSha256, receipt.outputSha256);
    assert.equal(delivered.rows[0]!.metadata.revision, receipt.revision);
  });
});
