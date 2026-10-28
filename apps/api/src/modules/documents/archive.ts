import JSZip from 'jszip';
import type { PoolClient } from 'pg';
import type { ServiceDeps, AuthenticatedContext } from '../context.js';
import type { FinalArtifactReceipt, TranslationService } from '../translations/service.js';
import { canViewBatch } from '../access/policy.js';
import { AppError, notFound, conflict } from '../../http/errors.js';
import { docxToPdf } from '../../http/pdf.js';

export const ARCHIVE_LIMITS = { maxFiles: 100, maxBytes: 128 * 1024 * 1024, maxFileBytes: 50 * 1024 * 1024 };

/** Um único segmento, compatível com Windows e sem travessia de diretórios no ZIP. */
export function safeArchiveSegment(value: string, fallback = 'documento', maxLength = 180) {
  let segment = value
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (segment.length > maxLength) {
    const extension = /\.[A-Za-z0-9]{1,10}$/.exec(segment)?.[0] ?? '';
    segment = `${segment.slice(0, maxLength - extension.length)}${extension}`;
  }
  if (!segment || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) return `_${segment || fallback}`;
  return segment;
}

const originalStem = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .normalize('NFC')
    .toLocaleLowerCase('pt-BR');
/**
 * Nome de cada tradução no ZIP (pedido do produto, 2026-10-28): número da tradução e protocolo, quando houver; sem
 * número, entra a referência sequencial ("Tradução 123"), que também serve para buscar depois.
 */
export function archiveBaseName(row: { number_label: string | null; protocol: string | null; reference_number: string | number }) {
  const parts = [row.number_label?.replace(/\//g, '-'), row.protocol, row.number_label ? null : `Tradução ${row.reference_number}`];
  return safeArchiveSegment(parts.filter(Boolean).join(' – '), `Tradução ${row.reference_number}`, 170);
}

const withOrdinal = (name: string, ordinal: number) =>
  ordinal ? name.replace(/(\.[^.]*)$/, ` (${String(ordinal).padStart(2, '0')})$1`) : name;

/** Os ordinais dependem do documento no lote, nunca da seleção ou da ordem de downloads. */
export async function protocolOutputName(db: Pick<PoolClient, 'query'>, documentId: string, outputName: string) {
  const result = await db.query<{ id: string; display_name: string; protocol: string | null }>(
    `SELECT d.id, d.display_name, b.protocol FROM documents d JOIN batches b ON b.id = d.batch_id
      WHERE d.batch_id = (SELECT batch_id FROM documents WHERE id = $1) ORDER BY d.position, d.id`,
    [documentId],
  );
  const current = result.rows.find((row) => row.id === documentId);
  if (!current) throw notFound('Documento não encontrado');
  const currentStem = current.display_name.replace(/\.[^.]+$/, '');
  const stemAt = currentStem ? outputName.indexOf(currentStem) : -1;
  const used = new Set<string>();
  const occurrences = new Map<string, number>();
  for (const row of result.rows) {
    const stem = originalStem(row.display_name);
    let ordinal = occurrences.get(stem) ?? 0;
    occurrences.set(stem, ordinal + 1);
    const title =
      stemAt >= 0
        ? `${outputName.slice(0, stemAt)}${row.display_name.replace(/\.[^.]+$/, '')}${outputName.slice(stemAt + currentStem.length)}`
        : outputName;
    const base = safeArchiveSegment(row.protocol ? `${row.protocol} – ${title}` : title, 'documento', 170);
    let candidate = withOrdinal(base, ordinal);
    // Nomes que já contêm '(01)' ou que convergem após saneamento/truncamento também são únicos.
    while (used.has(candidate.toLocaleLowerCase('pt-BR'))) candidate = withOrdinal(base, ++ordinal);
    used.add(candidate.toLocaleLowerCase('pt-BR'));
    if (row.id === documentId) return candidate;
  }
  throw notFound('Documento não encontrado');
}

export interface TranslationArchiveInput {
  translationIds?: string[];
  batchId?: string;
  format: 'docx' | 'pdf';
}

export function createArchiveService(
  { pool, config }: ServiceDeps,
  translations: Pick<TranslationService, 'openFinal' | 'recordDownloads'>,
) {
  async function exportArchive(ctx: AuthenticatedContext, input: TranslationArchiveInput) {
    if (!!input.batchId === !!input.translationIds?.length || !['docx', 'pdf'].includes(input.format)) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Escolha uma remessa ou uma seleção de traduções e o formato Word/PDF');
    }
    const ids = [...new Set(input.translationIds ?? [])];
    if (ids.length > ARCHIVE_LIMITS.maxFiles) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Cada ZIP aceita no máximo 100 traduções');
    if (input.batchId) {
      const batch = (
        await pool.query<{ team_id: string | null; owner_id: string }>('SELECT team_id, owner_id FROM batches WHERE id = $1', [
          input.batchId,
        ])
      ).rows[0];
      if (!batch || !canViewBatch(ctx.actor, { teamId: batch.team_id, ownerId: batch.owner_id })) throw notFound('Remessa não encontrada');
    }
    const found = await pool.query<{
      id: string;
      team_id: string | null;
      owner_id: string;
      protocol: string | null;
      number_label: string | null;
      reference_number: string;
      source_language: string;
      target_language: string;
      status: string;
      annulled_at: Date | null;
    }>(
      `SELECT j.id, b.team_id, b.owner_id, b.protocol, j.number_label, j.reference_number, j.source_language, j.target_language,
              j.status, j.annulled_at
         FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
        WHERE ${input.batchId ? "b.id = $1 AND j.status = 'approved' AND j.annulled_at IS NULL" : 'j.id = ANY($1::uuid[])'}
        ORDER BY b.created_at, b.id, d.position, j.target_language, j.id LIMIT 101`,
      [input.batchId ?? ids],
    );
    if (
      (!input.batchId && found.rows.length !== ids.length) ||
      found.rows.some((row) => !canViewBatch(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id }))
    )
      throw notFound('Uma ou mais traduções não foram encontradas');
    if (!found.rows.length) throw conflict('Nenhuma tradução concluída disponível para este ZIP');
    if (found.rows.length > ARCHIVE_LIMITS.maxFiles)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'A remessa excede 100 traduções; faça seleções menores');
    if (found.rows.some((row) => row.status !== 'approved' || row.annulled_at))
      throw conflict('O ZIP só aceita traduções concluídas e válidas');

    const zip = new JSZip();
    const paths = new Set<string>();
    const expected: Record<string, FinalArtifactReceipt> = {};
    let bytes = 0;
    // Prepara tudo antes de registrar entregas: falhas de armazenamento/conversão nunca produzem um ZIP parcial.
    for (const row of found.rows) {
      const file = await translations.openFinal(ctx, row.id, { trackDownload: false });
      expected[row.id] = file.receipt;
      const chunks: Buffer[] = [];
      let fileBytes = 0;
      for await (const chunk of file.stream) {
        const data = Buffer.from(chunk);
        fileBytes += data.length;
        if (fileBytes > ARCHIVE_LIMITS.maxFileBytes || bytes + fileBytes > ARCHIVE_LIMITS.maxBytes) {
          file.stream.destroy();
          throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'O ZIP aceita até 128 MB no total e 50 MB por documento; faça uma seleção menor');
        }
        chunks.push(data);
      }
      let content: Buffer = Buffer.concat(chunks);
      if (input.format === 'pdf') content = await docxToPdf(config.CONVERTER_URL, content, file.name);
      bytes += content.length;
      if (content.length > ARCHIVE_LIMITS.maxFileBytes || bytes > ARCHIVE_LIMITS.maxBytes)
        throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Os PDFs excedem o limite de 128 MB por ZIP ou 50 MB por arquivo');
      const directory = `${safeArchiveSegment(row.protocol ?? 'Sem protocolo')}/${safeArchiveSegment(`${row.source_language.toUpperCase()}-${row.target_language.toUpperCase()}`)}/${input.format === 'docx' ? 'Word' : 'PDF'}`;
      const name = `${archiveBaseName(row)}.${input.format}`;
      let path = `${directory}/${name}`;
      let ordinal = 1;
      while (paths.has(path.toLocaleLowerCase('pt-BR'))) path = `${directory}/${withOrdinal(name, ordinal++)}`;
      paths.add(path.toLocaleLowerCase('pt-BR'));
      zip.file(path, content, { binary: true, date: new Date('2000-01-01T00:00:00Z') });
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', streamFiles: true });
    await translations.recordDownloads(
      ctx,
      found.rows.map((row) => row.id),
      {
        format: input.format,
        delivery: 'zip',
        expected,
        archive: { ...(input.batchId ? { batchId: input.batchId } : {}), bytes: buffer.length },
      },
    );
    // Uma tradução: o nome dela. Um protocolo só: o protocolo. Protocolos misturados: "Traduções N", em sequência.
    const protocols = new Set(found.rows.map((row) => row.protocol));
    const [only] = protocols;
    const base =
      found.rows.length === 1
        ? archiveBaseName(found.rows[0]!)
        : protocols.size === 1 && only
          ? safeArchiveSegment(only)
          : `Traduções ${(await pool.query<{ n: string }>(`SELECT nextval('translation_archive_seq') AS n`)).rows[0]!.n}`;
    return {
      buffer,
      name: `${base} – ${input.format === 'docx' ? 'Word' : 'PDF'}.zip`,
      contentType: 'application/zip',
      size: buffer.length,
      count: found.rows.length,
    };
  }
  return { exportArchive };
}

export type ArchiveService = ReturnType<typeof createArchiveService>;
