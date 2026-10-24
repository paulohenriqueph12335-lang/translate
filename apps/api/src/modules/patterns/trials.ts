import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTransaction } from '@tradutor/core/db';
import type { Draft, Language, Mode, Stage } from '@tradutor/core/translation';
import { isDirector, ledTeams } from '../access/policy.js';
import { AppError, conflict, notFound } from '../../http/errors.js';
import { recordAudit } from '../audit/audit.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';

export const LAYOUT_PRESETS = ['source', 'left', 'justify', 'center'] as const;
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];
const stages = ['correction', 'translation', 'layout', 'review'];
type LayoutValue = Record<string, unknown>;
interface TrialRow {
  id: string;
  owner_id: string;
  team_id: string | null;
  revision: number;
  consecutive_rejections: number;
  format_generation: number;
  layout_preset: LayoutPreset;
  result_digest: string | null;
  source_layout: LayoutValue[];
  current_layout: LayoutValue[];
  requires_regeneration: boolean;
  decision: 'approved' | 'rejected' | null;
  failed_stages: Stage[];
  comment: string | null;
}
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, v]) => [key, sorted(v)]),
        )
      : value;
export const trialDigest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(sorted(value)))
    .digest('hex');
export const trialDto = (row: TrialRow) => ({
  id: row.id,
  revision: row.revision,
  consecutiveRejections: row.consecutive_rejections,
  blocked: row.consecutive_rejections >= 3,
  formatGeneration: row.format_generation,
  layoutPreset: row.layout_preset,
  requiresRegeneration: row.requires_regeneration,
  decision: row.decision,
  failedStages: row.failed_stages,
  comment: row.comment,
});

/** Only structural properties are persisted; no text/sourceText, names, document titles or file names. */
export function trialLayout(draft: Draft): LayoutValue[] {
  return draft.blocks.map((block) => {
    if (block.kind === 'paragraph') return { kind: block.kind, align: block.align, bold: block.bold, size: block.size };
    if (block.kind === 'heading') return { kind: block.kind, align: block.align, level: block.level };
    if (block.kind === 'table')
      return {
        kind: block.kind,
        columns: block.columns,
        rows: block.rows.map((row) => ({
          style: row.style,
          cells: row.cells.map((cell) => ({ align: cell.align, bold: cell.bold, colSpan: cell.colSpan, rowSpan: cell.rowSpan })),
        })),
      };
    return { kind: block.kind };
  });
}
export function applyTrialPreset(draft: Draft, preset: LayoutPreset): Draft {
  if (preset === 'source') return draft;
  return {
    ...draft,
    blocks: draft.blocks.map((block) =>
      block.kind === 'paragraph' || block.kind === 'heading'
        ? { ...block, align: preset }
        : block.kind === 'table'
          ? { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, align: preset })) })) }
          : block,
    ),
  };
}
function presetLayout(source: LayoutValue[], preset: LayoutPreset): LayoutValue[] {
  if (preset === 'source') return source;
  return source.map((block) =>
    block.kind === 'paragraph' || block.kind === 'heading'
      ? { ...block, align: preset }
      : block.kind === 'table'
        ? {
            ...block,
            rows: (block.rows as Array<{ style: string; cells: LayoutValue[] }>).map((row) => ({
              ...row,
              cells: row.cells.map((cell) => ({ ...cell, align: preset })),
            })),
          }
        : block,
  );
}

export function createPatternTrialService({ pool }: ServiceDeps) {
  const teamOf = (ctx: AuthenticatedContext) => (isDirector(ctx.actor) ? null : ([...ctx.actor.memberships.keys()].sort()[0] ?? null));
  async function load(ctx: AuthenticatedContext, id: string, db: Pick<PoolClient, 'query'> = pool, lock = false) {
    const row = (await db.query<TrialRow>(`SELECT * FROM pattern_trials WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
    if (
      !row ||
      ctx.actor.status !== 'active' ||
      (!isDirector(ctx.actor) &&
        !(row.owner_id === ctx.actor.id && (row.team_id === null || ctx.actor.memberships.has(row.team_id))) &&
        !(row.team_id && ledTeams(ctx.actor).includes(row.team_id)))
    )
      throw notFound('Ensaio não encontrado');
    return row;
  }
  const audit = (
    db: Pick<PoolClient, 'query'>,
    ctx: AuthenticatedContext,
    row: TrialRow,
    action: string,
    metadata: Record<string, unknown>,
  ) =>
    recordAudit(db, {
      actorUserId: ctx.actor.id,
      action,
      targetType: 'pattern_trial',
      targetId: row.id,
      ...(row.team_id ? { teamId: row.team_id } : {}),
      correlationId: ctx.correlationId,
      metadata,
    });
  async function begin(ctx: AuthenticatedContext, file: Buffer, input: { sourceLanguage: Language; targetLanguage: Language; mode: Mode }) {
    const digest = createHash('sha256').update(file).digest('hex');
    const team = teamOf(ctx);
    const fingerprint = trialDigest({
      digest,
      owner: ctx.actor.id,
      team,
      source: input.sourceLanguage,
      target: input.targetLanguage,
      mode: input.mode,
    });
    await pool.query(
      `INSERT INTO pattern_trials(owner_id,team_id,fingerprint,file_digest,source_language,target_language,mode) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(fingerprint) DO NOTHING`,
      [ctx.actor.id, team, fingerprint, digest, input.sourceLanguage, input.targetLanguage, input.mode],
    );
    const row = (await pool.query<TrialRow>('SELECT * FROM pattern_trials WHERE fingerprint=$1', [fingerprint])).rows[0]!;
    if (row.consecutive_rejections >= 3)
      throw new AppError(409, 'CONFLICT', 'Três reprovações consecutivas: registre uma nova formatação real antes de testar novamente', {
        reason: 'pattern_review_attempts_exhausted',
        trial: trialDto(row),
      });
    return row;
  }
  async function complete(
    ctx: AuthenticatedContext,
    started: TrialRow,
    source: Draft,
    draft: Draft,
    preset: LayoutPreset,
    renderProperties: Record<string, unknown> = {},
  ) {
    return withTransaction(pool, async (db) => {
      const row = await load(ctx, started.id, db, true);
      if (row.consecutive_rejections >= 3)
        throw new AppError(409, 'CONFLICT', 'O ensaio foi bloqueado durante o processamento', { trial: trialDto(row) });
      if (row.format_generation !== started.format_generation || row.requires_regeneration !== started.requires_regeneration)
        throw conflict('O formato mudou durante o teste; execute novamente');
      if (row.requires_regeneration && trialDigest(trialLayout(draft)) === trialDigest(row.current_layout))
        throw new AppError(
          409,
          'CONFLICT',
          'A diagramação gerada ficou igual à anterior. Registre outra opção de formatação e gere o Word novamente',
          {
            reason: 'pattern_format_layout_unchanged',
            trial: trialDto(row),
          },
        );
      const digest = trialDigest({ draft, renderProperties });
      if (row.result_digest === digest && !row.requires_regeneration) return trialDto(row);
      if (row.revision !== started.revision) throw conflict('Outra revisão foi gerada; execute o teste novamente');
      const updated = (
        await db.query<TrialRow>(
          `UPDATE pattern_trials SET revision=revision+1,result_digest=$2,source_layout=$3,current_layout=$4,layout_preset=$5,
        requires_regeneration=false,decision=NULL,failed_stages='{}',comment=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
          [row.id, digest, JSON.stringify(trialLayout(source)), JSON.stringify(trialLayout(draft)), preset],
        )
      ).rows[0]!;
      await audit(db, ctx, updated, 'pattern.trial_generated', {
        revision: updated.revision,
        formatGeneration: updated.format_generation,
        layoutPreset: preset,
      });
      return trialDto(updated);
    });
  }
  async function inspect(
    ctx: AuthenticatedContext,
    id: string,
    input: { baseRevision: number; decision: 'approved' | 'rejected'; failedStages: Stage[]; comment?: string },
  ) {
    if (
      !['approved', 'rejected'].includes(input.decision) ||
      !Array.isArray(input.failedStages) ||
      input.failedStages.some((stage) => !stages.includes(stage))
    )
      throw new AppError(400, 'VALIDATION_FAILED', 'Decisão ou fases inválidas');
    if (input.decision === 'rejected' && (!input.failedStages.length || !input.comment || input.comment.trim().length < 3))
      throw new AppError(400, 'VALIDATION_FAILED', 'Informe as fases com falha e o motivo da reprovação');
    if (input.decision === 'approved' && input.failedStages.length)
      throw new AppError(400, 'VALIDATION_FAILED', 'A aprovação não pode conter fases com falha');
    return withTransaction(pool, async (db) => {
      const row = await load(ctx, id, db, true);
      if (row.consecutive_rejections >= 3)
        throw new AppError(409, 'CONFLICT', 'Registre uma nova formatação antes de continuar', { trial: trialDto(row) });
      if (row.revision < 1 || row.revision !== input.baseRevision || row.requires_regeneration)
        throw conflict('Gere e compare o Word da revisão atual antes de decidir');
      if (row.decision) throw conflict('Esta revisão já foi decidida; corrija a diagramação e gere outra revisão');
      const count = input.decision === 'rejected' ? row.consecutive_rejections + 1 : 0;
      const uniqueStages = [...new Set(input.failedStages)];
      const comment = input.comment?.trim() || null;
      await db.query(
        `INSERT INTO pattern_trial_reviews(trial_id,revision,format_generation,decision,failed_stages,comment,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [id, row.revision, row.format_generation, input.decision, uniqueStages, comment, ctx.actor.id],
      );
      const updated = (
        await db.query<TrialRow>(
          `UPDATE pattern_trials SET decision=$2,failed_stages=$3,comment=$4,consecutive_rejections=$5,updated_at=now() WHERE id=$1 RETURNING *`,
          [id, input.decision, uniqueStages, comment, count],
        )
      ).rows[0]!;
      await audit(
        db,
        ctx,
        updated,
        count >= 3 ? 'pattern.review_blocked' : input.decision === 'rejected' ? 'pattern.trial_rejected' : 'pattern.trial_approved',
        {
          revision: row.revision,
          formatGeneration: row.format_generation,
          failedStages: uniqueStages,
          comment,
          consecutiveRejections: count,
          blocked: count >= 3,
          severity: count >= 3 ? 'critical' : input.decision === 'rejected' ? 'warning' : 'info',
        },
      );
      return { trial: trialDto(updated) };
    });
  }
  async function registerFormat(
    ctx: AuthenticatedContext,
    id: string,
    input: { baseRevision: number; name: string; explanation: string; layoutPreset: LayoutPreset },
  ) {
    if (
      !LAYOUT_PRESETS.includes(input.layoutPreset) ||
      input.name.trim().length < 3 ||
      input.name.length > 120 ||
      input.explanation.trim().length < 5 ||
      input.explanation.length > 2000
    )
      throw new AppError(400, 'VALIDATION_FAILED', 'Informe um nome, motivo e uma opção de diagramação válidos');
    return withTransaction(pool, async (db) => {
      const row = await load(ctx, id, db, true);
      if (row.revision < 1 || row.revision !== input.baseRevision)
        throw conflict('A revisão mudou; recarregue antes de registrar a formatação');
      if (row.requires_regeneration && row.layout_preset === input.layoutPreset)
        throw new AppError(400, 'VALIDATION_FAILED', 'Esta opção de formatação já está pendente; escolha outra diagramação');
      const nextLayout = presetLayout(row.source_layout, input.layoutPreset);
      if (trialDigest(nextLayout) === trialDigest(row.current_layout))
        throw new AppError(400, 'VALIDATION_FAILED', 'Escolha uma diagramação realmente diferente; nome e motivo não alteram o Word');
      const updated = (
        await db.query<TrialRow>(
          `UPDATE pattern_trials SET format_generation=format_generation+1,layout_preset=$2,consecutive_rejections=0,
        requires_regeneration=true,decision=NULL,failed_stages='{}',comment=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
          [id, input.layoutPreset],
        )
      ).rows[0]!;
      await db.query(
        `INSERT INTO pattern_trial_formats(trial_id,format_generation,name,explanation,layout_preset,layout_digest,registered_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          updated.format_generation,
          input.name.trim(),
          input.explanation.trim(),
          input.layoutPreset,
          trialDigest(nextLayout),
          ctx.actor.id,
        ],
      );
      await audit(db, ctx, updated, 'pattern.format_registered', {
        revision: row.revision,
        formatGeneration: updated.format_generation,
        name: input.name.trim(),
        explanation: input.explanation.trim(),
        layoutPreset: input.layoutPreset,
      });
      return { trial: trialDto(updated) };
    });
  }
  async function get(ctx: AuthenticatedContext, id: string) {
    const row = await load(ctx, id);
    const history = await pool.query<{
      revision: number;
      format_generation: number;
      decision: string;
      failed_stages: Stage[];
      comment: string | null;
      reviewed_at: Date;
      reviewed_by: string;
    }>(
      `SELECT revision,format_generation,decision,failed_stages,comment,reviewed_at,reviewed_by FROM pattern_trial_reviews WHERE trial_id=$1 ORDER BY revision DESC LIMIT 100`,
      [id],
    );
    return {
      trial: trialDto(row),
      history: history.rows.map((item) => ({
        revision: item.revision,
        formatGeneration: item.format_generation,
        decision: item.decision,
        failedStages: item.failed_stages,
        comment: item.comment,
        reviewedAt: item.reviewed_at.toISOString(),
        reviewedBy: item.reviewed_by,
      })),
    };
  }
  return { begin, complete, inspect, registerFormat, get };
}
