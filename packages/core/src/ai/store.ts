import type { Queryable } from '../db/pool.js';
import { notify } from '../db/notifications.js';
import { Draft } from '../translation/draft.js';
import { DEFAULT_AI_MODEL, type AiProvider } from './gemini.js';
import { DEFAULT_GOVERNANCE_PROMPT, proposeLayoutWithAi, type AiOutcome, type AiSkill, type AiTask } from './governance.js';

/** Fábrica do provedor pelo modelo escolhido em Gerenciamento AI; `null` sem chave configurada. */
export type AiFactory = ((model: string) => AiProvider) | null;

export interface AiConfig {
  enabled: boolean;
  model: string;
  governance: string;
  skills: AiSkill[];
}

/** Configuração em vigor: ligada ou não, modelo, governança e habilidades ativas. */
export async function loadAiConfig(db: Queryable): Promise<AiConfig> {
  const settings = (
    await db.query<{ enabled: boolean; model: string; governance_prompt: string | null }>('SELECT enabled, model, governance_prompt FROM ai_settings')
  ).rows[0];
  const skills = (await db.query<AiSkill>('SELECT name, content FROM ai_skills WHERE active ORDER BY name')).rows;
  return {
    enabled: settings?.enabled ?? false,
    model: settings?.model ?? DEFAULT_AI_MODEL,
    governance: settings?.governance_prompt ?? DEFAULT_GOVERNANCE_PROMPT,
    skills,
  };
}

/** A pessoa pode usar a IA: sem bloqueio registrado pelo Líder ou pelo Diretor. */
export async function aiAllowedFor(db: Queryable, userId: string | null) {
  if (!userId) return true;
  const row = (await db.query<{ allowed: boolean }>('SELECT allowed FROM ai_user_access WHERE user_id = $1', [userId])).rows[0];
  return row?.allowed ?? true;
}

export async function logAiRequest(
  db: Queryable,
  entry: { userId: string | null; translationId: string | null; task: AiTask; status: string; reason?: string | null; durationMs?: number },
) {
  await db.query(
    `INSERT INTO ai_requests (user_id, translation_id, task, status, reason, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.userId, entry.translationId, entry.task, entry.status, entry.reason?.slice(0, 500) ?? null, entry.durationMs ?? null],
  );
}

/**
 * Pede à IA uma combinação de diagramação para a revisão atual e guarda como proposta (nunca aplica sozinha). Usado
 * em segundo plano pelo worker quando o sistema trava num documento novo, e sob demanda na tela da tradução.
 */
export async function proposeLayoutCombination(
  db: Queryable,
  factory: AiFactory,
  jobId: string,
  userId: string | null,
): Promise<{ status: AiOutcome<unknown>['status'] | 'denied'; reason?: string; combinationId?: string }> {
  const config = await loadAiConfig(db);
  if (!config.enabled || !factory) {
    return { status: 'unavailable', reason: !factory ? 'IA não configurada (chave GEMINI_API_KEY ausente)' : 'IA desligada em Gerenciamento AI' };
  }
  if (!(await aiAllowedFor(db, userId))) {
    await logAiRequest(db, { userId, translationId: jobId, task: 'layout_combination', status: 'denied', reason: 'Acesso à IA bloqueado para a pessoa' });
    return { status: 'denied', reason: 'Seu acesso à IA foi limitado pela liderança' };
  }
  const row = (
    await db.query<{ content: unknown; revision: number }>(
      `SELECT r.content, r.revision FROM translation_jobs j JOIN translation_drafts r ON r.job_id = j.id AND r.revision = j.current_revision WHERE j.id = $1`,
      [jobId],
    )
  ).rows[0];
  const draft = row ? Draft.safeParse(row.content) : null;
  if (!row || !draft?.success) return { status: 'failed', reason: 'Tradução sem rascunho' };
  const outcome = await proposeLayoutWithAi(factory(config.model), config, draft.data);
  await logAiRequest(db, {
    userId,
    translationId: jobId,
    task: 'layout_combination',
    status: outcome.status,
    reason: outcome.status === 'ok' ? null : outcome.reason,
    durationMs: outcome.durationMs,
  });
  if (outcome.status !== 'ok') return { status: outcome.status, reason: outcome.reason };
  const created = await db.query<{ id: string }>(
    `INSERT INTO ai_layout_combinations (translation_id, revision, sample, rationale, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [jobId, row.revision, JSON.stringify(outcome.output.sample), outcome.output.rationale.slice(0, 600), userId],
  );
  return { status: 'ok', combinationId: created.rows[0]!.id };
}

/** Em segundo plano, depois do processamento: propõe e avisa quem trabalha na tradução. Erros não interrompem nada. */
export async function proposeLayoutInBackground(db: Queryable, factory: AiFactory, jobId: string, userId: string | null) {
  try {
    const result = await proposeLayoutCombination(db, factory, jobId, userId);
    if (result.status !== 'ok') return;
    const job = (
      await db.query<{ name: string; batch_id: string; document_id: string; team_id: string | null; assignee_id: string | null }>(
        `SELECT d.display_name AS name, d.batch_id, j.document_id, b.team_id, j.assignee_id
           FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id WHERE j.id = $1`,
        [jobId],
      )
    ).rows[0];
    if (!job) return;
    await notify(
      db,
      job.assignee_id ? { teamId: job.team_id, users: [job.assignee_id] } : { teamId: job.team_id, leaders: true, operators: true },
      {
        kind: 'translation_ready',
        title: `Sugestão de diagramação da IA: ${job.name}`,
        body: 'A IA propôs uma combinação de diagramação para este documento novo. Confira a prévia e aprove ou descarte.',
        batchId: job.batch_id,
        documentId: job.document_id,
        translationId: jobId,
      },
    );
  } catch {
    // A IA é auxílio: qualquer falha aqui fica sem efeito no fluxo da tradução.
  }
}
