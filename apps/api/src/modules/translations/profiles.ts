import { recordAudit, withTransaction } from '@tradutor/core/db';
import {
  defaultRules,
  effectiveRules,
  LANGUAGES,
  MODE_STAGES,
  modeLabel,
  MODES,
  stageLabel,
  type Language,
  type Mode,
  type TranslationRules,
} from '@tradutor/core/translation';
import { isDirector, ledTeams } from '../access/policy.js';
import { forbidden } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';

/** Regras das modalidades (ADR-015): todos consultam; Supervisores e Diretor ajustam. */
export function createProfileService({ pool }: ServiceDeps) {
  const canEdit = (ctx: AuthenticatedContext) => isDirector(ctx.actor) || ledTeams(ctx.actor).length > 0;

  async function list(ctx: AuthenticatedContext) {
    const overrides = await pool.query<{ mode: Mode; target_language: Language; rules: unknown; updated_at: Date; name: string }>(
      `SELECT p.mode, p.target_language, p.rules, p.updated_at, u.display_name AS name
         FROM translation_profiles p JOIN users u ON u.id = p.updated_by`,
    );
    const byKey = new Map(overrides.rows.map((row) => [`${row.mode}:${row.target_language}`, row]));
    return {
      canEdit: canEdit(ctx),
      modes: MODES.map((mode) => ({
        mode,
        label: modeLabel[mode],
        stages: MODE_STAGES[mode].map((stage) => ({ stage, label: stageLabel[stage] })),
        languages: LANGUAGES.map((target) => {
          const override = byKey.get(`${mode}:${target}`);
          return {
            target,
            rules: effectiveRules(mode, target, override?.rules),
            customized: !!override,
            updatedBy: override?.name ?? null,
            updatedAt: override?.updated_at.toISOString() ?? null,
          };
        }),
      })),
    };
  }

  /** Grava o ajuste (só o que difere do padrão); `null` volta ao padrão das skills. */
  async function set(ctx: AuthenticatedContext, mode: Mode, target: Language, rules: TranslationRules | null) {
    if (!canEdit(ctx)) throw forbidden('Somente Supervisores e o Diretor ajustam as regras de tradução');
    await withTransaction(pool, async (db) => {
      if (rules === null) await db.query('DELETE FROM translation_profiles WHERE mode = $1 AND target_language = $2', [mode, target]);
      else {
        const base = defaultRules(mode, target);
        const diff = Object.fromEntries(
          Object.entries(rules).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key as keyof TranslationRules])),
        );
        await db.query(
          `INSERT INTO translation_profiles (mode, target_language, rules, updated_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (mode, target_language) DO UPDATE SET rules = EXCLUDED.rules, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [mode, target, JSON.stringify(diff), ctx.actor.id],
        );
      }
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: rules === null ? 'translation.profile_reset' : 'translation.profile_set',
        targetType: 'settings',
        correlationId: ctx.correlationId,
        metadata: { mode, target },
      });
    });
    return list(ctx);
  }

  return { list, set };
}

export type ProfileService = ReturnType<typeof createProfileService>;
