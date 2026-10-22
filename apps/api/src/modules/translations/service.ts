import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { notify, recordAudit, withTransaction } from '@tradutor/core/db';
import type { ObjectStorage } from '@tradutor/core/storage';
import {
  checkDraft,
  Draft,
  memoryPairs,
  type MachineProviderSetting,
  checklistOf,
  fillMask,
  loadRules,
  MODE_STAGES,
  modeLabel,
  outputFileName,
  renderPlainDocx,
  type Mode,
  renderMaskTemplate,
  swornFrame,
  type DraftIssue,
  type GlossaryTerm,
  autoReview,
  type Correction,
  type MachineProviderName,
  type MachineTranslator,
  type Language,
  type TranslatorProfile,
} from '@tradutor/core/translation';
import {
  canApproveTranslation,
  canClaimTranslation,
  canDecideNumberingRequest,
  canEditTranslation,
  canReassignTranslation,
  canManageGlossary,
  canManageTranslationSettings,
  canViewTeam,
  canWorkOnTranslation,
  isDirector,
  type Actor,
} from '../access/policy.js';
import { AppError, conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { exhausted, notifyQuotaMilestones, quotaLabel, quotaLevels } from '../numbering/quota.js';
import { sheetText, type TranslatorNumberingService } from '../numbering/translator-numbering.js';
import { decodeCursor, encodeCursor, likePattern } from '../pagination.js';

export type TranslationStatus = 'queued' | 'processing' | 'in_review' | 'awaiting_approval' | 'approved' | 'failed' | 'cancelled';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SUPPORTED_FORMATS = new Set(['pdf', 'jpeg', 'png', 'docx', 'pptx']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface JobRow {
  id: string;
  /** Modalidade (ADR-015): juramentada, certificada, técnica ou simples. */
  translation_mode: Mode;
  /** Juramentada com a máscara do tradutor (padrão) ou sem máscara (ADR-017). */
  use_mask: boolean;
  /** Tradutor escolhido no envio: a prévia sai na máscara dele e a conclusão usa a regra de numeração dele. */
  preferred_translator_id: string | null;
  preferred_translator_name: string | null;
  /** Páginas do original (PDF), para a numeração por folhas. */
  page_count: number | null;
  /** Itens de checklist confirmados: chave → quem e quando. */
  stage_checks: Record<string, { by: string; name: string; at: string }>;
  document_id: string;
  document_name: string;
  batch_id: string;
  batch_name: string | null;
  team_id: string | null;
  team_name: string | null;
  owner_id: string;
  owner_name: string;
  tags: string[];
  pattern_known: boolean | null;
  document_type: string | null;
  submitted_by_name: string | null;
  approved_by: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  redo_count: number;
  processed_at: Date | null;
  annulled_at: Date | null;
  annulled_reason: string | null;
  pending_request_id: string | null;
  translator_id: string | null;
  translator_name: string | null;
  mask_edition: number | null;
  number_label: string | null;
  book_label: string | null;
  sheet_label: string | null;
  source_language: Language;
  target_language: Language;
  status: TranslationStatus;
  requested_mode: string;
  requested_by: string;
  requested_by_name: string;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
  attempts: number;
  failure_code: string | null;
  extracted_text: string | null;
  source_title: string | null;
  current_revision: number | null;
  assist_notice: string | null;
  submitted_by: string | null;
  submitted_at: Date | null;
  review_comment: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  approval_override_reason: string | null;
  translation_number: number | null;
  translation_year: number | null;
  book: number | null;
  sheet: number | null;
  output_key: string | null;
  error_count: number | null;
  issue_count: number | null;
}

const JOB_SELECT = `
  SELECT j.*, d.display_name AS document_name, d.tags, b.id AS batch_id, b.name AS batch_name, b.team_id, b.owner_id,
         (SELECT display_name FROM users WHERE id = b.owner_id) AS owner_name,
         (SELECT name::text FROM teams WHERE id = b.team_id) AS team_name,
         (SELECT display_name FROM users WHERE id = j.requested_by) AS requested_by_name,
         (SELECT display_name FROM users WHERE id = j.submitted_by) AS submitted_by_name,
         (SELECT display_name FROM users WHERE id = j.approved_by) AS approved_by_name,
         (SELECT display_name FROM users WHERE id = j.assignee_id) AS assignee_name,
         (SELECT name FROM sworn_translators WHERE id = j.translator_id) AS translator_name,
         (SELECT name FROM sworn_translators WHERE id = j.preferred_translator_id) AS preferred_translator_name,
         (SELECT edition FROM sworn_translator_masks WHERE id = j.mask_id) AS mask_edition,
         (SELECT nr.id FROM numbering_requests nr WHERE nr.job_id = j.id AND nr.status = 'pending') AS pending_request_id,
         to_char(j.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
         (SELECT count(*)::int FROM jsonb_array_elements(r.issues) i WHERE i->>'severity' = 'error') AS error_count,
         (SELECT count(*)::int FROM jsonb_array_elements(r.issues)) AS issue_count
    FROM translation_jobs j
    JOIN documents d ON d.id = j.document_id
    JOIN batches b ON b.id = d.batch_id
    LEFT JOIN translation_drafts r ON r.job_id = j.id AND r.revision = j.current_revision`;

const numberText = (row: Pick<JobRow, 'number_label' | 'book_label' | 'sheet_label'>) =>
  [row.number_label, row.book_label && `Livro ${row.book_label}`, row.sheet_label && `Folha ${row.sheet_label}`]
    .filter(Boolean)
    .join(' – ');

/** Juramentada na máscara do tradutor, com número: as demais saem sem moldura nem numeração (ADR-015, ADR-017). */
const withMask = (row: Pick<JobRow, 'translation_mode' | 'use_mask'>) => row.translation_mode === 'sworn' && row.use_mask;

function summary(row: JobRow, actor: Actor) {
  const batch = { teamId: row.team_id, ownerId: row.owner_id };
  const canApprove = canApproveTranslation(actor, batch);
  const canEdit = canEditTranslation(actor, batch, row.assignee_id);
  const open = !['approved', 'cancelled', 'failed'].includes(row.status);
  const sworn = withMask(row);
  const issued = row.status === 'approved' && (!sworn || row.number_label !== null);
  return {
    id: row.id,
    translationMode: row.translation_mode,
    modeLabel: modeLabel[row.translation_mode],
    stages: MODE_STAGES[row.translation_mode],
    useMask: sworn,
    preferredTranslator: row.preferred_translator_id
      ? { id: row.preferred_translator_id, name: row.preferred_translator_name ?? '' }
      : null,
    pageCount: row.page_count,
    document: { id: row.document_id, name: row.document_name, tags: row.tags },
    batch: { id: row.batch_id, name: row.batch_name },
    team: row.team_id ? { id: row.team_id, name: row.team_name ?? '' } : null,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    status: row.status,
    requestedBy: row.requested_by_name,
    uploadedBy: row.owner_name,
    submittedBy: row.submitted_by_name,
    approvedBy: row.approved_by_name,
    approvedAt: row.approved_at?.toISOString() ?? null,
    /** Responsável: só ele e o Supervisor da equipe editam (plano de hierarquia). */
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name ?? '' } : null,
    redoCount: row.redo_count,
    annulled: row.annulled_at ? { at: row.annulled_at.toISOString(), reason: row.annulled_reason } : null,
    pendingNumberingRequest: row.pending_request_id,
    documentType: row.document_type,
    sourceTitle: row.source_title,
    /** `false`: o sistema ainda não tinha uma tradução concluída deste tipo (ADR-010); `null`: ainda não processado. */
    patternKnown: row.pattern_known,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    failureCode: row.failure_code,
    currentRevision: row.current_revision,
    errorCount: row.error_count ?? 0,
    issueCount: row.issue_count ?? 0,
    /** Número como digitado na conclusão, com livro e folha quando houver (ADR-012). */
    number: row.number_label ? numberText(row) : null,
    /** Tradutor e edição da máscara com que a tradução foi gerada. */
    translator: row.translator_id ? { id: row.translator_id, name: row.translator_name ?? '', maskEdition: row.mask_edition } : null,
    permissions: {
      edit: row.status === 'in_review' && canEdit,
      submit: row.status === 'in_review' && canEdit,
      claim: open && canClaimTranslation(actor, batch, row.assignee_id),
      reassign: open && canReassignTranslation(actor, batch),
      approve: (row.status === 'in_review' || row.status === 'awaiting_approval') && canApprove,
      /** Aprovar o Word (ADR-017): leva à próxima fase — pronta para conclusão, ou concluída por quem pode concluir. */
      accept: (row.status === 'in_review' && (canEdit || canApprove)) || (row.status === 'awaiting_approval' && canApprove),
      returnForChanges: row.status === 'awaiting_approval' && canApprove,
      cancel: !['approved', 'cancelled', 'failed'].includes(row.status) && canApprove,
      reprocess: ['in_review', 'awaiting_approval', 'failed'].includes(row.status) && canApprove,
      download: issued && !row.annulled_at,
      /** Pedir alteração ou anulação do número: o responsável ou quem decide, sem pedido em aberto. */
      requestNumbering:
        sworn &&
        issued &&
        !row.annulled_at &&
        !row.pending_request_id &&
        (row.assignee_id === actor.id || canDecideNumberingRequest(actor, batch)),
    },
  };
}

const BLANK_PROFILE: TranslatorProfile = {
  name: '',
  titlePt: '',
  languagePt: '',
  registration: '',
  registrationEn: '',
  registrationPt: '',
  city: '',
  statePt: '',
  stateEn: '',
  letterheadNote: null,
  feeNote: null,
};

/** Máscara de um tradutor (ADR-012), lida do cadastro de tradutores. */
export type MaskSource = (
  translatorId: string,
  maskId?: string | null,
  /** Idioma e regra da tradução, para máscaras geradas de modelo do sistema (ADR-019). */
  use?: { source: Language; target: Language; look?: { font: string; fontSize: number } | null },
) => Promise<{ name: string; active: boolean; maskId: string; edition: number; data: Uint8Array }>;

export interface ApproveInput {
  overrideReason?: string;
  /** Tradutor juramentado escolhido na conclusão (ADR-012). */
  translatorId?: string;
  /** Número, livro e folha como o tradutor os usa. */
  number?: string;
  book?: string;
  sheet?: string;
}

export interface TranslationListQuery {
  status?: TranslationStatus[];
  teamId?: string;
  unassigned?: boolean;
  documentId?: string;
  batchId?: string;
  sourceLanguage?: Language;
  targetLanguage?: Language;
  tag?: string;
  documentType?: string;
  /** Modalidade (ADR-015). */
  translationMode?: Mode;
  patternKnown?: boolean;
  approvedBy?: string;
  /** Só as do ator como responsável (workspace e histórico). */
  mine?: boolean;
  assigneeId?: string;
  /** Sem responsável: disponíveis para assumir. */
  unclaimed?: boolean;
  annulled?: boolean;
  uploadedBy?: string;
  /** Datas no formato AAAA-MM-DD, inclusivas. */
  createdFrom?: string;
  createdTo?: string;
  approvedFrom?: string;
  approvedTo?: string;
  q?: string;
  limit: number;
  cursor?: string;
}

export function createTranslationService({
  pool,
  storage,
  masks,
  now = () => new Date(),
  numbering,
  machine = {},
}: ServiceDeps & {
  storage: ObjectStorage;
  masks: MaskSource;
  numbering: TranslatorNumberingService;
  /** Provedores gratuitos para a revisão automática (ADR-016). */
  machine?: Partial<Record<MachineProviderName, MachineTranslator>>;
}) {
  async function loadJob(db: Pick<PoolClient, 'query'>, ctx: AuthenticatedContext, jobId: string, lock = false) {
    const result = await db.query<JobRow>(`${JOB_SELECT} WHERE j.id = $1 ${lock ? 'FOR UPDATE OF j' : ''}`, [jobId]);
    const row = result.rows[0];
    if (!row || !canWorkOnTranslation(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) throw notFound('Tradução não encontrada');
    return row;
  }

  async function glossaryFor(db: Pick<PoolClient, 'query'>, row: Pick<JobRow, 'source_language' | 'target_language' | 'team_id'>) {
    const result = await db.query<GlossaryTerm>(
      `SELECT source_term::text AS source, target_term AS target FROM glossary_entries
        WHERE source_language = $1 AND target_language = $2 AND (team_id IS NULL OR team_id = $3)`,
      [row.source_language, row.target_language, row.team_id],
    );
    return result.rows;
  }

  async function currentDraft(db: Pick<PoolClient, 'query'>, jobId: string, revision: number | null) {
    if (!revision) return null;
    const result = await db.query<{
      content: Draft;
      issues: DraftIssue[];
      corrections: Correction[];
      origin: string;
      created_at: Date;
      author_name: string | null;
    }>(
      `SELECT r.content, r.issues, r.corrections, r.origin, r.created_at, u.display_name AS author_name
         FROM translation_drafts r LEFT JOIN users u ON u.id = r.author_id
        WHERE r.job_id = $1 AND r.revision = $2`,
      [jobId, revision],
    );
    return result.rows[0] ?? null;
  }

  const audit = (
    db: Pick<PoolClient, 'query'>,
    ctx: AuthenticatedContext,
    row: Pick<JobRow, 'id' | 'team_id'>,
    action: string,
    metadata = {},
  ) =>
    recordAudit(db, {
      actorUserId: ctx.actor.id,
      action,
      targetType: 'translation',
      targetId: row.id,
      ...(row.team_id ? { teamId: row.team_id } : {}),
      correlationId: ctx.correlationId,
      metadata,
    });

  /** Textos que dependem só do idioma (notas do tradutor e assinaturas), para a prévia na tela. */
  function previewFrame(row: JobRow) {
    const frame = swornFrame(BLANK_PROFILE, row.source_language, row.target_language, now(), null);
    const [notePrefix, noteSuffix] = frame.translatorNote('\u0000').split('\u0000');
    return {
      draftMark: row.status === 'approved' ? null : frame.draftMark,
      documentTypeLabel: frame.documentTypeLabel,
      translatorNote: { prefix: notePrefix ?? '', suffix: noteSuffix ?? '' },
      signatureMark: { illegible: frame.signatureMark(true), legible: frame.signatureMark(false) },
    };
  }

  // ---------- Fluxo ----------

  async function start(
    ctx: AuthenticatedContext,
    documentId: string,
    input: { sourceLanguage: Language; targetLanguage: Language; mode: 'auto' | 'manual'; translationMode?: Mode },
  ) {
    if (input.sourceLanguage === input.targetLanguage) throw new AppError(400, 'VALIDATION_FAILED', 'Idiomas de origem e destino iguais');
    const found = await pool.query<{ status: string; detected_format: string | null; team_id: string | null; owner_id: string }>(
      `SELECT d.status, d.detected_format, b.team_id, b.owner_id FROM documents d JOIN batches b ON b.id = d.batch_id WHERE d.id = $1`,
      [documentId],
    );
    const doc = found.rows[0];
    if (!doc || !canWorkOnTranslation(ctx.actor, { teamId: doc.team_id, ownerId: doc.owner_id }))
      throw notFound('Documento não encontrado');
    if (doc.status !== 'stored') throw conflict('O documento ainda não foi armazenado');
    if (!doc.detected_format || !SUPPORTED_FORMATS.has(doc.detected_format)) {
      throw conflict('Formato sem suporte para tradução juramentada');
    }
    try {
      const id = await withTransaction(pool, async (db) => {
        const created = await db.query<{ id: string }>(
          `INSERT INTO translation_jobs (document_id, source_language, target_language, requested_mode, requested_by, assignee_id, translation_mode)
           VALUES ($1, $2, $3, $4, $5, $5, coalesce($6, (SELECT b.translation_mode FROM documents d JOIN batches b ON b.id = d.batch_id WHERE d.id = $1)))
           RETURNING id`,
          [documentId, input.sourceLanguage, input.targetLanguage, input.mode, ctx.actor.id, input.translationMode ?? null],
        );
        const jobId = created.rows[0]!.id;
        await audit(db, ctx, { id: jobId, team_id: doc.team_id }, 'translation.requested', {
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          mode: input.mode,
        });
        return jobId;
      });
      return get(ctx, id);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('Já existe uma tradução em andamento para este documento e idioma');
      throw error;
    }
  }

  /** Visibilidade em SQL, espelhando `canWorkOnTranslation`: equipes do ator; lotes sem equipe, só o Diretor. */
  function visibility(actor: Actor, param: (value: unknown) => string) {
    return isDirector(actor) ? [] : [`b.team_id = ANY(${param([...actor.memberships.keys()])}::uuid[])`];
  }

  async function list(ctx: AuthenticatedContext, query: TranslationListQuery) {
    const after = decodeCursor(query.cursor, ([at, id]) => !!at && !Number.isNaN(Date.parse(at)) && !!id && UUID.test(id));
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions = visibility(ctx.actor, param);
    if (query.status?.length) conditions.push(`j.status = ANY(${param(query.status)}::text[])`);
    if (query.teamId) conditions.push(`b.team_id = ${param(query.teamId)}`);
    if (query.unassigned) conditions.push('b.team_id IS NULL');
    if (query.documentId) conditions.push(`j.document_id = ${param(query.documentId)}`);
    if (query.batchId) conditions.push(`b.id = ${param(query.batchId)}`);
    if (query.sourceLanguage) conditions.push(`j.source_language = ${param(query.sourceLanguage)}`);
    if (query.targetLanguage) conditions.push(`j.target_language = ${param(query.targetLanguage)}`);
    if (query.tag) conditions.push(`${param(query.tag)} = ANY(d.tags)`);
    if (query.documentType) conditions.push(`j.document_type = ${param(query.documentType)}`);
    if (query.translationMode) conditions.push(`j.translation_mode = ${param(query.translationMode)}`);
    if (query.patternKnown !== undefined) conditions.push(`j.pattern_known IS ${query.patternKnown ? 'TRUE' : 'FALSE'}`);
    if (query.approvedBy) conditions.push(`j.approved_by = ${param(query.approvedBy)}`);
    if (query.mine) conditions.push(`j.assignee_id = ${param(ctx.actor.id)}`);
    if (query.assigneeId) conditions.push(`j.assignee_id = ${param(query.assigneeId)}`);
    if (query.unclaimed) conditions.push('j.assignee_id IS NULL');
    if (query.annulled !== undefined) conditions.push(`j.annulled_at IS ${query.annulled ? 'NOT NULL' : 'NULL'}`);
    if (query.uploadedBy) conditions.push(`b.owner_id = ${param(query.uploadedBy)}`);
    if (query.createdFrom) conditions.push(`j.created_at >= ${param(query.createdFrom)}::date`);
    if (query.createdTo) conditions.push(`j.created_at < ${param(query.createdTo)}::date + 1`);
    if (query.approvedFrom) conditions.push(`j.approved_at >= ${param(query.approvedFrom)}::date`);
    if (query.approvedTo) conditions.push(`j.approved_at < ${param(query.approvedTo)}::date + 1`);
    if (query.q) {
      const pattern = param(likePattern(query.q));
      conditions.push(
        `(unaccent(d.display_name) ILIKE unaccent(${pattern}) OR unaccent(coalesce(b.name, '')) ILIKE unaccent(${pattern})
          OR unaccent(coalesce(j.document_type, '')) ILIKE unaccent(${pattern}) OR unaccent(coalesce(j.source_title, '')) ILIKE unaccent(${pattern})
          OR coalesce(j.number_label, '') ILIKE ${pattern})`,
      );
    }
    if (after) conditions.push(`(j.created_at, j.id) < (${param(after[0])}::timestamptz, ${param(after[1])}::uuid)`);
    const limit = param(query.limit + 1);
    const result = await pool.query<JobRow>(
      `${JOB_SELECT} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY j.created_at DESC, j.id DESC LIMIT ${limit}`,
      params,
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => summary(row, ctx.actor)),
      nextCursor: result.rows.length > query.limit && last ? encodeCursor(last.cursor_at, last.id) : null,
    };
  }

  /** Checklist das etapas manuais da modalidade, com quem confirmou cada item. */
  const checklistFor = (row: JobRow, rules: Awaited<ReturnType<typeof loadRules>>) =>
    checklistOf(row.translation_mode, rules).map((item) => ({ ...item, checked: row.stage_checks?.[item.key] ?? null }));

  async function get(ctx: AuthenticatedContext, jobId: string) {
    const row = await loadJob(pool, ctx, jobId);
    const draft = await currentDraft(pool, jobId, row.current_revision);
    const rules = await loadRules(pool, row.translation_mode, row.target_language);
    return {
      rules,
      checklist: checklistFor(row, rules),
      translation: {
        ...summary(row, ctx.actor),
        extractedText: row.extracted_text,
        notice: row.assist_notice,
        reviewComment: row.review_comment,
        approvalOverrideReason: row.approval_override_reason,
      },
      frame: previewFrame(row),
      draft: draft
        ? {
            revision: row.current_revision,
            content: draft.content,
            issues: draft.issues,
            corrections: draft.corrections,
            origin: draft.origin,
            createdAt: draft.created_at.toISOString(),
            author: draft.author_name,
          }
        : null,
    };
  }

  /** Valores existentes para os filtros (tipos, etiquetas e quem concluiu), dentro do que o ator vê. */
  async function facets(ctx: AuthenticatedContext) {
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions = visibility(ctx.actor, param);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id`;
    const [types, tags, approvers] = await Promise.all([
      pool.query<{ value: string }>(
        `SELECT DISTINCT j.document_type AS value ${from} ${where} ${where ? 'AND' : 'WHERE'} j.document_type IS NOT NULL ORDER BY 1 LIMIT 200`,
        params,
      ),
      pool.query<{ value: string }>(`SELECT DISTINCT unnest(d.tags) AS value ${from} ${where} ORDER BY 1 LIMIT 300`, params),
      pool.query<{ id: string; name: string }>(
        `SELECT DISTINCT u.id, u.display_name AS name ${from} JOIN users u ON u.id = j.approved_by ${where} ORDER BY 2 LIMIT 200`,
        params,
      ),
    ]);
    return {
      documentTypes: types.rows.map((row) => row.value),
      tags: tags.rows.map((row) => row.value),
      approvers: approvers.rows,
    };
  }

  async function revisions(ctx: AuthenticatedContext, jobId: string) {
    await loadJob(pool, ctx, jobId);
    const result = await pool.query<{ revision: number; origin: string; created_at: Date; author_name: string | null; errors: number }>(
      `SELECT r.revision, r.origin, r.created_at, u.display_name AS author_name,
              (SELECT count(*)::int FROM jsonb_array_elements(r.issues) i WHERE i->>'severity' = 'error') AS errors
         FROM translation_drafts r LEFT JOIN users u ON u.id = r.author_id
        WHERE r.job_id = $1 ORDER BY r.revision DESC`,
      [jobId],
    );
    return result.rows.map((row) => ({
      revision: row.revision,
      origin: row.origin,
      createdAt: row.created_at.toISOString(),
      author: row.author_name,
      errors: row.errors,
    }));
  }

  async function revision(ctx: AuthenticatedContext, jobId: string, number: number) {
    await loadJob(pool, ctx, jobId);
    const draft = await currentDraft(pool, jobId, number);
    if (!draft) throw notFound('Revisão não encontrada');
    return { revision: number, content: draft.content, issues: draft.issues, corrections: draft.corrections, origin: draft.origin };
  }

  /** Grava uma nova revisão. `baseRevision` evita sobrescrever a edição de outra pessoa. */
  async function saveDraft(ctx: AuthenticatedContext, jobId: string, input: { baseRevision: number; draft: Draft }) {
    return withTransaction(pool, async (db) => {
      const row = await loadJob(db, ctx, jobId, true);
      requireEditor(ctx, row);
      if (row.status !== 'in_review') throw conflict('A tradução não está em revisão');
      if (row.current_revision !== input.baseRevision) {
        throw new AppError(409, 'CONFLICT', 'O rascunho foi alterado por outra pessoa; recarregue antes de salvar', {
          currentRevision: row.current_revision,
        });
      }
      if (input.draft.sourceLanguage !== row.source_language || input.draft.targetLanguage !== row.target_language) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Os idiomas do rascunho não correspondem aos da tradução');
      }
      const rules = await loadRules(db, row.translation_mode, row.target_language);
      const issues = checkDraft(input.draft, row.extracted_text, await glossaryFor(db, row), rules);
      const next = (row.current_revision ?? 0) + 1;
      await db.query(
        `INSERT INTO translation_drafts (job_id, revision, content, issues, origin, author_id) VALUES ($1, $2, $3, $4, 'human', $5)`,
        [jobId, next, JSON.stringify(input.draft), JSON.stringify(issues), ctx.actor.id],
      );
      await db.query(
        `UPDATE translation_jobs SET current_revision = $2, source_title = nullif($3, ''), document_type = nullif($4, ''), updated_at = now()
          WHERE id = $1`,
        [jobId, next, input.draft.sourceTitle, input.draft.documentType.slice(0, 200)],
      );
      await audit(db, ctx, row, 'translation.edited', {
        revision: next,
        errors: issues.filter((issue) => issue.severity === 'error').length,
      });
      return { revision: next, issues };
    });
  }

  /** Provedor escolhido nas Configurações, se estiver configurado neste processo. */
  async function activeTranslator() {
    const provider = await machineProvider();
    return provider === 'none' ? null : (machine[provider] ?? null);
  }

  /**
   * Revisão automática (ADR-016) sobre a revisão atual: corrige idioma, números, datas, glossário e marcadores e grava
   * uma nova revisão com a lista do que mudou. Sem nada para corrigir, não cria revisão.
   */
  async function applyAutoReview(db: PoolClient, ctx: AuthenticatedContext, row: JobRow) {
    const current = await currentDraft(db, row.id, row.current_revision);
    if (!current) throw conflict('A tradução ainda não tem rascunho');
    const rules = await loadRules(db, row.translation_mode, row.target_language);
    const glossary = await glossaryFor(db, row);
    const review = await autoReview({
      draft: current.content,
      sourceText: row.extracted_text,
      glossary,
      rules,
      translator: row.requested_mode === 'manual' ? null : await activeTranslator(),
    });
    const issues = checkDraft(review.draft, row.extracted_text, glossary, rules);
    if (!review.corrections.length) return { revision: row.current_revision, corrections: [], unresolved: review.unresolved, issues };
    const next = (row.current_revision ?? 0) + 1;
    await db.query(
      `INSERT INTO translation_drafts (job_id, revision, content, issues, origin, author_id, corrections)
       VALUES ($1, $2, $3, $4, 'review', $5, $6)`,
      [row.id, next, JSON.stringify(review.draft), JSON.stringify(issues), ctx.actor.id, JSON.stringify(review.corrections)],
    );
    await db.query(`UPDATE translation_jobs SET current_revision = $2, document_type = nullif($3, ''), updated_at = now() WHERE id = $1`, [
      row.id,
      next,
      review.draft.documentType.slice(0, 200),
    ]);
    await audit(db, ctx, row, 'translation.auto_reviewed', {
      revision: next,
      corrections: review.corrections.length,
      unresolved: review.unresolved.length,
    });
    row.current_revision = next;
    return { revision: next, corrections: review.corrections, unresolved: review.unresolved, issues };
  }

  async function autoReviewDraft(ctx: AuthenticatedContext, jobId: string) {
    return withTransaction(pool, async (db) => {
      const row = await loadJob(db, ctx, jobId, true);
      requireEditor(ctx, row);
      if (row.status !== 'in_review') throw conflict('A tradução não está em revisão');
      return applyAutoReview(db, ctx, row);
    });
  }

  /**
   * Aprovar o Word (ADR-017): tradução e revisão já foram automáticas; quem aprova leva o documento à próxima fase.
   * O responsável (ou o Supervisor) confirma o que faltar do checklist e marca como pronta; quem pode concluir conclui
   * na hora, com o tradutor e a numeração escolhidos. Um Usuário aprova e a liderança conclui.
   */
  async function accept(ctx: AuthenticatedContext, jobId: string) {
    const row = await loadJob(pool, ctx, jobId);
    const batch = { teamId: row.team_id, ownerId: row.owner_id };
    const canApprove = canApproveTranslation(ctx.actor, batch);
    const canEdit = canEditTranslation(ctx.actor, batch, row.assignee_id);
    if (row.status === 'in_review') {
      if (!canEdit && !canApprove) throw forbidden('Somente o responsável ou a liderança da equipe aprova esta tradução');
      const rules = await loadRules(pool, row.translation_mode, row.target_language);
      const pending = checklistFor(row, rules)
        .filter((item) => !item.checked)
        .map((item) => item.key);
      if (pending.length && canEdit) await setChecks(ctx, jobId, { keys: pending, checked: true });
      // Com máscara e tradutor escolhido no envio, a numeração sai da regra dele com as páginas do original, se
      // ninguém preencheu; regras que pedem número digitado continuam pedindo.
      if (withMask(row) && row.preferred_translator_id) {
        const current = await numbering.getEntry(ctx, jobId);
        if (!current.entry) {
          await numbering.saveEntry(ctx, jobId, {
            translatorId: row.preferred_translator_id,
            ...(row.page_count ? { pages: row.page_count } : {}),
          });
        }
      }
      if (canEdit) await submit(ctx, jobId);
    } else if (row.status !== 'awaiting_approval') {
      throw conflict(`Ação não permitida no estado "${row.status}"`);
    }
    if (!canApprove) return get(ctx, jobId);
    return approve(ctx, jobId, {});
  }

  /** O trabalho de cada usuário é dele: edita e marca como pronta só o responsável ou o Supervisor da equipe. */
  function requireEditor(ctx: AuthenticatedContext, row: JobRow) {
    if (!canEditTranslation(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id }, row.assignee_id)) {
      throw forbidden(
        row.assignee_id
          ? 'Somente o responsável pela tradução ou o Supervisor da equipe pode alterá-la'
          : 'Assuma a tradução antes de trabalhar nela',
      );
    }
  }

  /** Bloqueia quando a cota de numeração do responsável, da equipe ou da organização acabou. */
  async function requireQuota(db: Pick<PoolClient, 'query'>, row: JobRow, userId: string | null) {
    const full = exhausted(await quotaLevels(db, { year: now().getUTCFullYear(), teamId: row.team_id, userId }));
    if (full) {
      throw new AppError(
        409,
        'CONFLICT',
        `A cota de numeração ${quotaLabel[full.scope]} acabou (${full.used}/${full.quota}); peça para ampliar em Numeração`,
        { reason: 'quota_exhausted', scope: full.scope, quota: full.quota, used: full.used },
      );
    }
  }

  /** Muda o estado sob lock; a permissão do papel é verificada antes por quem chama. */
  async function transition(
    ctx: AuthenticatedContext,
    jobId: string,
    allowed: (row: JobRow) => boolean,
    update: (db: PoolClient, row: JobRow) => Promise<void>,
  ) {
    await withTransaction(pool, async (db) => {
      const row = await loadJob(db, ctx, jobId, true);
      if (!allowed(row)) throw conflict(`Ação não permitida no estado "${row.status}"`);
      await update(db, row);
    });
    return get(ctx, jobId);
  }

  const submit = (ctx: AuthenticatedContext, jobId: string) =>
    transition(
      ctx,
      jobId,
      (row) => row.status === 'in_review',
      async (db, row) => {
        requireEditor(ctx, row);
        await requireQuota(db, row, row.assignee_id);
        // A revisão automática corre antes de marcar como pronta: o que tem conserto é corrigido no documento.
        await applyAutoReview(db, ctx, row);
        // Correção, diagramação e revisão (conforme a modalidade): todos os itens confirmados antes de marcar como pronta.
        const pending = checklistFor(row, await loadRules(db, row.translation_mode, row.target_language)).filter((item) => !item.checked);
        if (pending.length) {
          throw new AppError(409, 'CONFLICT', `Confirme o checklist antes: faltam ${pending.length} item(ns) (${pending[0]!.label})`, {
            reason: 'checklist_incomplete',
            pending: pending.map((item) => item.key),
          });
        }
        // Numeração preenchida com problema (duplicado, fora do estoque, fora da sequência…) impede marcar como pronta.
        const numberingErrors = await numbering.openErrors(db, jobId);
        if (numberingErrors.length) {
          throw new AppError(
            409,
            'CONFLICT',
            `Corrija a numeração antes: ${numberingErrors.map((anomaly) => anomaly.message).join('; ')}`,
            {
              reason: 'numbering_invalid',
              anomalies: numberingErrors,
            },
          );
        }
        await db.query(
          `UPDATE translation_jobs SET status = 'awaiting_approval', submitted_by = $2, submitted_at = now(), review_comment = NULL, updated_at = now() WHERE id = $1`,
          [jobId, ctx.actor.id],
        );
        await audit(db, ctx, row, 'translation.submitted', { revision: row.current_revision });
        // Pronto pelo Operador: a decisão final é do Líder da equipe ou do Diretor.
        await notify(
          db,
          { teamId: row.team_id, leaders: true, directors: true, exclude: ctx.actor.id },
          {
            ...links(row),
            kind: 'translation_submitted',
            title: `Aguardando conclusão: ${row.document_name}`,
            body: `${await nameOf(db, ctx.actor.id)} marcou a tradução como pronta. Confira a prévia e conclua ou peça para refazer.`,
          },
        );
      },
    );

  /** Confirma ou desfaz itens do checklist das etapas manuais (quem pode editar a tradução, e quem conclui). */
  async function setChecks(ctx: AuthenticatedContext, jobId: string, input: { keys: string[]; checked: boolean }) {
    await withTransaction(pool, async (db) => {
      const row = await loadJob(db, ctx, jobId, true);
      const batch = { teamId: row.team_id, ownerId: row.owner_id };
      if (!canEditTranslation(ctx.actor, batch, row.assignee_id) && !canApproveTranslation(ctx.actor, batch)) {
        throw forbidden('Só quem trabalha na tradução ou quem conclui confirma o checklist');
      }
      if (!['in_review', 'awaiting_approval'].includes(row.status))
        throw conflict('O checklist só muda enquanto a tradução está em revisão');
      const valid = new Set(
        checklistOf(row.translation_mode, await loadRules(db, row.translation_mode, row.target_language)).map((item) => item.key),
      );
      const unknown = input.keys.filter((key) => !valid.has(key));
      if (unknown.length) throw new AppError(400, 'VALIDATION_FAILED', `Item de checklist desconhecido: ${unknown[0]}`);
      const next = { ...(row.stage_checks ?? {}) };
      const name = await nameOf(db, ctx.actor.id);
      for (const key of input.keys) {
        if (input.checked) next[key] = { by: ctx.actor.id, name, at: new Date().toISOString() };
        else delete next[key];
      }
      await db.query('UPDATE translation_jobs SET stage_checks = $2, updated_at = now() WHERE id = $1', [jobId, JSON.stringify(next)]);
      await audit(db, ctx, row, 'translation.checklist', { keys: input.keys, checked: input.checked });
    });
    return get(ctx, jobId);
  }

  const links = (row: JobRow) => ({ batchId: row.batch_id, documentId: row.document_id, translationId: row.id });
  const nameOf = async (db: Pick<PoolClient, 'query'>, userId: string) =>
    (await db.query<{ name: string }>('SELECT display_name AS name FROM users WHERE id = $1', [userId])).rows[0]?.name ?? 'Alguém';

  async function requireApprover(ctx: AuthenticatedContext, jobId: string) {
    const row = await loadJob(pool, ctx, jobId);
    if (!canApproveTranslation(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) {
      throw forbidden('Somente o Líder da equipe ou o Diretor aprova, devolve ou cancela traduções');
    }
  }

  /**
   * "Refazer": o Líder ou o Diretor devolve com o motivo. Com `reprocess`, o documento é processado de novo
   * (útil depois de ajustar o glossário); sem, a equipe corrige o rascunho atual.
   */
  async function returnForChanges(ctx: AuthenticatedContext, jobId: string, input: { comment: string; reprocess?: boolean }) {
    await requireApprover(ctx, jobId);
    return transition(
      ctx,
      jobId,
      (row) => row.status === 'awaiting_approval' || (input.reprocess === true && row.status === 'in_review'),
      async (db, row) => {
        await db.query(
          input.reprocess
            ? `UPDATE translation_jobs SET status = 'queued', requested_mode = 'auto', attempts = 0, run_after = now(), failure_code = NULL,
                      review_comment = $2, updated_at = now() WHERE id = $1`
            : `UPDATE translation_jobs SET status = 'in_review', review_comment = $2, updated_at = now() WHERE id = $1`,
          [jobId, input.comment],
        );
        // Conta para o "acerto de primeira" dos painéis.
        if (row.status === 'awaiting_approval')
          await db.query('UPDATE translation_jobs SET redo_count = redo_count + 1 WHERE id = $1', [jobId]);
        await audit(db, ctx, row, 'translation.returned', { revision: row.current_revision, reprocess: input.reprocess === true });
        await notify(
          db,
          {
            teamId: row.team_id,
            operators: !row.assignee_id,
            users: [row.assignee_id, row.submitted_by],
            exclude: ctx.actor.id,
          },
          {
            ...links(row),
            kind: 'translation_returned',
            title: `Refazer: ${row.document_name}`,
            body: `${await nameOf(db, ctx.actor.id)}: ${input.comment}`.slice(0, 1000),
          },
        );
      },
    );
  }

  async function cancel(ctx: AuthenticatedContext, jobId: string) {
    await requireApprover(ctx, jobId);
    return transition(
      ctx,
      jobId,
      (row) => !['approved', 'cancelled', 'failed'].includes(row.status),
      async (db, row) => {
        await db.query(
          `UPDATE translation_jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1`,
          [jobId],
        );
        await audit(db, ctx, row, 'translation.cancelled');
      },
    );
  }

  /** Assumir uma tradução sem responsável (lote do Diretor ou responsável removido). */
  async function claim(ctx: AuthenticatedContext, jobId: string) {
    return transition(
      ctx,
      jobId,
      (row) => !['approved', 'cancelled', 'failed'].includes(row.status),
      async (db, row) => {
        if (!canClaimTranslation(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id }, row.assignee_id)) {
          throw conflict(row.assignee_id ? `Esta tradução já é de ${row.assignee_name}` : 'Você não pode assumir esta tradução');
        }
        await db.query('UPDATE translation_jobs SET assignee_id = $2, updated_at = now() WHERE id = $1', [jobId, ctx.actor.id]);
        await audit(db, ctx, row, 'translation.claimed');
      },
    );
  }

  /**
   * Reatribuir (Supervisor da equipe ou Diretor). O novo responsável precisa ser da equipe do lote; no lote sem equipe,
   * só um Diretor. É assim que o Diretor age sobre o trabalho de outro usuário: passa a outra pessoa, não edita (D4).
   */
  async function reassign(ctx: AuthenticatedContext, jobId: string, userId: string) {
    const row = await loadJob(pool, ctx, jobId);
    if (!canReassignTranslation(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) {
      throw forbidden('Somente o Supervisor da equipe ou o Diretor reatribui traduções');
    }
    return transition(
      ctx,
      jobId,
      (current) => !['approved', 'cancelled', 'failed'].includes(current.status),
      async (db, current) => {
        const target = await db.query<{ ok: boolean; name: string }>(
          `SELECT u.display_name AS name,
                  (u.status = 'active' AND (
                    ($2::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM team_memberships m WHERE m.user_id = u.id AND m.team_id = $2))
                    OR ($2::uuid IS NULL AND u.org_role = 'director'))) AS ok
             FROM users u WHERE u.id = $1`,
          [userId, current.team_id],
        );
        if (!target.rows[0]?.ok) throw new AppError(400, 'VALIDATION_FAILED', 'O novo responsável precisa ser da equipe do documento');
        await db.query('UPDATE translation_jobs SET assignee_id = $2, updated_at = now() WHERE id = $1', [jobId, userId]);
        await audit(db, ctx, current, 'translation.reassigned', { from: current.assignee_id, to: userId });
        await notify(
          db,
          { teamId: current.team_id, users: [userId], exclude: ctx.actor.id },
          {
            ...links(current),
            kind: 'translation_assigned',
            title: `Agora é sua: ${current.document_name}`,
            body: `${await nameOf(db, ctx.actor.id)} passou esta tradução para você.`,
          },
        );
      },
    );
  }

  /** Processa o documento de novo (falha ou rascunho a refazer); a revisão atual continua no histórico. */
  async function reprocess(ctx: AuthenticatedContext, jobId: string) {
    await requireApprover(ctx, jobId);
    return transition(
      ctx,
      jobId,
      (row) => ['in_review', 'awaiting_approval', 'failed'].includes(row.status),
      async (db, row) => {
        await db.query(
          `UPDATE translation_jobs SET status = 'queued', requested_mode = 'auto', attempts = 0, run_after = now(), failure_code = NULL,
                  updated_at = now() WHERE id = $1`,
          [jobId],
        );
        await audit(db, ctx, row, 'translation.reprocess_requested', { revision: row.current_revision });
      },
    ).catch((error: unknown) => {
      // Uma falha reaberta não pode duplicar outra tradução ativa do mesmo documento e idioma.
      if ((error as { code?: string }).code === '23505')
        throw conflict('Já existe outra tradução ativa deste documento para o mesmo idioma');
      throw error;
    });
  }

  /**
   * Conclusão (ADR-007, ADR-012): só Supervisor da equipe ou Diretor; problemas de checagem em aberto exigem justificativa.
   * Quem conclui escolhe o tradutor juramentado e digita o número (e, se usar, livro e folha) conforme as regras dele;
   * o DOCX final é a máscara do tradutor preenchida, gravado imutável. Nada é concluído automaticamente.
   */
  async function approve(ctx: AuthenticatedContext, jobId: string, input: ApproveInput) {
    await requireApprover(ctx, jobId);
    const keyHolder: { key?: string } = {};
    try {
      await withTransaction(pool, async (db) => {
        const row = await loadJob(db, ctx, jobId, true);
        if (row.status !== 'in_review' && row.status !== 'awaiting_approval')
          throw conflict(`Ação não permitida no estado "${row.status}"`);
        const draft = await currentDraft(db, jobId, row.current_revision);
        if (!draft) throw conflict('Não há rascunho para aprovar');
        const content = Draft.parse(draft.content);
        const rules = await loadRules(db, row.translation_mode, row.target_language);
        const issues = checkDraft(content, row.extracted_text, await glossaryFor(db, row), rules);
        const errors = issues.filter((issue) => issue.severity === 'error');
        if (errors.length && !input.overrideReason) {
          throw new AppError(409, 'CONFLICT', 'Há problemas de checagem em aberto; corrija ou justifique a aprovação', { issues: errors });
        }
        // O número sai da cota do responsável; sem responsável, de quem marcou como pronta ou de quem conclui.
        const assigneeId = row.assignee_id ?? row.submitted_by ?? ctx.actor.id;
        if (!withMask(row)) {
          // Certificada, técnica, simples ou juramentada sem máscara (ADR-015, ADR-017): o documento no layout do
          // original, com a fonte da regra e, na certificada, a declaração do tradutor; sem número de Tradução Pública.
          const issuedAt = now();
          const docx = await renderPlainDocx(content, {
            look: rules,
            draft: false,
            statement: rules.statement,
            translatorName: await nameOf(db, assigneeId),
            issuedAt,
          });
          const key = `batches/${row.batch_id}/documents/${row.document_id}/translations/${row.id}.docx`;
          keyHolder.key = key;
          await uploadBuffer(storage, key, docx);
          await db.query(
            `UPDATE translation_jobs SET status = 'approved', approved_by = $2, approved_at = $3, approval_override_reason = $4,
                    output_key = $5, output_sha256 = $6, output_size = $7, assignee_id = $8, updated_at = now()
              WHERE id = $1`,
            [
              jobId,
              ctx.actor.id,
              issuedAt,
              errors.length ? input.overrideReason : null,
              key,
              createHash('sha256').update(docx).digest(),
              docx.length,
              assigneeId,
            ],
          );
          await audit(db, ctx, row, 'translation.approved', {
            revision: row.current_revision,
            mode: row.translation_mode,
            openErrors: errors.length,
            ...(errors.length ? { overrideReason: input.overrideReason } : {}),
          });
          await notify(
            db,
            { teamId: row.team_id, users: [row.owner_id, row.submitted_by, row.requested_by, assigneeId], exclude: ctx.actor.id },
            {
              ...links(row),
              kind: 'translation_approved',
              title: `Concluído: ${row.document_name}`,
              body: `Tradução ${modeLabel[row.translation_mode].toLowerCase()} liberada para download.`,
            },
          );
          return;
        }
        await requireQuota(db, row, assigneeId);
        // Numeração conferida pela regra do tradutor e emitida sob bloqueio (ADR-014); o que veio na conclusão completa
        // ou corrige o que o usuário preencheu.
        const issued = await numbering.issue(
          db,
          ctx,
          { ...row, assignee_id: assigneeId },
          {
            ...(input.translatorId || row.preferred_translator_id
              ? { translatorId: (input.translatorId ?? row.preferred_translator_id)! }
              : {}),
            ...(input.number ? { number: input.number } : {}),
            ...(input.book ? { book: input.book } : {}),
          },
        );
        const mask = await masks(issued.translatorId, null, { source: row.source_language, target: row.target_language, look: rules });
        if (!mask.active) throw conflict(`${mask.name} está inativo; escolha outro tradutor`);
        const numberLabel = issued.number;
        const bookLabel = issued.book ?? input.book ?? null;
        const sheetLabel = issued.sheet ?? input.sheet ?? null;

        const issuedAt = now();
        const year = issuedAt.getUTCFullYear();
        const docx = await fillMask(
          mask.data,
          content,
          { numero: numberLabel, livro: bookLabel ?? '', folha: sheetLabel ?? '', data: issuedAt, tradutor: mask.name },
          mask.name,
          { look: rules },
        );
        const key = `batches/${row.batch_id}/documents/${row.document_id}/translations/${row.id}.docx`;
        keyHolder.key = key;
        await uploadBuffer(storage, key, docx);
        const stored = await storage.head(key);
        if (stored?.size !== docx.length) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Armazenamento indisponível');

        await db.query(
          `UPDATE translation_jobs SET status = 'approved', approved_by = $2, approved_at = $3, approval_override_reason = $4,
                  translator_id = $5, translation_year = $6, number_label = $7, book_label = $8, sheet_label = $9,
                  output_key = $10, output_sha256 = $11, output_size = $12, assignee_id = $13, mask_id = $14, updated_at = now()
            WHERE id = $1`,
          [
            jobId,
            ctx.actor.id,
            issuedAt,
            errors.length ? input.overrideReason : null,
            issued.translatorId,
            year,
            numberLabel,
            bookLabel,
            sheetLabel,
            key,
            createHash('sha256').update(docx).digest(),
            docx.length,
            assigneeId,
            mask.maskId,
          ],
        );
        await notifyQuotaMilestones(db, {
          year,
          teamId: row.team_id,
          userId: assigneeId,
          userName: await nameOf(db, assigneeId),
          teamName: row.team_name,
          translationId: row.id,
        });
        // Memória de tradução (ADR-008): só aprende com aprovações sem justificativa de exceção.
        if (!errors.length) {
          const pairs = memoryPairs(content);
          if (pairs.size) {
            await db.query(
              `INSERT INTO translation_memory (source_language, target_language, source_text, target_text, last_job_id)
               SELECT $1, $2, pair.source, pair.target, $3 FROM jsonb_to_recordset($4::jsonb) AS pair(source text, target text)
               ON CONFLICT (source_language, target_language, source_text)
               DO UPDATE SET target_text = EXCLUDED.target_text, last_job_id = EXCLUDED.last_job_id,
                             uses = translation_memory.uses + 1, updated_at = now()`,
              [
                row.source_language,
                row.target_language,
                row.id,
                JSON.stringify([...pairs].map(([source, target]) => ({ source: source.slice(0, 4000), target: target.slice(0, 8000) }))),
              ],
            );
          }
        }
        await audit(db, ctx, row, 'translation.approved', {
          revision: row.current_revision,
          translator: mask.name,
          maskEdition: mask.edition,
          number: numberLabel,
          book: bookLabel,
          sheet: sheetLabel,
          ...issued.values,
          openErrors: errors.length,
          ...(errors.length ? { overrideReason: input.overrideReason } : {}),
        });
        await notify(
          db,
          { teamId: row.team_id, users: [row.owner_id, row.submitted_by, row.requested_by, assigneeId], exclude: ctx.actor.id },
          {
            ...links(row),
            kind: 'translation_approved',
            title: `Concluído: ${row.document_name}`,
            body: `Tradução Pública nº ${numberLabel} (${mask.name}) liberada para download.${issued.reminder ? ` Lembrete: ${issued.reminder}` : ''}`,
          },
        );
      });
    } catch (error) {
      // Transação desfeita: o objeto gravado não tem registro e é removido.
      if (keyHolder.key) await storage.delete(keyHolder.key).catch(() => undefined);
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(409, 'CONFLICT', 'Este número já foi usado por este tradutor', { reason: 'number_taken' });
      }
      throw error;
    }
    return get(ctx, jobId);
  }

  /** Prévia em DOCX: na máscara do tradutor escolhido ou, sem escolha, no modelo de máscara do sistema. */
  async function preview(
    ctx: AuthenticatedContext,
    jobId: string,
    revisionNumber?: number,
    translatorId?: string,
    /** Conteúdo proposto (combinação da IA ainda não aprovada), mostrado sem gravar nada (ADR-021). */
    proposed?: Draft,
  ) {
    const row = await loadJob(pool, ctx, jobId);
    const stored = proposed ? null : await currentDraft(pool, jobId, revisionNumber ?? row.current_revision);
    const draft = proposed ? { content: proposed } : stored;
    if (!draft) throw notFound('Rascunho não encontrado');
    const rules = await loadRules(pool, row.translation_mode, row.target_language);
    if (!withMask(row)) {
      const docx = await renderPlainDocx(Draft.parse(draft.content), {
        look: rules,
        draft: true,
        statement: rules.statement,
        translatorName: row.assignee_name ?? null,
        issuedAt: now(),
      });
      return { docx, name: `RASCUNHO - ${outputFileName(row.document_name, rules)}` };
    }
    // Tradutor: o pedido na prévia, o da numeração preenchida ou o escolhido no envio (ADR-017).
    const entry = await numbering.getEntry(ctx, jobId, translatorId ?? row.preferred_translator_id ?? undefined).catch(() => null);
    const chosen = translatorId ?? entry?.rule?.translatorId ?? row.preferred_translator_id ?? null;
    const mask = chosen
      ? await masks(chosen, null, { source: row.source_language, target: row.target_language, look: rules })
      : { name: '[tradutor a escolher]', data: new Uint8Array(await renderMaskTemplate(row.target_language)) };
    // Número, livro e folha previstos pela regra do tradutor; o número só é emitido na conclusão.
    const computed = entry?.check?.computed;
    const values = computed?.number
      ? {
          numero: computed.number,
          livro: computed.book ?? '',
          folha: sheetText(computed.sheetStart ?? null, computed.sheetEnd ?? null) ?? '',
          data: now(),
          tradutor: mask.name,
        }
      : null;
    const docx = await fillMask(mask.data, Draft.parse(draft.content), values, mask.name, { look: rules, draft: true });
    return { docx, name: `RASCUNHO - ${outputFileName(row.document_name, rules)}` };
  }

  async function openFinal(ctx: AuthenticatedContext, jobId: string) {
    const row = await loadJob(pool, ctx, jobId);
    if (row.status !== 'approved' || !row.output_key) throw conflict('A tradução ainda não foi aprovada');
    if (row.annulled_at) throw conflict('O número desta tradução foi anulado; ela não vale mais como tradução');
    const stream = await storage.get(row.output_key);
    await audit(pool, ctx, row, 'translation.downloaded');
    // Nome do original com o sufixo do idioma, como pedem as skills (nunca renomear pelo conteúdo).
    const rules = await loadRules(pool, row.translation_mode, row.target_language);
    return { stream, contentType: DOCX_TYPE, name: outputFileName(row.document_name, rules) };
  }

  // ---------- Glossário ----------

  async function listGlossary(
    ctx: AuthenticatedContext,
    query: { sourceLanguage?: Language; targetLanguage?: Language; teamId?: string; q?: string },
  ) {
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions = isDirector(ctx.actor)
      ? []
      : [`(g.team_id IS NULL OR g.team_id = ANY(${param([...ctx.actor.memberships.keys()])}::uuid[]))`];
    if (query.sourceLanguage) conditions.push(`g.source_language = ${param(query.sourceLanguage)}`);
    if (query.targetLanguage) conditions.push(`g.target_language = ${param(query.targetLanguage)}`);
    if (query.teamId) conditions.push(`g.team_id = ${param(query.teamId)}`);
    if (query.q) {
      const pattern = param(likePattern(query.q));
      conditions.push(`(unaccent(g.source_term::text) ILIKE unaccent(${pattern}) OR unaccent(g.target_term) ILIKE unaccent(${pattern}))`);
    }
    const result = await pool.query<{
      id: string;
      source_language: Language;
      target_language: Language;
      source_term: string;
      target_term: string;
      note: string | null;
      origin: string | null;
      team_id: string | null;
      team_name: string | null;
      created_by_name: string;
    }>(
      `SELECT g.id, g.source_language, g.target_language, g.source_term::text, g.target_term, g.note, g.origin, g.team_id, t.name::text AS team_name,
              u.display_name AS created_by_name
         FROM glossary_entries g LEFT JOIN teams t ON t.id = g.team_id JOIN users u ON u.id = g.created_by
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY g.source_term LIMIT 500`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      sourceLanguage: row.source_language,
      targetLanguage: row.target_language,
      sourceTerm: row.source_term,
      targetTerm: row.target_term,
      note: row.note,
      /** De onde veio o termo (ex.: "Skill traducao-eng"). */
      origin: row.origin,
      team: row.team_id ? { id: row.team_id, name: row.team_name ?? '' } : null,
      createdBy: row.created_by_name,
      canEdit: canManageGlossary(ctx.actor, row.team_id),
    }));
  }

  async function addGlossary(
    ctx: AuthenticatedContext,
    input: { sourceLanguage: Language; targetLanguage: Language; sourceTerm: string; targetTerm: string; note?: string; teamId?: string },
  ) {
    const teamId = input.teamId ?? null;
    if (teamId && !canViewTeam(ctx.actor, teamId)) throw notFound('Equipe não encontrada');
    if (!canManageGlossary(ctx.actor, teamId)) {
      throw forbidden(
        teamId
          ? 'Somente o Líder da equipe ou o Diretor edita o glossário da equipe'
          : 'Somente o Diretor edita o glossário da organização',
      );
    }
    if (input.sourceLanguage === input.targetLanguage) throw new AppError(400, 'VALIDATION_FAILED', 'Idiomas iguais');
    try {
      return await withTransaction(pool, async (db) => {
        const created = await db.query<{ id: string }>(
          `INSERT INTO glossary_entries (source_language, target_language, source_term, target_term, note, team_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [input.sourceLanguage, input.targetLanguage, input.sourceTerm, input.targetTerm, input.note ?? null, teamId, ctx.actor.id],
        );
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'glossary.added',
          targetType: 'glossary',
          targetId: created.rows[0]!.id,
          ...(teamId ? { teamId } : {}),
          correlationId: ctx.correlationId,
        });
        return { id: created.rows[0]!.id };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('Esse termo já está no glossário');
      throw error;
    }
  }

  async function removeGlossary(ctx: AuthenticatedContext, id: string) {
    await withTransaction(pool, async (db) => {
      const found = await db.query<{ team_id: string | null }>('SELECT team_id FROM glossary_entries WHERE id = $1 FOR UPDATE', [id]);
      const entry = found.rows[0];
      if (!entry || (entry.team_id && !canViewTeam(ctx.actor, entry.team_id))) throw notFound('Termo não encontrado');
      if (!canManageGlossary(ctx.actor, entry.team_id)) throw forbidden();
      await db.query('DELETE FROM glossary_entries WHERE id = $1', [id]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'glossary.removed',
        targetType: 'glossary',
        targetId: id,
        ...(entry.team_id ? { teamId: entry.team_id } : {}),
        correlationId: ctx.correlationId,
      });
    });
  }

  /** Traduções de cada documento de um lote, para o detalhe do lote. */
  async function forDocuments(documentIds: string[]) {
    if (!documentIds.length) return new Map<string, Array<{ id: string; targetLanguage: Language; status: TranslationStatus }>>();
    const result = await pool.query<{ id: string; document_id: string; target_language: Language; status: TranslationStatus }>(
      `SELECT id, document_id, target_language, status FROM translation_jobs WHERE document_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
      [documentIds],
    );
    const map = new Map<string, Array<{ id: string; targetLanguage: Language; status: TranslationStatus }>>();
    for (const row of result.rows) {
      const list = map.get(row.document_id) ?? [];
      list.push({ id: row.id, targetLanguage: row.target_language, status: row.status });
      map.set(row.document_id, list);
    }
    return map;
  }

  /** Worker visto nos últimos 2 minutos, provedores gratuitos que respondem e se o tradutor público está configurado. */
  async function capabilities() {
    const result = await pool.query<{ online: boolean; last_seen: Date | null; providers: string[] }>(
      `SELECT count(*) > 0 AS online, max(seen_at) AS last_seen,
              coalesce((SELECT array_agg(DISTINCT p) FROM worker_heartbeats w2, unnest(w2.machine_providers) p
                         WHERE w2.seen_at > now() - interval '2 minutes'), '{}') AS providers
         FROM worker_heartbeats WHERE seen_at > now() - interval '2 minutes'`,
    );
    const row = result.rows[0]!;
    const provider = await machineProvider();
    return {
      workerOnline: row.online,
      lastSeenAt: row.last_seen?.toISOString() ?? null,
      machineProviders: row.providers,
      machineProvider: provider,
      /** A tradução automática gratuita funciona agora: provedor escolhido e respondendo em algum worker. */
      machineAvailable: provider !== 'none' && row.providers.includes(provider),
      /** Sem tradutor ativo com máscara, nenhuma tradução pode ser concluída (ADR-012). */
      translatorsReady:
        (
          await pool.query(
            `SELECT 1 FROM sworn_translators s JOIN sworn_translator_masks m ON m.id = s.current_mask_id
              WHERE s.active AND m.configured LIMIT 1`,
          )
        ).rowCount! > 0,
    };
  }

  /** Provedor gratuito escolhido pelo Diretor (ADR-008); sem escolha, o LibreTranslate local. */
  async function machineProvider(): Promise<MachineProviderSetting> {
    const result = await pool.query<{ provider: MachineProviderSetting }>('SELECT provider FROM machine_translation_settings');
    return result.rows[0]?.provider ?? 'libretranslate';
  }

  async function setMachineProvider(ctx: AuthenticatedContext, provider: MachineProviderSetting) {
    if (!canManageTranslationSettings(ctx.actor)) throw forbidden();
    await withTransaction(pool, async (db) => {
      await db.query(
        `INSERT INTO machine_translation_settings (singleton, provider, updated_by) VALUES (true, $1, $2)
         ON CONFLICT (singleton) DO UPDATE SET provider = EXCLUDED.provider, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [provider, ctx.actor.id],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'translation.machine_provider_set',
        targetType: 'settings',
        correlationId: ctx.correlationId,
        // O DeepL envia texto para fora da infraestrutura: a escolha fica registrada.
        metadata: { provider, external: provider === 'deepl' },
      });
    });
    return { provider };
  }

  return {
    capabilities,
    setMachineProvider,
    start,
    list,
    get,
    revisions,
    revision,
    saveDraft,
    submit,
    autoReviewDraft,
    accept,
    returnForChanges,
    cancel,
    reprocess,
    setChecks,
    facets,
    claim,
    reassign,
    approve,
    preview,
    openFinal,
    listGlossary,
    addGlossary,
    removeGlossary,
    forDocuments,
  };
}

export type TranslationService = ReturnType<typeof createTranslationService>;

/**
 * Gera de novo o DOCX final com outra numeração (alteração autorizada, ADR-011/012) na máscara do tradutor da tradução
 * e grava como nova versão; a anterior continua no armazenamento. Roda dentro da transação que altera a numeração.
 */
export async function reissueFinalDocx(
  db: Pick<PoolClient, 'query'>,
  storage: ObjectStorage,
  masks: MaskSource,
  jobId: string,
  numbering: { number: string; book: string | null; sheet: string | null },
) {
  const found = await db.query<{
    content: Draft;
    approved_at: Date;
    batch_id: string;
    document_id: string;
    translator_id: string | null;
    mask_id: string | null;
    translation_mode: Mode;
    source_language: Language;
    target_language: Language;
  }>(
    `SELECT r.content, j.approved_at, d.batch_id, j.document_id, j.translator_id, j.mask_id, j.translation_mode, j.source_language, j.target_language
       FROM translation_jobs j JOIN documents d ON d.id = j.document_id
       JOIN translation_drafts r ON r.job_id = j.id AND r.revision = j.current_revision
      WHERE j.id = $1`,
    [jobId],
  );
  const row = found.rows[0];
  if (!row) throw notFound('Tradução não encontrada');
  if (!row.translator_id) throw conflict('Esta tradução foi concluída antes do cadastro de tradutores e não pode ser renumerada');
  // A mesma edição da máscara com que a tradução foi concluída: só a numeração muda.
  const look = await loadRules(db, row.translation_mode, row.target_language);
  const mask = await masks(row.translator_id, row.mask_id, { source: row.source_language, target: row.target_language, look });
  const docx = await fillMask(
    mask.data,
    Draft.parse(row.content),
    { numero: numbering.number, livro: numbering.book ?? '', folha: numbering.sheet ?? '', data: row.approved_at, tradutor: mask.name },
    mask.name,
    { look },
  );
  const key = `batches/${row.batch_id}/documents/${row.document_id}/translations/${jobId}-${Date.now()}.docx`;
  await uploadBuffer(storage, key, docx);
  await db.query(
    `UPDATE translation_jobs SET number_label = $2, book_label = $3, sheet_label = $4, output_key = $5, output_sha256 = $6, output_size = $7,
            updated_at = now() WHERE id = $1`,
    [jobId, numbering.number, numbering.book, numbering.sheet, key, createHash('sha256').update(docx).digest(), docx.length],
  );
  return key;
}

/** O adaptador grava a partir de arquivo; o DOCX final é pequeno e passa por um temporário. */
async function uploadBuffer(storage: ObjectStorage, key: string, data: Buffer) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tradutor-out-'));
  const file = path.join(directory, 'translation.docx');
  try {
    await writeFile(file, data);
    await storage.putFile(key, file, data.length, DOCX_TYPE);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
