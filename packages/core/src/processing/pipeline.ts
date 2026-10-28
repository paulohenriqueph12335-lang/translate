import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { recordAudit } from '../db/audit.js';
import { notify } from '../db/notifications.js';
import { withTransaction, type Queryable } from '../db/pool.js';
import { insertDraft } from '../crypto/drafts.js';
import { lookupMemory } from '../crypto/memory.js';
import { sealNullable } from '../crypto/values.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import type { GlossaryTerm } from '../translation/checks.js';
import type { Draft, Language } from '../translation/draft.js';
import { suggestDocumentCategory, type BodyModel } from '../translation/body-models.js';
import type { MemoryLookup } from '../translation/machine/machine-draft.js';
import { checklistOf, loadRules, type Mode } from '../translation/profiles.js';
import type { MachineProviderName, MachineProviderSetting, MachineTranslator } from '../translation/machine/providers.js';
import { draftFromFile, extractFile } from './analyze.js';
import { loadLayoutKnowledge } from './knowledge.js';
import { proposeLayoutInBackground, type AiFactory } from '../ai/store.js';

/** Dependências do processamento. */
export interface ProcessingDeps {
  pool: Pool;
  storage: ObjectStorage;
  /** Provedores gratuitos configurados no ambiente (ADR-008). */
  machine?: Partial<Record<MachineProviderName, MachineTranslator>>;
  /** IA de apoio (ADR-021): propõe diagramação em segundo plano quando o sistema trava; sem ela, nada muda. */
  ai?: AiFactory;
  workerId: string;
  /** Duração do lease de um trabalho em processamento. */
  leaseMs?: number;
  log?: (level: 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>) => void;
}

interface ClaimedJob {
  id: string;
  document_id: string;
  source_language: Language;
  target_language: Language;
  /** 'claude' só existe em trabalhos antigos (ADR-010) e é tratado como 'auto'. */
  requested_mode: 'auto' | 'manual' | 'claude';
  /** Modalidade (ADR-015): define as regras de datas, números e elementos visuais. */
  translation_mode: Mode;
  attempts: number;
  max_attempts: number;
  leaseOwner: string;
  document_category: BodyModel | null;
  classification_source: 'automatic' | 'human';
}

/** Erro definitivo: o trabalho falha sem novas tentativas. */
class PermanentFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function jobTeam(db: Queryable, jobId: string) {
  return (
    await db.query<{ team_id: string | null }>(
      `SELECT b.team_id FROM translation_jobs j JOIN documents d ON d.id=j.document_id JOIN batches b ON b.id=d.batch_id WHERE j.id=$1`,
      [jobId],
    )
  ).rows[0]?.team_id;
}

const SUPPORTED_FORMATS = new Set(['pdf', 'jpeg', 'png', 'docx', 'pptx']);
const backoffMs = (attempt: number) => Math.min(30 * 60_000, 2 ** attempt * 30_000);

/**
 * Reserva o próximo trabalho da fila (ou um cujo lease venceu). `SKIP LOCKED` permite vários workers em paralelo.
 * Trabalhos que esgotaram as tentativas são marcados como falha em vez de reservados.
 */
export async function claimNextJob(deps: ProcessingDeps): Promise<ClaimedJob | null> {
  const leaseMs = deps.leaseMs ?? 10 * 60_000;
  return withTransaction(deps.pool, async (db) => {
    const candidate = await db.query<ClaimedJob>(
      `SELECT id, document_id, source_language, target_language, requested_mode, translation_mode, attempts, max_attempts,
              document_category,classification_source
         FROM translation_jobs
        WHERE consecutive_rejections < 3 AND ((status = 'queued' AND run_after <= now()) OR (status = 'processing' AND lease_expires_at < now()))
        ORDER BY run_after, created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );
    const job = candidate.rows[0];
    if (!job) return null;
    if (job.attempts >= job.max_attempts) {
      await db.query(
        `UPDATE translation_jobs SET status = 'failed', failure_code = 'attempts_exhausted', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
          WHERE id = $1`,
        [job.id],
      );
      const teamId = await jobTeam(db, job.id);
      await recordAudit(db, {
        actorUserId: null,
        action: 'translation.failed',
        targetType: 'translation',
        targetId: job.id,
        ...(teamId ? { teamId } : {}),
        metadata: { code: 'attempts_exhausted' },
      });
      await notifyFailure(db, job.id, 'attempts_exhausted');
      return null;
    }
    const leaseOwner = `${deps.workerId}:${randomUUID()}`;
    await db.query(
      `UPDATE translation_jobs SET status = 'processing', attempts = attempts + 1, lease_owner = $2,
              lease_expires_at = now() + make_interval(secs => $3), updated_at = now()
        WHERE id = $1`,
      [job.id, leaseOwner, leaseMs / 1000],
    );
    return { ...job, attempts: job.attempts + 1, leaseOwner };
  });
}

/** Processa um trabalho, se houver. Retorna `true` quando algum trabalho foi tratado. */
export async function processNextJob(deps: ProcessingDeps) {
  const job = await claimNextJob(deps);
  if (!job) return false;
  // Documento longo (OCR, muitos trechos) passa do lease: renova enquanto processa, para outro worker não assumir.
  const leaseMs = deps.leaseMs ?? 10 * 60_000;
  const renewal = setInterval(() => {
    void deps.pool
      .query(
        `UPDATE translation_jobs SET lease_expires_at = now() + make_interval(secs => $3)
          WHERE id = $1 AND status = 'processing' AND lease_owner = $2`,
        [job.id, job.leaseOwner, leaseMs / 1000],
      )
      .catch(() => undefined);
  }, leaseMs / 3);
  renewal.unref();
  try {
    await processJob(deps, job);
  } catch (error) {
    const permanent = error instanceof PermanentFailure;
    const exhausted = job.attempts >= job.max_attempts;
    const code = permanent ? error.code : 'processing_error';
    deps.log?.(permanent ? 'warn' : 'error', 'Falha no processamento da tradução', {
      jobId: job.id,
      code,
      ...(permanent ? {} : { error: String(error) }),
    });
    if (permanent || exhausted) {
      await withTransaction(deps.pool, async (db) => {
        const failed = await db.query(
          `UPDATE translation_jobs SET status = 'failed', failure_code = $3, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
          WHERE id = $1 AND status='processing' AND lease_owner = $2 RETURNING id`,
          [job.id, job.leaseOwner, code],
        );
        // A tentativa perdeu o lease: não registra erro nem avisa sobre um trabalho que outra tentativa já concluiu.
        if (!failed.rowCount) return;
        const teamId = await jobTeam(db, job.id);
        await recordAudit(db, {
          actorUserId: null,
          action: 'translation.failed',
          targetType: 'translation',
          targetId: job.id,
          ...(teamId ? { teamId } : {}),
          metadata: { code },
        });
        await notifyFailure(db, job.id, code);
      });
    } else {
      await requeue(deps, job, code);
    }
  } finally {
    clearInterval(renewal);
  }
  return true;
}

async function requeue(deps: ProcessingDeps, job: ClaimedJob, code: string) {
  await withTransaction(deps.pool, async (db) => {
    const retried = await db.query(
      `UPDATE translation_jobs SET status = 'queued', failure_code = $3, run_after = now() + make_interval(secs => $4),
            lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = $1 AND status='processing' AND lease_owner = $2 RETURNING id`,
      [job.id, job.leaseOwner, code, backoffMs(job.attempts) / 1000],
    );
    if (!retried.rowCount) return;
    const teamId = await jobTeam(db, job.id);
    await recordAudit(db, {
      actorUserId: null,
      action: 'translation.retry_scheduled',
      targetType: 'translation',
      targetId: job.id,
      ...(teamId ? { teamId } : {}),
      metadata: { code, attempt: job.attempts, maxAttempts: job.max_attempts, retryAfterSeconds: backoffMs(job.attempts) / 1000 },
    });
  });
}

async function readAll(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Etapas: original → extração → layout → rascunho (memória e tradução gratuita) → checagens → revisão humana. Nunca aprova nada. */
async function processJob(deps: ProcessingDeps, job: ClaimedJob) {
  const { pool } = deps;
  const context = await pool.query<{
    status: string;
    name: string;
    tags: string[];
    batch_id: string;
    owner_id: string;
    team_id: string | null;
    assignee_id: string | null;
    object_key: string | null;
    format: string | null;
  }>(
    `SELECT d.status, d.display_name AS name, d.tags, b.id AS batch_id, b.owner_id, b.team_id, v.object_key, v.format,
            (SELECT assignee_id FROM translation_jobs WHERE id = $2) AS assignee_id
       FROM documents d
       JOIN batches b ON b.id = d.batch_id
       LEFT JOIN document_versions v ON v.document_id = d.id AND v.kind = 'original'
      WHERE d.id = $1`,
    [job.document_id, job.id],
  );
  const doc = context.rows[0];
  if (!doc || doc.status !== 'stored' || !doc.object_key || !doc.format) throw new PermanentFailure('document_unavailable');
  if (!SUPPORTED_FORMATS.has(doc.format)) throw new PermanentFailure('unsupported_format');
  const format = doc.format;

  const data = new Uint8Array(await readAll(await deps.storage.get(doc.object_key)));
  const extraction = await extractFile(data, format, job.source_language);
  const extractedText = extraction?.hasTextLayer ? extraction.text : null;
  // Memória de tradução (ADR-008): trechos aprovados antes, usados com ou sem provedor.
  const memory: MemoryLookup = (segments) => lookupMemory(pool, job.source_language, job.target_language, segments);

  // Regras da modalidade e do idioma de destino (ADR-015): datas, números e marcadores de elementos visuais.
  const rules = await loadRules(pool, job.translation_mode ?? 'sworn', job.target_language);
  const glossary = (
    await pool.query<GlossaryTerm>(
      `SELECT source_term::text AS source, target_term AS target FROM glossary_entries
        WHERE source_language = $1 AND target_language = $2 AND (team_id IS NULL OR team_id = $3)
        ORDER BY team_id NULLS FIRST, source_term`,
      [job.source_language, job.target_language, doc.team_id],
    )
  ).rows;

  // Padrão conhecido (ADR-010): a tradução concluída mais recente cujo título do original aparece neste documento
  // ou, na falta dela, com uma etiqueta em comum. Conclusões com problema de checagem justificado não servem de exemplo.
  const example =
    (
      await pool.query<{ content: Draft; by_title: boolean }>(
        `SELECT r.content, ($3::text IS NOT NULL AND j.source_title IS NOT NULL AND length(j.source_title) >= 6
                             AND position(upper(j.source_title) IN upper($3)) > 0) AS by_title
           FROM translation_jobs j
           JOIN translation_drafts r ON r.job_id = j.id AND r.revision = j.current_revision
           JOIN documents d ON d.id = j.document_id
          WHERE j.status = 'approved' AND j.approval_override_reason IS NULL AND j.annulled_at IS NULL
            AND j.source_language = $1 AND j.target_language = $2
            AND (($3::text IS NOT NULL AND j.source_title IS NOT NULL AND length(j.source_title) >= 6
                  AND position(upper(j.source_title) IN upper($3)) > 0)
                 OR (cardinality($4::text[]) > 0 AND d.tags && $4::text[]))
          ORDER BY 2 DESC, j.approved_at DESC LIMIT 1`,
        [job.source_language, job.target_language, extractedText, doc.tags],
      )
    ).rows[0] ?? null;
  // Tipo e título só de um exemplo com o mesmo título do original: etiqueta em comum não diz que o documento é do mesmo tipo.
  const known = example?.by_title ? { documentType: example.content.documentType, sourceTitle: example.content.sourceTitle } : null;

  // Tradução automática gratuita (ADR-008); na tradução manual o sistema não traduz nada.
  const setting =
    (await pool.query<{ provider: MachineProviderSetting }>('SELECT provider FROM machine_translation_settings')).rows[0]?.provider ??
    'libretranslate';
  const manual = job.requested_mode === 'manual';
  const translator = manual || setting === 'none' ? null : (deps.machine?.[setting] ?? null);
  const result = await draftFromFile({
    data,
    format,
    extraction,
    sourceLanguage: job.source_language,
    targetLanguage: job.target_language,
    rules,
    glossary,
    memory,
    known,
    translator,
    knowledge: await loadLayoutKnowledge(pool),
    ...(job.classification_source === 'human' && job.document_category ? { documentCategory: job.document_category } : {}),
    ...(translator
      ? {}
      : {
          noTranslatorNotice: manual
            ? 'Tradução manual solicitada: o rascunho traz o texto original para ser traduzido.'
            : setting === 'none'
              ? 'Tradução automática desligada nas Configurações: o rascunho traz o texto original para ser traduzido.'
              : `O tradutor automático ("${setting}") está fora do ar: o rascunho traz o texto original para ser traduzido.`,
        }),
  });
  if (result.machineFailure?.retryable && job.attempts < job.max_attempts && translator) {
    await requeue(deps, job, `machine_${translator.name}`);
    return;
  }
  const { draft, origin, notice, corrections, issues } = result;
  const classification = suggestDocumentCategory(draft, extractedText);
  // Tradução e revisão são automáticas: o checklist das etapas fica confirmado pela revisão automática e a prévia sai
  // direto para quem aprova o Word.
  // Sem texto lido ou sem tradução automática não há o que a revisão automática atestar: o checklist fica para a pessoa.
  const at = new Date().toISOString();
  const automatic = origin === 'machine' && !!result.extractedText;
  const checks = automatic
    ? Object.fromEntries(
        checklistOf(job.translation_mode ?? 'sworn', rules).map((item) => [item.key, { by: 'system', name: 'Revisão automática', at }]),
      )
    : {};
  const extractedForReview = extraction
    ? [
        extraction.text,
        ...(extraction.rotatedText.length ? ['', `[Texto inclinado/marca d'água: ${extraction.rotatedText.join(' ')}]`] : []),
      ].join('\n')
    : null;
  const patternKnown = example !== null;
  const typeName = draft.sourceTitle || draft.documentType;

  const committed = await withTransaction(pool, async (db) => {
    const owned = await db.query<{ next: number }>(
      `SELECT coalesce((SELECT max(revision) FROM translation_drafts WHERE job_id = $1), 0) + 1 AS next
         FROM translation_jobs WHERE id = $1 AND status = 'processing' AND lease_owner = $2 FOR UPDATE`,
      [job.id, job.leaseOwner],
    );
    // Outro worker assumiu o trabalho (lease vencido): descarta este resultado.
    if (!owned.rowCount) return false;
    const revision = owned.rows[0]!.next;
    await insertDraft(db, { jobId: job.id, revision, content: draft, issues, origin, corrections });
    await db.query(
      `UPDATE translation_jobs SET status = 'in_review', current_revision = $2, extracted_text = $3, source_title = nullif($4, ''),
              assist_notice = $5, pattern_known = $6, document_type = nullif($7, ''), failure_code = NULL,
              page_count = $8, stage_checks = $9::jsonb,
              document_category=CASE WHEN classification_source='human' THEN document_category ELSE $10 END,
              suggested_document_category=$10,classification_confidence=$11,classification_basis=$12,
              processed_at = coalesce(processed_at, now()), lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = $1`,
      [
        job.id,
        revision,
        sealNullable(extractedForReview),
        draft.sourceTitle,
        notice,
        patternKnown,
        draft.documentType.slice(0, 200),
        extraction?.pages ?? null,
        JSON.stringify(checks),
        classification.category,
        classification.confidence,
        classification.basis,
      ],
    );
    if (result.stats && translator)
      await recordAudit(db, {
        actorUserId: null,
        action: 'translation.machine_translated',
        targetType: 'translation',
        targetId: job.id,
        ...(doc.team_id ? { teamId: doc.team_id } : {}),
        metadata: {
          provider: translator.name,
          external: translator.external,
          sourceLanguage: job.source_language,
          targetLanguage: job.target_language,
          ...result.stats,
        },
      });
    await recordAudit(db, {
      actorUserId: null,
      action: 'translation.drafted',
      targetType: 'translation',
      targetId: job.id,
      ...(doc.team_id ? { teamId: doc.team_id } : {}),
      metadata: {
        origin,
        revision,
        patternKnown,
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.length,
        corrections: corrections.length,
        classification: {
          ...classification,
          selectedCategory: job.classification_source === 'human' ? job.document_category : classification.category,
        },
      },
    });
    const link = { batchId: doc.batch_id, documentId: job.document_id, translationId: job.id };
    // Com responsável, o aviso vai para ele; sem, para quem pode assumir (a equipe, ou os Diretores no lote sem equipe).
    const audience = doc.assignee_id
      ? { teamId: doc.team_id, users: [doc.assignee_id] }
      : doc.team_id
        ? { teamId: doc.team_id, leaders: true, operators: true }
        : { teamId: null, directors: true };
    await notify(db, audience, {
      ...link,
      kind: 'translation_ready',
      title: doc.assignee_id ? `Pronto para revisar: ${doc.name}` : `Disponível para assumir: ${doc.name}`,
      body: notice,
    });
    if (!patternKnown) {
      await notify(
        db,
        { teamId: doc.team_id, leaders: true, directors: true, users: [doc.owner_id] },
        {
          ...link,
          kind: 'pattern_unknown',
          title: `Tipo de documento ainda não aprendido: ${doc.name}`,
          body: `${typeName ? `"${typeName}"` : 'Este documento'} ainda não tem uma tradução concluída que sirva de padrão. Confira com mais atenção: a primeira conclusão ensina o sistema.`,
        },
      );
    }
    return true;
  });
  if (!committed) return;
  deps.log?.('info', 'Rascunho pronto para revisão', { jobId: job.id, origin, patternKnown });
  // O sistema travou na diagramação (tipo novo sem documento parecido, ou tabela que não fecha): a IA propõe uma
  // combinação em segundo plano, sem segurar a tradução, que já está na prévia.
  const stuck = (result.bodyModel === 'generic' && !result.composedFrom.length) || issues.some((issue) => issue.code === 'structure');
  if (stuck && deps.ai) void proposeLayoutInBackground(pool, deps.ai, job.id, doc.assignee_id ?? doc.owner_id);
}

/** Avisa a equipe (ou os Diretores) e quem enviou que o processamento falhou de vez. */
async function notifyFailure(db: Queryable, jobId: string, code: string) {
  const found = await db.query<{ name: string; batch_id: string; document_id: string; owner_id: string; team_id: string | null }>(
    `SELECT d.display_name AS name, b.id AS batch_id, d.id AS document_id, b.owner_id, b.team_id
       FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id WHERE j.id = $1`,
    [jobId],
  );
  const row = found.rows[0];
  if (!row) return;
  await notify(
    db,
    { teamId: row.team_id, leaders: true, directors: !row.team_id, users: [row.owner_id] },
    {
      kind: 'translation_failed',
      title: `Falha no processamento: ${row.name}`,
      body: FAILURE_MESSAGES[code] ?? 'O documento não pôde ser processado; peça uma nova tentativa.',
      batchId: row.batch_id,
      documentId: row.document_id,
      translationId: jobId,
    },
  );
}

const FAILURE_MESSAGES: Record<string, string> = {
  unsupported_format: 'Formato sem suporte para tradução.',
  document_unavailable: 'O arquivo original não está disponível.',
  attempts_exhausted: 'Várias tentativas falharam; tente processar de novo mais tarde.',
  processing_error: 'Erro inesperado no processamento; tente processar de novo.',
};

/**
 * Publica que este worker está vivo e quais provedores gratuitos respondem;
 * a interface usa isso para explicar a ausência de tradução automática.
 */
export async function recordHeartbeat(deps: Pick<ProcessingDeps, 'pool' | 'workerId' | 'machine'>) {
  const providers: string[] = [];
  for (const [name, translator] of Object.entries(deps.machine ?? {})) {
    if (translator && (await translator.isAvailable())) providers.push(name);
  }
  await deps.pool.query(
    `INSERT INTO worker_heartbeats (worker_id, machine_providers, seen_at) VALUES ($1, $2, now())
     ON CONFLICT (worker_id) DO UPDATE SET machine_providers = EXCLUDED.machine_providers, seen_at = now()`,
    [deps.workerId, providers],
  );
  await deps.pool.query(`DELETE FROM worker_heartbeats WHERE seen_at < now() - interval '1 day'`);
}
