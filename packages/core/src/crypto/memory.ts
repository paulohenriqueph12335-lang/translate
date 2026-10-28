import type { Queryable } from '../db/pool.js';
import { memoryDigest, sealText } from './values.js';

/**
 * Memória de tradução cifrada (ADR-008, ADR-032): o trecho e a tradução ficam cifrados, e a busca usa o índice cego
 * (`source_digest`). Devolve só os trechos encontrados.
 */
export async function lookupMemory(db: Queryable, sourceLanguage: string, targetLanguage: string, segments: readonly string[]) {
  const unique = [...new Set(segments)];
  if (!unique.length) return new Map<string, string>();
  const digests = unique.map((segment) => memoryDigest(sourceLanguage, targetLanguage, segment));
  const rows = await db.query<{ source_digest: Buffer; target_text: string }>(
    `SELECT source_digest, target_text FROM translation_memory
      WHERE source_language = $1 AND target_language = $2 AND source_digest = ANY($3::bytea[])`,
    [sourceLanguage, targetLanguage, digests],
  );
  const found = new Map(rows.rows.map((row) => [row.source_digest.toString('hex'), row.target_text]));
  const result = new Map<string, string>();
  unique.forEach((segment, index) => {
    const target = found.get(digests[index]!.toString('hex'));
    if (target !== undefined) result.set(segment, target);
  });
  return result;
}

/** Aprende os pares de uma conclusão; o mesmo trecho atualiza a tradução e soma um uso. */
export async function learnMemory(
  db: Queryable,
  input: { sourceLanguage: string; targetLanguage: string; jobId: string | null; pairs: ReadonlyArray<readonly [string, string]> },
) {
  if (!input.pairs.length) return;
  await db.query(
    `INSERT INTO translation_memory (source_language, target_language, source_text, target_text, source_digest, last_job_id)
     SELECT $1, $2, pair.source, pair.target, pair.digest, $3
       FROM unnest($4::text[], $5::text[], $6::bytea[]) AS pair(source, target, digest)
     ON CONFLICT (source_language, target_language, source_digest)
     DO UPDATE SET source_text = EXCLUDED.source_text, target_text = EXCLUDED.target_text, last_job_id = EXCLUDED.last_job_id,
                   uses = translation_memory.uses + 1, updated_at = now()`,
    [
      input.sourceLanguage,
      input.targetLanguage,
      input.jobId,
      input.pairs.map(([source]) => sealText(source)),
      input.pairs.map(([, target]) => sealText(target)),
      input.pairs.map(([source]) => memoryDigest(input.sourceLanguage, input.targetLanguage, source)),
    ],
  );
}
