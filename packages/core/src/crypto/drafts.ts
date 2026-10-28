import type { Queryable } from '../db/pool.js';
import { sealJson } from './values.js';

/**
 * Grava uma revisão do rascunho com o conteúdo, os problemas e as correções cifrados (ADR-032). As contagens ficam
 * abertas, para os painéis e as listas contarem sem abrir o conteúdo.
 */
export async function insertDraft(
  db: Queryable,
  input: {
    jobId: string;
    revision: number;
    content: unknown;
    issues: ReadonlyArray<{ severity: string }>;
    origin: string;
    authorId?: string | null;
    corrections?: readonly unknown[];
  },
) {
  const corrections = input.corrections ?? [];
  await db.query(
    `INSERT INTO translation_drafts (job_id, revision, content, issues, origin, author_id, corrections, error_count, issue_count, correction_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.jobId,
      input.revision,
      sealJson(input.content),
      sealJson(input.issues),
      input.origin,
      input.authorId ?? null,
      sealJson(corrections),
      input.issues.filter((issue) => issue.severity === 'error').length,
      input.issues.length,
      corrections.length,
    ],
  );
}
