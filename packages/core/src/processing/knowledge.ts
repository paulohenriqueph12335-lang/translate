import type { Queryable } from '../db/pool.js';
import { Draft } from '../translation/draft.js';
import { learnLayout, type LayoutSample } from '../translation/layout-composer.js';

/**
 * Conhecimento de diagramação (ADR-020): o que as traduções concluídas ensinam sobre cada papel do documento. É
 * recalculado das conclusões mais recentes (sem justificativa de exceção e não anuladas), então o sistema aprende
 * sozinho a cada conclusão; fica em memória por alguns minutos para não pesar no processamento.
 */
const TTL_MS = 5 * 60_000;
const LIMIT = 300;
let cache: { at: number; samples: LayoutSample[] } | null = null;

export async function loadLayoutKnowledge(db: Queryable, fresh = false): Promise<LayoutSample[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.samples;
  const rows = await db.query<{ content: unknown }>(
    `SELECT r.content FROM translation_jobs j JOIN translation_drafts r ON r.job_id = j.id AND r.revision = j.current_revision
      WHERE j.status = 'approved' AND j.approval_override_reason IS NULL AND j.annulled_at IS NULL
      ORDER BY j.approved_at DESC LIMIT ${LIMIT}`,
  );
  const samples: LayoutSample[] = [];
  for (const row of rows.rows) {
    const parsed = Draft.safeParse(row.content);
    if (parsed.success && parsed.data.blocks.length >= 3) samples.push(learnLayout(parsed.data));
  }
  // Combinações de diagramação da IA aprovadas na prévia (ADR-021): o sistema se molda às novas soluções.
  const combinations = await db
    .query<{
      sample: LayoutSample;
    }>(`SELECT sample FROM ai_layout_combinations WHERE status = 'approved' ORDER BY decided_at DESC LIMIT 100`)
    .catch(() => ({ rows: [] as Array<{ sample: LayoutSample }> }));
  for (const row of combinations.rows) if (Array.isArray(row.sample?.shape)) samples.push(row.sample);
  cache = { at: Date.now(), samples };
  return samples;
}

/** Para testes: esquece o que estava em memória. */
export function forgetLayoutKnowledge() {
  cache = null;
}
