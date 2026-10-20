import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordAudit, withTransaction } from '@tradutor/core/db';
import type { ObjectStorage } from '@tradutor/core/storage';
import { inspectMask, type MaskInspection } from '@tradutor/core/translation';
import { isDirector, ledTeams, type Actor } from '../access/policy.js';
import { AppError, conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_MASK_BYTES = 20 * 1024 * 1024;

/** Só Supervisores cadastram tradutores e enviam máscaras (ADR-012); os demais consultam. */
export const canManageTranslators = (actor: Actor) => ledTeams(actor).length > 0;
/** Baixar máscaras e PDF de referência: quem cuida dos tradutores e o Diretor. */
const canDownloadFiles = (actor: Actor) => canManageTranslators(actor) || isDirector(actor);

interface TranslatorRow {
  id: string;
  name: string;
  registration: string | null;
  languages: string | null;
  notes: string | null;
  active: boolean;
  current_mask_id: string | null;
  reference_pdf_key: string | null;
  reference_pdf_name: string | null;
  reference_pdf_size: string | null;
  updated_by_name: string;
  updated_at: Date;
  translations: number;
  editions: number;
}

interface MaskRow {
  id: string;
  translator_id: string;
  edition: number;
  object_key: string;
  file_name: string;
  size_bytes: string;
  markers: string[];
  configured: boolean;
  issues: string[];
  notes: string | null;
  uploaded_by_name: string;
  uploaded_at: Date;
  translations: number;
}

export interface TranslatorInput {
  name: string;
  registration: string | null;
  languages: string | null;
  notes: string | null;
  active?: boolean;
}

const SELECT = `
  SELECT s.*, u.display_name AS updated_by_name,
         (SELECT count(*)::int FROM translation_jobs j WHERE j.translator_id = s.id AND j.number_label IS NOT NULL) AS translations,
         (SELECT count(*)::int FROM sworn_translator_masks m WHERE m.translator_id = s.id) AS editions
    FROM sworn_translators s JOIN users u ON u.id = s.updated_by`;

const MASK_SELECT = `
  SELECT m.*, u.display_name AS uploaded_by_name,
         (SELECT count(*)::int FROM translation_jobs j WHERE j.mask_id = m.id AND j.number_label IS NOT NULL) AS translations
    FROM sworn_translator_masks m JOIN users u ON u.id = m.uploaded_by`;

const toMask = (row: MaskRow, current: string | null) => ({
  id: row.id,
  edition: row.edition,
  name: row.file_name,
  size: Number(row.size_bytes),
  markers: row.markers,
  /** Pronta para gerar traduções ({{texto}} no lugar certo); sem isso, aguarda configuração. */
  configured: row.configured,
  /** O que falta para ficar pronta. */
  issues: row.issues,
  notes: row.notes,
  uploadedBy: row.uploaded_by_name,
  uploadedAt: row.uploaded_at.toISOString(),
  /** Traduções concluídas com esta edição. */
  translations: row.translations,
  current: row.id === current,
});

async function uploadBuffer(storage: ObjectStorage, key: string, data: Buffer, contentType: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tradutor-mask-'));
  const file = path.join(directory, 'file');
  try {
    await writeFile(file, data);
    await storage.putFile(key, file, data.length, contentType);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Tradutores juramentados (ADR-012): lista única da organização, mantida pelos Supervisores. Cada tradutor guarda as
 * máscaras enviadas em edições numeradas (1, 2, 3…); uma delas é a usada nas próximas conclusões.
 */
export function createTranslatorService({ pool, storage }: ServiceDeps & { storage: ObjectStorage }) {
  async function load(id: string) {
    const row = (await pool.query<TranslatorRow>(`${SELECT} WHERE s.id = $1`, [id])).rows[0];
    if (!row) throw notFound('Tradutor não encontrado');
    return row;
  }

  async function masksOf(translatorId: string) {
    return (await pool.query<MaskRow>(`${MASK_SELECT} WHERE m.translator_id = $1 ORDER BY m.edition DESC`, [translatorId])).rows;
  }

  async function toTranslator(row: TranslatorRow, actor: Actor) {
    const masks = await masksOf(row.id);
    const current = masks.find((mask) => mask.id === row.current_mask_id);
    return {
      id: row.id,
      name: row.name,
      registration: row.registration,
      languages: row.languages,
      notes: row.notes,
      active: row.active,
      /** Edição da máscara usada nas próximas conclusões. */
      mask: current ? toMask(current, row.current_mask_id) : null,
      /** Todas as edições enviadas, da mais recente para a mais antiga. */
      masks: masks.map((mask) => toMask(mask, row.current_mask_id)),
      referencePdf: row.reference_pdf_key ? { name: row.reference_pdf_name, size: Number(row.reference_pdf_size) } : null,
      /** Pode ser escolhido na conclusão: ativo e com máscara configurada em uso. */
      ready: row.active && current !== undefined && current.configured,
      translations: row.translations,
      updatedBy: row.updated_by_name,
      updatedAt: row.updated_at.toISOString(),
      permissions: { edit: canManageTranslators(actor), download: canDownloadFiles(actor) },
    };
  }

  const requireManager = (ctx: AuthenticatedContext) => {
    if (!canManageTranslators(ctx.actor)) throw forbidden('Somente Supervisores cadastram tradutores e enviam máscaras');
  };

  const audit = (ctx: AuthenticatedContext, action: string, id: string, metadata: Record<string, unknown> = {}) =>
    recordAudit(pool, {
      actorUserId: ctx.actor.id,
      action,
      targetType: 'translator',
      targetId: id,
      correlationId: ctx.correlationId,
      metadata,
    });

  async function list(ctx: AuthenticatedContext, query: { active?: boolean } = {}) {
    const result = await pool.query<TranslatorRow>(
      `${SELECT} ${query.active === undefined ? '' : `WHERE s.active = ${query.active ? 'true' : 'false'}`} ORDER BY s.active DESC, lower(s.name)`,
    );
    return Promise.all(result.rows.map((row) => toTranslator(row, ctx.actor)));
  }

  async function get(ctx: AuthenticatedContext, id: string) {
    return toTranslator(await load(id), ctx.actor);
  }

  async function create(ctx: AuthenticatedContext, input: TranslatorInput) {
    requireManager(ctx);
    try {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO sworn_translators (name, registration, languages, notes, active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        [input.name, input.registration, input.languages, input.notes, input.active ?? true, ctx.actor.id],
      );
      const id = created.rows[0]!.id;
      await audit(ctx, 'translator.created', id, { name: input.name });
      return get(ctx, id);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('Já existe um tradutor com esse nome');
      throw error;
    }
  }

  async function update(ctx: AuthenticatedContext, id: string, input: Partial<TranslatorInput>) {
    requireManager(ctx);
    await load(id);
    const fields: Array<[string, unknown]> = [];
    if (input.name !== undefined) fields.push(['name', input.name]);
    if (input.registration !== undefined) fields.push(['registration', input.registration]);
    if (input.languages !== undefined) fields.push(['languages', input.languages]);
    if (input.notes !== undefined) fields.push(['notes', input.notes]);
    if (input.active !== undefined) fields.push(['active', input.active]);
    if (!fields.length) return get(ctx, id);
    try {
      await pool.query(
        `UPDATE sworn_translators SET ${fields.map(([column], index) => `${column} = $${index + 2}`).join(', ')},
                updated_by = $${fields.length + 2}, updated_at = now() WHERE id = $1`,
        [id, ...fields.map(([, value]) => value), ctx.actor.id],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('Já existe um tradutor com esse nome');
      throw error;
    }
    await audit(ctx, 'translator.updated', id, { fields: fields.map(([column]) => column) });
    return get(ctx, id);
  }

  /**
   * Nova edição da máscara: a máscara é sempre um Word (.docx); PDF, .doc antigo e outros formatos são recusados.
   * O Word é guardado mesmo sem os marcadores (fica "aguardando configuração" e não gera traduções até ter {{texto}}).
   * Vira a edição em uso; as anteriores ficam guardadas, e traduções já concluídas mantêm a edição com que foram geradas.
   */
  async function uploadMask(ctx: AuthenticatedContext, id: string, data: Buffer, fileName: string, notes: string | null = null) {
    requireManager(ctx);
    await load(id);
    const inspection: MaskInspection = await inspectMask(new Uint8Array(data));
    if (!inspection.isWord) throw new AppError(422, 'FILE_INVALID', inspection.errors.join(' '), { inspection });
    const key = `translators/${id}/mask-${Date.now()}.docx`;
    await uploadBuffer(storage, key, data, DOCX_TYPE);
    const markers = [...new Set(inspection.markers.map((marker) => marker.name))];
    const edition = await withTransaction(pool, async (db) => {
      // Trava o tradutor para que dois envios simultâneos não tirem o mesmo número de edição.
      await db.query('SELECT 1 FROM sworn_translators WHERE id = $1 FOR UPDATE', [id]);
      const next = (
        await db.query<{ next: number }>(
          'SELECT coalesce(max(edition), 0) + 1 AS next FROM sworn_translator_masks WHERE translator_id = $1',
          [id],
        )
      ).rows[0]!.next;
      const created = await db.query<{ id: string }>(
        `INSERT INTO sworn_translator_masks (translator_id, edition, object_key, file_name, sha256, size_bytes, markers, configured, issues,
                                             notes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          id,
          next,
          key,
          fileName,
          createHash('sha256').update(data).digest(),
          data.length,
          markers,
          inspection.ok,
          inspection.errors,
          notes,
          ctx.actor.id,
        ],
      );
      await db.query('UPDATE sworn_translators SET current_mask_id = $2, updated_by = $3, updated_at = now() WHERE id = $1', [
        id,
        created.rows[0]!.id,
        ctx.actor.id,
      ]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'translator.mask_uploaded',
        targetType: 'translator',
        targetId: id,
        correlationId: ctx.correlationId,
        metadata: { edition: next, name: fileName, size: data.length, markers, configured: inspection.ok },
      });
      return next;
    });
    return { translator: await get(ctx, id), inspection, edition };
  }

  /** Volta a usar uma edição anterior (ou qualquer outra) nas próximas conclusões. */
  async function useMask(ctx: AuthenticatedContext, id: string, maskId: string) {
    requireManager(ctx);
    const found = await pool.query<{ edition: number }>('SELECT edition FROM sworn_translator_masks WHERE id = $1 AND translator_id = $2', [
      maskId,
      id,
    ]);
    if (!found.rows[0]) throw notFound('Edição de máscara não encontrada');
    await pool.query('UPDATE sworn_translators SET current_mask_id = $2, updated_by = $3, updated_at = now() WHERE id = $1', [
      id,
      maskId,
      ctx.actor.id,
    ]);
    await audit(ctx, 'translator.mask_selected', id, { edition: found.rows[0].edition });
    return get(ctx, id);
  }

  /** PDF entregue pelo tradutor, guardado só como referência visual da máscara. */
  async function uploadReferencePdf(ctx: AuthenticatedContext, id: string, data: Buffer, fileName: string) {
    requireManager(ctx);
    await load(id);
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError(422, 'FILE_INVALID', 'O arquivo não é um PDF válido');
    const key = `translators/${id}/reference-${Date.now()}.pdf`;
    await uploadBuffer(storage, key, data, 'application/pdf');
    await pool.query(
      `UPDATE sworn_translators SET reference_pdf_key = $2, reference_pdf_name = $3, reference_pdf_size = $4, updated_by = $5,
              updated_at = now() WHERE id = $1`,
      [id, key, fileName, data.length, ctx.actor.id],
    );
    await audit(ctx, 'translator.pdf_uploaded', id, { name: fileName, size: data.length });
    return get(ctx, id);
  }

  /** Download de uma edição da máscara (a em uso, sem `maskId`) ou do PDF de referência. */
  async function openFile(ctx: AuthenticatedContext, id: string, kind: 'mask' | 'pdf', maskId?: string) {
    if (!canDownloadFiles(ctx.actor)) throw forbidden();
    const row = await load(id);
    if (kind === 'pdf') {
      if (!row.reference_pdf_key) throw notFound('Este tradutor não tem PDF de referência');
      return {
        stream: await storage.get(row.reference_pdf_key),
        name: row.reference_pdf_name ?? `${row.name}.pdf`,
        contentType: 'application/pdf',
      };
    }
    const mask = (await masksOf(id)).find((item) => item.id === (maskId ?? row.current_mask_id));
    if (!mask) throw notFound('Este tradutor ainda não tem máscara');
    return {
      stream: await storage.get(mask.object_key),
      name: `${row.name} - edição ${mask.edition} - ${mask.file_name}`,
      contentType: DOCX_TYPE,
    };
  }

  /** Máscara para gerar documentos: a edição indicada ou, sem ela, a em uso. */
  async function maskFor(translatorId: string, maskId?: string | null) {
    const row = await load(translatorId);
    const mask = (await masksOf(translatorId)).find((item) => item.id === (maskId ?? row.current_mask_id));
    if (!mask) throw conflict(`${row.name} ainda não tem máscara enviada`);
    if (!mask.configured) {
      throw conflict(`A máscara de ${row.name} (edição ${mask.edition}) ainda aguarda configuração: ${mask.issues.join(' ')}`);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.get(mask.object_key)) chunks.push(chunk as Buffer);
    return { name: row.name, active: row.active, maskId: mask.id, edition: mask.edition, data: new Uint8Array(Buffer.concat(chunks)) };
  }

  return { list, get, create, update, uploadMask, useMask, uploadReferencePdf, openFile, maskFor };
}

export type TranslatorService = ReturnType<typeof createTranslatorService>;
