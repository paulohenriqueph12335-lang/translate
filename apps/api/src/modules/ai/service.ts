import { recordAudit, withTransaction } from '@tradutor/core/db';
import {
  AI_TASK_LABEL,
  aiAllowedFor,
  applyLayoutCombination,
  askProcessHelp,
  checkGlossaryWithAi,
  DEFAULT_GOVERNANCE_PROMPT,
  loadAiConfig,
  logAiRequest,
  proposeLayoutCombination,
  type AiFactory,
  type AiTask,
  type LayoutCombination,
} from '@tradutor/core/ai';
import { forgetLayoutKnowledge } from '@tradutor/core/processing';
import { checkDraft, Draft, loadRules, ROLE_LABEL, type GlossaryTerm, type Role, type Mode, type Language } from '@tradutor/core/translation';
import { canEditTranslation, canWorkOnTranslation, isDirector, ledTeams } from '../access/policy.js';
import { AppError, conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';

/**
 * Gerenciamento AI (ADR-021): o Gemini só como gestor de processo e orientador técnico. Líder e Diretor configuram
 * prompt, habilidades e o acesso de cada pessoa; o Diretor liga e desliga. Sem chave, desligada ou fora do ar, o
 * sistema segue normalmente: a IA é auxílio, nunca etapa obrigatória.
 */

interface JobRow {
  id: string;
  team_id: string | null;
  owner_id: string;
  assignee_id: string | null;
  status: string;
  translation_mode: Mode;
  source_language: Language;
  target_language: Language;
  extracted_text: string | null;
  current_revision: number | null;
  document_name: string;
  content: unknown;
  issues: Array<{ code: string; severity: string }> | null;
}

export function createAiService({ pool, ai = null }: ServiceDeps & { ai?: AiFactory }) {
  const canManage = (ctx: AuthenticatedContext) => isDirector(ctx.actor) || ledTeams(ctx.actor).length > 0;
  const requireManager = (ctx: AuthenticatedContext) => {
    if (!canManage(ctx)) throw forbidden('Somente Líderes e o Diretor gerenciam a IA');
  };

  async function status(ctx: AuthenticatedContext) {
    const config = await loadAiConfig(pool);
    const allowed = await aiAllowedFor(pool, ctx.actor.id);
    return {
      /** Chave GEMINI_API_KEY presente no servidor. */
      configured: !!ai,
      enabled: config.enabled,
      model: config.model,
      allowed,
      /** A pessoa pode pedir auxílio agora. */
      available: !!ai && config.enabled && allowed,
      canManage: canManage(ctx),
      canToggle: isDirector(ctx.actor),
    };
  }

  // ---------- Configuração ----------

  async function settings(ctx: AuthenticatedContext) {
    requireManager(ctx);
    const config = await loadAiConfig(pool);
    const skills = await pool.query<{ id: string; name: string; content: string; active: boolean; updated_at: Date; updated_by_name: string }>(
      `SELECT s.id, s.name, s.content, s.active, s.updated_at, u.display_name AS updated_by_name
         FROM ai_skills s JOIN users u ON u.id = s.updated_by ORDER BY s.name`,
    );
    return {
      ...(await status(ctx)),
      governancePrompt: config.governance,
      defaultGovernancePrompt: DEFAULT_GOVERNANCE_PROMPT,
      skills: skills.rows.map((row) => ({
        id: row.id,
        name: row.name,
        content: row.content,
        active: row.active,
        updatedAt: row.updated_at.toISOString(),
        updatedBy: row.updated_by_name,
      })),
    };
  }

  async function updateSettings(ctx: AuthenticatedContext, input: { enabled?: boolean; model?: string; governancePrompt?: string | null }) {
    requireManager(ctx);
    if (input.enabled !== undefined && !isDirector(ctx.actor)) throw forbidden('Somente o Diretor liga e desliga a IA');
    await pool.query(
      `INSERT INTO ai_settings (singleton, enabled, model, governance_prompt, updated_by)
       VALUES (true, coalesce($1, false), coalesce($2, 'gemini-2.5-flash'), $3, $4)
       ON CONFLICT (singleton) DO UPDATE SET
         enabled = coalesce($1, ai_settings.enabled),
         model = coalesce($2, ai_settings.model),
         governance_prompt = CASE WHEN $5 THEN $3 ELSE ai_settings.governance_prompt END,
         updated_by = $4, updated_at = now()`,
      [input.enabled ?? null, input.model ?? null, input.governancePrompt ?? null, ctx.actor.id, input.governancePrompt !== undefined],
    );
    await recordAudit(pool, {
      actorUserId: ctx.actor.id,
      action: 'ai.settings_updated',
      targetType: 'ai',
      targetId: 'settings',
      correlationId: ctx.correlationId,
      metadata: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.governancePrompt !== undefined ? { governancePrompt: input.governancePrompt === null ? 'padrão' : 'editado' } : {}),
      },
    });
    return settings(ctx);
  }

  async function saveSkill(ctx: AuthenticatedContext, input: { id?: string; name: string; content: string; active: boolean }) {
    requireManager(ctx);
    try {
      if (input.id) {
        const updated = await pool.query(
          `UPDATE ai_skills SET name = $2, content = $3, active = $4, updated_by = $5, updated_at = now() WHERE id = $1`,
          [input.id, input.name, input.content, input.active, ctx.actor.id],
        );
        if (!updated.rowCount) throw notFound('Habilidade não encontrada');
      } else {
        await pool.query(`INSERT INTO ai_skills (name, content, active, created_by, updated_by) VALUES ($1, $2, $3, $4, $4)`, [
          input.name,
          input.content,
          input.active,
          ctx.actor.id,
        ]);
      }
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('Já existe uma habilidade com esse nome');
      throw error;
    }
    await recordAudit(pool, {
      actorUserId: ctx.actor.id,
      action: 'ai.skill_saved',
      targetType: 'ai',
      targetId: input.id ?? input.name,
      correlationId: ctx.correlationId,
      metadata: { name: input.name, active: input.active },
    });
    return settings(ctx);
  }

  async function removeSkill(ctx: AuthenticatedContext, id: string) {
    requireManager(ctx);
    const removed = await pool.query('DELETE FROM ai_skills WHERE id = $1 RETURNING name', [id]);
    if (!removed.rowCount) throw notFound('Habilidade não encontrada');
    await recordAudit(pool, { actorUserId: ctx.actor.id, action: 'ai.skill_removed', targetType: 'ai', targetId: id, correlationId: ctx.correlationId });
    return settings(ctx);
  }

  // ---------- Acesso por pessoa ----------

  /** Pessoas que a pessoa pode liberar ou limitar: o Diretor, todas; o Líder, as das equipes que lidera. */
  async function manageable(ctx: AuthenticatedContext) {
    const teams = isDirector(ctx.actor) ? null : ledTeams(ctx.actor);
    const result = await pool.query<{ id: string; name: string; email: string; teams: string[]; allowed: boolean | null; set_by_name: string | null }>(
      `SELECT u.id, u.display_name AS name, u.email::text AS email,
              coalesce(array_agg(DISTINCT t.name::text) FILTER (WHERE t.id IS NOT NULL), '{}') AS teams,
              a.allowed, su.display_name AS set_by_name
         FROM users u
         LEFT JOIN team_memberships m ON m.user_id = u.id
         LEFT JOIN teams t ON t.id = m.team_id
         LEFT JOIN ai_user_access a ON a.user_id = u.id
         LEFT JOIN users su ON su.id = a.set_by
        WHERE u.status = 'active' AND u.org_role <> 'director'
          AND ($1::uuid[] IS NULL OR m.team_id = ANY($1::uuid[]))
        GROUP BY u.id, a.allowed, su.display_name
        ORDER BY lower(u.display_name)`,
      [teams],
    );
    return result.rows;
  }

  async function access(ctx: AuthenticatedContext) {
    requireManager(ctx);
    return {
      items: (await manageable(ctx)).map((row) => ({
        userId: row.id,
        name: row.name,
        email: row.email,
        teams: row.teams,
        allowed: row.allowed ?? true,
        setBy: row.set_by_name,
      })),
    };
  }

  async function setAccess(ctx: AuthenticatedContext, userId: string, allowed: boolean) {
    requireManager(ctx);
    if (!(await manageable(ctx)).some((row) => row.id === userId)) throw forbidden('Você só define o acesso das pessoas das suas equipes');
    await pool.query(
      `INSERT INTO ai_user_access (user_id, allowed, set_by) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET allowed = EXCLUDED.allowed, set_by = EXCLUDED.set_by, set_at = now()`,
      [userId, allowed, ctx.actor.id],
    );
    await recordAudit(pool, {
      actorUserId: ctx.actor.id,
      action: 'ai.access_set',
      targetType: 'user',
      targetId: userId,
      correlationId: ctx.correlationId,
      metadata: { allowed },
    });
    return access(ctx);
  }

  async function requests(ctx: AuthenticatedContext) {
    requireManager(ctx);
    const teams = isDirector(ctx.actor) ? null : ledTeams(ctx.actor);
    const result = await pool.query<{
      id: string;
      task: AiTask;
      status: string;
      reason: string | null;
      duration_ms: number | null;
      created_at: Date;
      user_name: string | null;
      document_name: string | null;
      translation_id: string | null;
    }>(
      `SELECT r.id::text, r.task, r.status, r.reason, r.duration_ms, r.created_at, u.display_name AS user_name,
              d.display_name AS document_name, r.translation_id
         FROM ai_requests r
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN translation_jobs j ON j.id = r.translation_id
         LEFT JOIN documents d ON d.id = j.document_id
         LEFT JOIN batches b ON b.id = d.batch_id
        WHERE $1::uuid[] IS NULL OR b.team_id = ANY($1::uuid[]) OR r.user_id = $2
           OR r.user_id IN (SELECT user_id FROM team_memberships WHERE team_id = ANY($1::uuid[]))
        ORDER BY r.created_at DESC LIMIT 100`,
      [teams, ctx.actor.id],
    );
    const counts = await pool.query<{ status: string; total: number }>(
      `SELECT status, count(*)::int AS total FROM ai_requests WHERE created_at > now() - interval '30 days' GROUP BY status`,
    );
    return {
      last30Days: Object.fromEntries(counts.rows.map((row) => [row.status, row.total])),
      items: result.rows.map((row) => ({
        id: row.id,
        task: row.task,
        taskLabel: AI_TASK_LABEL[row.task],
        status: row.status,
        reason: row.reason,
        durationMs: row.duration_ms,
        at: row.created_at.toISOString(),
        user: row.user_name,
        document: row.document_name,
        translationId: row.translation_id,
      })),
    };
  }

  // ---------- Tarefas ----------

  async function loadJob(ctx: AuthenticatedContext, jobId: string) {
    const row = (
      await pool.query<JobRow>(
        `SELECT j.id, b.team_id, b.owner_id, j.assignee_id, j.status, j.translation_mode, j.source_language, j.target_language,
                j.extracted_text, j.current_revision, d.display_name AS document_name, r.content, r.issues
           FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
           LEFT JOIN translation_drafts r ON r.job_id = j.id AND r.revision = j.current_revision
          WHERE j.id = $1`,
        [jobId],
      )
    ).rows[0];
    if (!row || !canWorkOnTranslation(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) throw notFound('Tradução não encontrada');
    return row;
  }

  /** Liberada, configurada e permitida para a pessoa; senão, registra e responde por quê (sem travar nada). */
  async function gate(ctx: AuthenticatedContext, task: AiTask, translationId: string | null) {
    const config = await loadAiConfig(pool);
    const reason = !ai
      ? 'IA não configurada no servidor (GEMINI_API_KEY)'
      : !config.enabled
        ? 'IA desligada em Gerenciamento AI'
        : !(await aiAllowedFor(pool, ctx.actor.id))
          ? 'Seu acesso à IA foi limitado pela liderança'
          : null;
    if (reason) {
      await logAiRequest(pool, { userId: ctx.actor.id, translationId, task, status: reason.startsWith('Seu acesso') ? 'denied' : 'unavailable', reason });
      throw new AppError(reason.startsWith('Seu acesso') ? 403 : 503, reason.startsWith('Seu acesso') ? 'FORBIDDEN' : 'DEPENDENCY_UNAVAILABLE', reason, {
        reason: 'ai_unavailable',
      });
    }
    return { config, provider: ai!(config.model) };
  }

  async function glossaryCheck(ctx: AuthenticatedContext, translationId: string) {
    const job = await loadJob(ctx, translationId);
    const parsed = Draft.safeParse(job.content);
    if (!parsed.success) throw conflict('A tradução ainda não tem rascunho');
    const { config, provider } = await gate(ctx, 'glossary_check', translationId);
    const glossary = (
      await pool.query<GlossaryTerm>(
        `SELECT source_term::text AS source, target_term AS target FROM glossary_entries
          WHERE source_language = $1 AND target_language = $2 AND (team_id IS NULL OR team_id = $3)`,
        [job.source_language, job.target_language, job.team_id],
      )
    ).rows;
    const outcome = await checkGlossaryWithAi(provider, config, parsed.data, glossary);
    await logAiRequest(pool, {
      userId: ctx.actor.id,
      translationId,
      task: 'glossary_check',
      status: outcome.status,
      reason: outcome.status === 'ok' ? (outcome.output.discarded ? `${outcome.output.discarded} apontamento(s) inválido(s) descartado(s)` : null) : outcome.reason,
      durationMs: outcome.durationMs,
    });
    // A conferência do próprio sistema (determinística) vem junto: a IA não substitui a checagem, só a reforça.
    const rules = await loadRules(pool, job.translation_mode, job.target_language);
    const system = checkDraft(parsed.data, job.extracted_text, glossary, rules).filter((issue) => issue.code === 'glossary_not_applied');
    return {
      status: outcome.status,
      reason: outcome.status === 'ok' ? null : outcome.reason,
      findings: outcome.status === 'ok' ? outcome.output.findings : [],
      systemFindings: system.map((issue) => issue.message),
    };
  }

  async function proposeLayout(ctx: AuthenticatedContext, translationId: string) {
    const job = await loadJob(ctx, translationId);
    if (job.status !== 'in_review' && job.status !== 'awaiting_approval') throw conflict('A diagramação só muda enquanto a tradução está em revisão');
    await gate(ctx, 'layout_combination', translationId);
    const result = await proposeLayoutCombination(pool, ai, translationId, ctx.actor.id);
    if (result.status !== 'ok') return { status: result.status, reason: result.reason ?? null, combination: null };
    return { status: 'ok' as const, reason: null, combination: await combinationView(result.combinationId!) };
  }

  async function combinationView(id: string) {
    const row = (
      await pool.query<{ id: string; translation_id: string; status: string; rationale: string | null; created_at: Date; sample: LayoutCombination['sample'] }>(
        'SELECT id, translation_id, status, rationale, created_at, sample FROM ai_layout_combinations WHERE id = $1',
        [id],
      )
    ).rows[0];
    if (!row) throw notFound('Combinação não encontrada');
    return {
      id: row.id,
      translationId: row.translation_id,
      status: row.status,
      rationale: row.rationale,
      createdAt: row.created_at.toISOString(),
      styles: Object.entries(row.sample.styles).map(([role, style]) => ({ role, label: ROLE_LABEL[role as Role], ...style })),
      fieldsAsTable: row.sample.fieldsAsTable,
      labelWidth: row.sample.labelWidth,
    };
  }

  /** Última combinação proposta da tradução (a que espera aprovação), para a tela. */
  async function pendingFor(ctx: AuthenticatedContext, translationId: string) {
    await loadJob(ctx, translationId);
    const row = (
      await pool.query<{ id: string }>(
        `SELECT id FROM ai_layout_combinations WHERE translation_id = $1 AND status = 'proposed' ORDER BY created_at DESC LIMIT 1`,
        [translationId],
      )
    ).rows[0];
    return { combination: row ? await combinationView(row.id) : null };
  }

  /** Rascunho com a combinação aplicada, para a prévia (nada é gravado). */
  async function proposedDraft(ctx: AuthenticatedContext, combinationId: string) {
    const combination = (
      await pool.query<{ translation_id: string; sample: LayoutCombination['sample']; rationale: string | null }>(
        'SELECT translation_id, sample, rationale FROM ai_layout_combinations WHERE id = $1',
        [combinationId],
      )
    ).rows[0];
    if (!combination) throw notFound('Combinação não encontrada');
    const job = await loadJob(ctx, combination.translation_id);
    const parsed = Draft.safeParse(job.content);
    if (!parsed.success) throw conflict('A tradução não tem rascunho');
    const applied = applyLayoutCombination(parsed.data, { sample: combination.sample, rationale: combination.rationale ?? '' });
    if (!applied.ok) throw conflict(applied.reason);
    return { job, draft: applied.draft, changes: applied.changes };
  }

  /** Aprovada pela pessoa na prévia: vira revisão do documento e passa a valer para documentos parecidos. */
  async function decide(ctx: AuthenticatedContext, combinationId: string, approve: boolean) {
    const { job, draft, changes } = await proposedDraft(ctx, combinationId);
    if (!canEditTranslation(ctx.actor, { teamId: job.team_id, ownerId: job.owner_id }, job.assignee_id) && !isDirector(ctx.actor)) {
      throw forbidden('Somente quem trabalha na tradução ou a liderança aprova a combinação');
    }
    await withTransaction(pool, async (db) => {
      const current = (
        await db.query<{ status: string }>('SELECT status FROM ai_layout_combinations WHERE id = $1 FOR UPDATE', [combinationId])
      ).rows[0];
      if (current?.status !== 'proposed') throw conflict('Esta combinação já foi decidida');
      await db.query(`UPDATE ai_layout_combinations SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [
        combinationId,
        approve ? 'approved' : 'rejected',
        ctx.actor.id,
      ]);
      if (approve) {
        const rules = await loadRules(db, job.translation_mode, job.target_language);
        const glossary = (
          await db.query<GlossaryTerm>(
            `SELECT source_term::text AS source, target_term AS target FROM glossary_entries
              WHERE source_language = $1 AND target_language = $2 AND (team_id IS NULL OR team_id = $3)`,
            [job.source_language, job.target_language, job.team_id],
          )
        ).rows;
        const issues = checkDraft(draft, job.extracted_text, glossary, rules);
        const next = (job.current_revision ?? 0) + 1;
        const corrections = [
          { code: 'layout', block: 0, message: 'Combinação de diagramação da IA aprovada na prévia', before: '', after: '' },
          ...changes.map((change) => ({ code: 'layout', ...change })),
        ];
        await db.query(
          `INSERT INTO translation_drafts (job_id, revision, content, issues, origin, author_id, corrections) VALUES ($1, $2, $3, $4, 'review', $5, $6)`,
          [job.id, next, JSON.stringify(draft), JSON.stringify(issues), ctx.actor.id, JSON.stringify(corrections)],
        );
        await db.query(`UPDATE translation_jobs SET current_revision = $2, updated_at = now() WHERE id = $1`, [job.id, next]);
      }
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: approve ? 'ai.layout_approved' : 'ai.layout_rejected',
        targetType: 'translation',
        targetId: job.id,
        ...(job.team_id ? { teamId: job.team_id } : {}),
        correlationId: ctx.correlationId,
        metadata: { combination: combinationId },
      });
    });
    // O conhecimento de diagramação passa a incluir a combinação aprovada já na próxima tradução.
    if (approve) forgetLayoutKnowledge();
    return { combination: await combinationView(combinationId) };
  }

  async function ask(ctx: AuthenticatedContext, input: { question: string; translationId?: string }) {
    const job = input.translationId ? await loadJob(ctx, input.translationId) : null;
    const { config, provider } = await gate(ctx, 'process_help', job?.id ?? null);
    const context = job
      ? {
          documento: job.document_name,
          situacao: job.status,
          modalidade: job.translation_mode,
          idiomas: `${job.source_language} → ${job.target_language}`,
          problemas_em_aberto: (job.issues ?? []).filter((issue) => issue.severity === 'error').map((issue) => issue.code),
        }
      : {};
    const outcome = await askProcessHelp(provider, config, input.question, context);
    await logAiRequest(pool, {
      userId: ctx.actor.id,
      translationId: job?.id ?? null,
      task: 'process_help',
      status: outcome.status,
      reason: outcome.status === 'ok' ? null : outcome.reason,
      durationMs: outcome.durationMs,
    });
    return outcome.status === 'ok'
      ? { status: 'ok' as const, answer: outcome.output.answer }
      : { status: outcome.status, answer: null, reason: outcome.reason };
  }

  return { status, settings, updateSettings, saveSkill, removeSkill, access, setAccess, requests, glossaryCheck, proposeLayout, pendingFor, proposedDraft, decide, ask };
}

export type AiService = ReturnType<typeof createAiService>;
