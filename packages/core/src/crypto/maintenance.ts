import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';
import type { S3ObjectStorage } from '../storage/object-storage.js';
import { activeKeyring, activePrefix, memoryDigest, sealJson, sealText } from './values.js';

const BATCH = 200;

type Log = (message: string) => void;

/** Colunas com conteúdo de documento (ADR-032): o que não estiver cifrado com a chave ativa é cifrado de novo. */
const JSON_COLUMNS: Array<{ table: string; key: string[]; columns: string[] }> = [
  { table: 'translation_drafts', key: ['job_id', 'revision'], columns: ['content', 'issues', 'corrections'] },
  { table: 'translation_format_registrations', key: ['id'], columns: ['draft'] },
  { table: 'ai_layout_combinations', key: ['id'], columns: ['sample'] },
];

/** Atualiza sem disparar gatilhos de imutabilidade e de atividade: o conteúdo não muda, só a forma guardada. */
async function withoutTriggers<T>(pool: Pool, table: string, work: (db: PoolClient) => Promise<T>) {
  return withTransaction(pool, async (db) => {
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    const result = await work(db);
    await db.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    return result;
  });
}

async function sealJsonColumns(pool: Pool, log: Log) {
  const prefix = activePrefix();
  for (const { table, key, columns } of JSON_COLUMNS) {
    const pending = columns.map((column) => `NOT (${column} ? '$enc' AND left(${column}->>'$enc', length($1)) = $1)`).join(' OR ');
    let total = 0;
    for (;;) {
      const done = await withoutTriggers(pool, table, async (db) => {
        const rows = await db.query<Record<string, unknown>>(
          `SELECT ${[...key, ...columns].join(', ')} FROM ${table} WHERE ${pending} LIMIT ${BATCH}`,
          [prefix],
        );
        for (const row of rows.rows) {
          const sets = columns.map((column, index) => `${column} = $${index + 1}::jsonb`).join(', ');
          const where = key.map((column, index) => `${column} = $${columns.length + index + 1}`).join(' AND ');
          await db.query(`UPDATE ${table} SET ${sets} WHERE ${where}`, [
            ...columns.map((column) => sealJson(row[column])),
            ...key.map((column) => row[column]),
          ]);
        }
        return rows.rowCount ?? 0;
      });
      total += done;
      if (done < BATCH) break;
    }
    if (total) log(`Criptografia: ${total} registro(s) cifrado(s) em ${table}`);
  }
}

async function sealExtractedText(pool: Pool, log: Log) {
  const prefix = activePrefix();
  let total = 0;
  for (;;) {
    const done = await withoutTriggers(pool, 'translation_jobs', async (db) => {
      const rows = await db.query<{ id: string; extracted_text: string }>(
        `SELECT id, extracted_text FROM translation_jobs
          WHERE extracted_text IS NOT NULL AND left(extracted_text, length($1)) <> $1 LIMIT ${BATCH}`,
        [prefix],
      );
      for (const row of rows.rows)
        await db.query('UPDATE translation_jobs SET extracted_text = $2 WHERE id = $1', [row.id, sealText(row.extracted_text)]);
      return rows.rowCount ?? 0;
    });
    total += done;
    if (done < BATCH) break;
  }
  if (total) log(`Criptografia: ${total} texto(s) extraído(s) cifrado(s)`);
}

async function sealMemory(pool: Pool, log: Log) {
  const prefix = activePrefix();
  let total = 0;
  for (;;) {
    const done = await withTransaction(pool, async (db) => {
      const rows = await db.query<{
        id: string;
        source_language: string;
        target_language: string;
        source_text: string;
        target_text: string;
      }>(
        `SELECT id, source_language, target_language, source_text, target_text FROM translation_memory
          WHERE source_digest IS NULL OR left(source_text, length($1)) <> $1 OR left(target_text, length($1)) <> $1
          LIMIT ${BATCH} FOR UPDATE`,
        [prefix],
      );
      for (const row of rows.rows)
        await db.query('UPDATE translation_memory SET source_text = $2, target_text = $3, source_digest = $4 WHERE id = $1', [
          row.id,
          sealText(row.source_text),
          sealText(row.target_text),
          memoryDigest(row.source_language, row.target_language, row.source_text),
        ]);
      return rows.rowCount ?? 0;
    });
    total += done;
    if (done < BATCH) break;
  }
  if (total) log(`Criptografia: ${total} trecho(s) da memória de tradução cifrado(s)`);
}

async function sealObjects(storage: S3ObjectStorage, log: Log) {
  const { activeId } = activeKeyring();
  let total = 0;
  for await (const key of storage.listKeys()) {
    if ((await storage.encryptionKeyOf(key)) === activeId) continue;
    await storage.reseal(key);
    total += 1;
  }
  if (total) log(`Criptografia: ${total} arquivo(s) cifrado(s) no armazenamento`);
}

/**
 * Cifra o que ainda está aberto e recifra com a chave ativa o que usa chave antiga (ADR-032). Seguro de repetir: só
 * mexe no que precisa. Roda no serviço migrate a cada subida e no comando de rotação.
 */
export async function encryptAtRest(input: { pool: Pool; storage?: S3ObjectStorage; log?: Log }) {
  const log = input.log ?? (() => undefined);
  await sealExtractedText(input.pool, log);
  await sealJsonColumns(input.pool, log);
  await sealMemory(input.pool, log);
  if (input.storage) await sealObjects(input.storage, log);
}
