import type { PoolClient } from 'pg';
import { notify } from '@tradutor/core/db';

type Db = Pick<PoolClient, 'query'>;

export type QuotaScope = 'organization' | 'team' | 'user';

export interface QuotaLevel {
  scope: QuotaScope;
  quota: number;
  used: number;
}

/**
 * Números emitidos no ano em cada nível (plano de hierarquia, D6/D7): todo número emitido conta, inclusive anulado,
 * porque continua ocupando o livro. O consumo é de quem é responsável pela tradução.
 */
export async function quotaLevels(db: Db, input: { year: number; teamId: string | null; userId: string | null }): Promise<QuotaLevel[]> {
  const result = await db.query<{ scope: QuotaScope; quota: number; used: number }>(
    `SELECT q.scope, q.quota,
            (SELECT count(*)::int FROM translation_jobs j
               JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
              WHERE j.translation_year = $1 AND j.number_label IS NOT NULL
                AND (q.scope = 'organization'
                     OR (q.scope = 'team' AND b.team_id = q.team_id)
                     OR (q.scope = 'user' AND j.assignee_id = q.user_id))) AS used
       FROM numbering_quotas q
      WHERE q.year = $1
        AND (q.scope = 'organization' OR (q.scope = 'team' AND q.team_id = $2) OR (q.scope = 'user' AND q.user_id = $3))`,
    [input.year, input.teamId, input.userId],
  );
  return result.rows;
}

export const quotaLabel: Record<QuotaScope, string> = { organization: 'da organização', team: 'da equipe', user: 'do usuário' };

/** Primeiro nível esgotado, se houver: nenhuma tradução é concluída além da cota. */
export const exhausted = (levels: QuotaLevel[]) => levels.find((level) => level.used >= level.quota) ?? null;

/**
 * Depois de emitir um número: avisa quando um nível chega a 80% ou a 100% da cota (uma vez em cada marco).
 * Usuário: ele e o Supervisor da equipe. Equipe: Supervisores e Diretores. Organização: Diretores.
 */
export async function notifyQuotaMilestones(
  db: Db,
  input: { year: number; teamId: string | null; userId: string | null; userName: string; teamName: string | null; translationId: string },
) {
  for (const level of await quotaLevels(db, input)) {
    const warning = Math.ceil(level.quota * 0.8);
    const milestone = level.used === level.quota ? 'full' : level.used === warning && warning < level.quota ? 'warning' : null;
    if (!milestone) continue;
    const who =
      level.scope === 'user'
        ? `de ${input.userName}`
        : level.scope === 'team'
          ? `da equipe ${input.teamName ?? ''}`.trim()
          : 'da organização';
    const audience =
      level.scope === 'user'
        ? { teamId: input.teamId, leaders: true, users: [input.userId] }
        : level.scope === 'team'
          ? { teamId: input.teamId, leaders: true, directors: true }
          : { teamId: null, directors: true };
    await notify(db, audience, {
      kind: milestone === 'full' ? 'quota_exhausted' : 'quota_warning',
      title:
        milestone === 'full'
          ? `Cota de numeração ${who} esgotada (${level.used}/${level.quota})`
          : `Cota de numeração ${who} em 80% (${level.used}/${level.quota})`,
      body:
        milestone === 'full'
          ? `Novas conclusões ficam bloqueadas até a cota ${quotaLabel[level.scope]} ser ampliada em Numeração.`
          : 'Amplie a cota em Numeração se for preciso.',
      translationId: input.translationId,
    });
  }
}
