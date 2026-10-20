import type { Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import {
  canAssignBatch,
  canCancelInBatch,
  canCreateBatch,
  canUploadToBatch,
  canViewBatch,
  canViewTeam,
  isDirector,
  type Actor,
} from '../access/policy.js';
import { recordAudit } from '../audit/audit.js';
import { notify, withTransaction } from '@tradutor/core/db';
import { AppError, conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { decodeCursor, encodeCursor, likePattern } from '../pagination.js';
import type { ObjectStorage } from '@tradutor/core/storage';
import type { Language, Mode } from '@tradutor/core/translation';
import { CONTENT_TYPES, detectFormat, extensionOf, formatForExtension, type DetectedFormat } from './format.js';
import { spoolToTempFile, TooLargeError, type SpooledFile } from './spool.js';

export type DocumentStatus = 'awaiting_upload' | 'uploading' | 'stored' | 'rejected' | 'upload_failed' | 'cancelled';
export type BatchStatus = 'open' | 'completed';

/** Motivos de recusa definitiva e de falha reenviável (ADR-006). */
export type RejectionReason =
  | 'unsupported_extension'
  | 'empty'
  | 'too_large'
  | 'size_mismatch'
  | 'unknown_format'
  | 'protected_or_legacy'
  | 'invalid_archive'
  | 'extension_mismatch'
  | 'duplicate';
export type FailureReason = 'interrupted' | 'storage_unavailable';

const STALE_UPLOAD_MINUTES = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DocumentRow {
  id: string;
  batch_id: string;
  position: number;
  display_name: string;
  declared_extension: string;
  declared_size: string;
  status: DocumentStatus;
  detected_format: DetectedFormat | null;
  sha256: Buffer | null;
  error_code: string | null;
  tags: string[];
  stored_at: Date | null;
  updated_at: Date;
}

interface BatchRow {
  id: string;
  team_id: string | null;
  team_name: string | null;
  assigned_at: Date | null;
  source_language: Language | null;
  target_language: Language | null;
  translation_mode: Mode;
  owner_id: string;
  owner_name: string;
  name: string | null;
  declared_bytes: string;
  created_at: Date;
  cursor_at: string;
  total: string;
  stored: string;
  pending: string;
  rejected: string;
  cancelled: string;
}

const toDocument = (row: DocumentRow) => ({
  id: row.id,
  batchId: row.batch_id,
  position: row.position,
  name: row.display_name,
  extension: row.declared_extension,
  size: Number(row.declared_size),
  status: row.status,
  format: row.detected_format,
  sha256: row.sha256?.toString('hex') ?? null,
  errorCode: row.error_code,
  tags: row.tags,
  storedAt: row.stored_at?.toISOString() ?? null,
  updatedAt: row.updated_at.toISOString(),
});

const toBatch = (row: BatchRow) => {
  const counts = {
    total: Number(row.total),
    stored: Number(row.stored),
    pending: Number(row.pending),
    rejected: Number(row.rejected),
    cancelled: Number(row.cancelled),
  };
  return {
    id: row.id,
    name: row.name,
    /** `null` enquanto o lote do Diretor aguarda direcionamento. */
    team: row.team_id ? { id: row.team_id, name: row.team_name ?? '' } : null,
    assignedAt: row.assigned_at?.toISOString() ?? null,
    translation:
      row.source_language && row.target_language ? { sourceLanguage: row.source_language, targetLanguage: row.target_language } : null,
    /** Modalidade de tradução do lote (ADR-015). */
    mode: row.translation_mode,
    owner: { id: row.owner_id, displayName: row.owner_name },
    declaredBytes: Number(row.declared_bytes),
    createdAt: row.created_at.toISOString(),
    status: (counts.pending > 0 ? 'open' : 'completed') as BatchStatus,
    counts,
  };
};

const BATCH_SELECT = `
  SELECT b.id, b.team_id, t.name::text AS team_name, b.assigned_at, b.owner_id, b.source_language, b.target_language, b.translation_mode, u.display_name AS owner_name, b.name, b.declared_bytes, b.created_at,
         to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
         count(d.id) AS total,
         count(d.id) FILTER (WHERE d.status = 'stored') AS stored,
         count(d.id) FILTER (WHERE d.status IN ('awaiting_upload', 'uploading', 'upload_failed')) AS pending,
         count(d.id) FILTER (WHERE d.status = 'rejected') AS rejected,
         count(d.id) FILTER (WHERE d.status = 'cancelled') AS cancelled
    FROM batches b
    LEFT JOIN teams t ON t.id = b.team_id
    JOIN users u ON u.id = b.owner_id
    LEFT JOIN documents d ON d.batch_id = b.id`;

/** Monta cláusulas SQL com parâmetros numerados na ordem em que são adicionados. */
function sqlConditions() {
  const params: unknown[] = [];
  const conditions: string[] = [];
  return {
    params,
    conditions,
    param(value: unknown) {
      params.push(value);
      return `$${params.length}`;
    },
  };
}

/** Visibilidade de lotes em SQL, espelhando `canViewBatch` (ADR-006): lotes das equipes do ator; sem equipe, só o Diretor. */
function addVisibility(sql: ReturnType<typeof sqlConditions>, actor: Actor) {
  if (isDirector(actor)) return;
  sql.conditions.push(`b.team_id = ANY(${sql.param([...actor.memberships.keys()])}::uuid[])`);
}

export interface CreateBatchInput {
  /** Obrigatório para Líder de mais de uma equipe; proibido para o Diretor, cujo lote nasce sem equipe. */
  teamId?: string;
  name?: string;
  files: Array<{ name: string; size: number }>;
  /** Par de idiomas da tradução automática; todo documento armazenado é processado (ADR-010). */
  translation: { sourceLanguage: Language; targetLanguage: Language };
  /** Juramentada, certificada, técnica ou simples (ADR-015). */
  mode?: Mode;
  /** Etiquetas aplicadas a todos os documentos do lote, para classificar antes de processar. */
  tags?: string[];
}

/** Formatos que entram sozinhos na fila de tradução (ADR-007). */
const TRANSLATABLE_FORMATS = ['pdf', 'jpeg', 'png', 'docx', 'pptx'];

/**
 * Tradução automática: todo documento armazenado de um lote com par de idiomas entra na fila, mesmo antes de o
 * Diretor direcionar o lote (ADR-010), com quem enviou como responsável (plano de hierarquia).
 * Um trabalho ativo por documento e idioma (o índice parcial evita duplicatas).
 */
async function enqueueTranslations(db: Pick<PoolClient, 'query'>, filter: { documentId?: string; batchId?: string }, requestedBy: string) {
  const queued = await db.query<{ id: string; team_id: string | null }>(
    `INSERT INTO translation_jobs (document_id, source_language, target_language, requested_mode, requested_by, assignee_id, translation_mode)
     SELECT d.id, b.source_language, b.target_language, 'auto', $3,
            -- Quem enviou é o responsável; o lote do Diretor fica sem responsável até alguém da equipe assumir.
            CASE WHEN u.org_role = 'director' THEN NULL ELSE b.owner_id END,
            b.translation_mode
       FROM documents d JOIN batches b ON b.id = d.batch_id JOIN users u ON u.id = b.owner_id
      WHERE d.status = 'stored' AND d.detected_format = ANY($4::text[])
        AND b.target_language IS NOT NULL
        AND ($1::uuid IS NULL OR d.id = $1) AND ($2::uuid IS NULL OR b.id = $2)
     ON CONFLICT (document_id, target_language) WHERE status NOT IN ('failed', 'cancelled') DO NOTHING
     RETURNING id, (SELECT team_id FROM batches WHERE id = (SELECT batch_id FROM documents WHERE id = document_id)) AS team_id`,
    [filter.documentId ?? null, filter.batchId ?? null, requestedBy, TRANSLATABLE_FORMATS],
  );
  for (const job of queued.rows) {
    await recordAudit(db, {
      actorUserId: requestedBy,
      action: 'translation.requested',
      targetType: 'translation',
      targetId: job.id,
      ...(job.team_id ? { teamId: job.team_id } : {}),
      metadata: { automatic: true },
    });
  }
  return queued.rowCount ?? 0;
}

export interface DocumentSearchQuery {
  q?: string;
  teamId?: string;
  unassigned?: boolean;
  batchId?: string;
  mine?: boolean;
  uploadedBy?: string;
  status?: DocumentStatus[];
  format?: string[];
  tag?: string;
  untagged?: boolean;
  /** Datas AAAA-MM-DD (armazenamento), inclusivas. */
  from?: string;
  to?: string;
  /** Situação da tradução: sem tradução, em andamento, concluída ou com falha. */
  translation?: 'none' | 'active' | 'approved' | 'failed';
  limit: number;
  cursor?: string;
}

export interface BatchListQuery {
  teamId?: string;
  /** Só lotes aguardando direcionamento (Diretor). */
  unassigned?: boolean;
  status?: BatchStatus;
  mine?: boolean;
  q?: string;
  limit: number;
  cursor?: string;
}

export function createDocumentService({ pool, config, storage }: ServiceDeps & { storage: ObjectStorage }) {
  const maxFileBytes = config.UPLOAD_MAX_FILE_MB * 1024 * 1024;
  const maxBatchBytes = config.UPLOAD_MAX_BATCH_MB * 1024 * 1024;

  async function loadBatch(db: Pick<PoolClient, 'query'>, ctx: AuthenticatedContext, batchId: string) {
    const result = await db.query<BatchRow>(`${BATCH_SELECT} WHERE b.id = $1 GROUP BY b.id, t.name, u.display_name`, [batchId]);
    const row = result.rows[0];
    if (!row || !canViewBatch(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) throw notFound('Lote não encontrado');
    return row;
  }

  async function listDocuments(db: Pick<PoolClient, 'query'>, batchId: string) {
    const result = await db.query<DocumentRow>('SELECT * FROM documents WHERE batch_id = $1 ORDER BY position', [batchId]);
    return result.rows.map(toDocument);
  }

  /** Documento + lote, já com a verificação de visibilidade: fora do escopo responde 404. */
  async function loadDocument(db: Pick<PoolClient, 'query'>, ctx: AuthenticatedContext, documentId: string, lock = false) {
    const result = await db.query<DocumentRow & { team_id: string | null; owner_id: string }>(
      `SELECT d.*, b.team_id, b.owner_id FROM documents d JOIN batches b ON b.id = d.batch_id WHERE d.id = $1 ${lock ? 'FOR UPDATE OF d' : ''}`,
      [documentId],
    );
    const row = result.rows[0];
    if (!row || !canViewBatch(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) throw notFound('Documento não encontrado');
    return row;
  }

  async function getBatch(ctx: AuthenticatedContext, batchId: string) {
    const row = await loadBatch(pool, ctx, batchId);
    return { batch: toBatch(row), documents: await listDocuments(pool, batchId) };
  }

  /** Equipe de destino: Diretor → nenhuma (direciona depois); Supervisor e Usuário → a própria equipe. */
  function resolveTeam(actor: Actor, requested: string | undefined): string | null {
    if (isDirector(actor)) {
      if (requested) throw new AppError(400, 'VALIDATION_FAILED', 'Lotes do Diretor nascem sem equipe; direcione-os depois de criados');
      return null;
    }
    const teams = [...actor.memberships.keys()];
    if (!requested) {
      if (teams.length === 1) return teams[0]!;
      if (teams.length === 0) throw forbidden('Entre em uma equipe para enviar documentos');
      throw new AppError(400, 'VALIDATION_FAILED', 'Escolha a equipe do lote');
    }
    if (!canCreateBatch(actor, requested)) {
      if (!canViewTeam(actor, requested)) throw notFound('Equipe não encontrada');
      throw forbidden('Você não pertence a essa equipe');
    }
    return requested;
  }

  async function createBatch(ctx: AuthenticatedContext, input: CreateBatchInput, idempotencyKey?: string) {
    const teamId = resolveTeam(ctx.actor, input.teamId);
    if (input.files.length > config.UPLOAD_MAX_BATCH_FILES) {
      throw new AppError(400, 'VALIDATION_FAILED', `Um lote aceita no máximo ${config.UPLOAD_MAX_BATCH_FILES} arquivos`);
    }

    // Itens inválidos já nascem recusados; o lote preserva o estado individual de cada um.
    const items = input.files.map((file, position) => {
      const extension = extensionOf(file.name);
      const reason: RejectionReason | null = !extension
        ? 'unsupported_extension'
        : file.size === 0
          ? 'empty'
          : file.size > maxFileBytes
            ? 'too_large'
            : null;
      const declaredExtension = extension ?? /\.([A-Za-z0-9]{1,16})$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
      return { ...file, position, extension: declaredExtension, reason };
    });
    const acceptedBytes = items.filter((item) => !item.reason).reduce((sum, item) => sum + item.size, 0);
    if (acceptedBytes > maxBatchBytes) {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', `O lote excede ${config.UPLOAD_MAX_BATCH_MB} MB`, {
        maxBatchMb: config.UPLOAD_MAX_BATCH_MB,
      });
    }

    const existing = async () => {
      if (!idempotencyKey) return null;
      const found = await pool.query<{ id: string }>('SELECT id FROM batches WHERE owner_id = $1 AND idempotency_key = $2', [
        ctx.actor.id,
        idempotencyKey,
      ]);
      return found.rows[0] ? { ...(await getBatch(ctx, found.rows[0].id)), replayed: true } : null;
    };
    const replay = await existing();
    if (replay) return replay;

    try {
      const batchId = await withTransaction(pool, async (db) => {
        if (teamId) {
          const team = await db.query('SELECT 1 FROM teams WHERE id = $1 FOR SHARE', [teamId]);
          if (!team.rowCount) throw notFound('Equipe não encontrada');
        }
        const created = await db.query<{ id: string }>(
          `INSERT INTO batches (team_id, owner_id, name, idempotency_key, declared_bytes, assigned_at, assigned_by, source_language, target_language, translation_mode)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $1::uuid IS NULL THEN NULL ELSE now() END, CASE WHEN $1::uuid IS NULL THEN NULL ELSE $2::uuid END, $6, $7, $8)
           RETURNING id`,
          [
            teamId,
            ctx.actor.id,
            input.name ?? null,
            idempotencyKey ?? null,
            acceptedBytes,
            input.translation.sourceLanguage,
            input.translation.targetLanguage,
            input.mode ?? 'sworn',
          ],
        );
        const id = created.rows[0]!.id;
        await db.query(
          `INSERT INTO documents (batch_id, position, display_name, declared_extension, declared_size, status, error_code, tags)
           SELECT $1, item.position, item.name, item.extension, item.size,
                  CASE WHEN item.reason IS NULL THEN 'awaiting_upload' ELSE 'rejected' END, item.reason, $3::text[]
             FROM jsonb_to_recordset($2::jsonb) AS item(position int, name text, extension text, size bigint, reason text)`,
          [
            id,
            JSON.stringify(items.map(({ position, name, extension, size, reason }) => ({ position, name, extension, size, reason }))),
            input.tags ?? [],
          ],
        );
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'batch.created',
          targetType: 'batch',
          targetId: id,
          ...(teamId ? { teamId } : {}),
          correlationId: ctx.correlationId,
          metadata: {
            files: items.length,
            unassigned: teamId === null,
            rejected: items.filter((item) => item.reason).length,
            declaredBytes: acceptedBytes,
            tags: input.tags ?? [],
          },
        });
        return id;
      });
      return { ...(await getBatch(ctx, batchId)), replayed: false };
    } catch (error) {
      // Corrida entre duas requisições com a mesma chave: devolve o lote da vencedora.
      if ((error as { code?: string }).code === '23505' && idempotencyKey) {
        const winner = await existing();
        if (winner) return winner;
      }
      throw error;
    }
  }

  async function listBatches(ctx: AuthenticatedContext, query: BatchListQuery) {
    const after = decodeCursor(query.cursor, ([at, id]) => !!at && !Number.isNaN(Date.parse(at)) && !!id && UUID.test(id));
    const sql = sqlConditions();
    addVisibility(sql, ctx.actor);
    if (query.teamId) sql.conditions.push(`b.team_id = ${sql.param(query.teamId)}`);
    if (query.unassigned) sql.conditions.push('b.team_id IS NULL');
    if (query.mine) sql.conditions.push(`b.owner_id = ${sql.param(ctx.actor.id)}`);
    if (query.q) {
      const pattern = sql.param(likePattern(query.q));
      sql.conditions.push(
        `(unaccent(coalesce(b.name, '')) ILIKE unaccent(${pattern}) OR unaccent(u.display_name) ILIKE unaccent(${pattern})
          OR EXISTS (SELECT 1 FROM documents s WHERE s.batch_id = b.id AND unaccent(s.display_name) ILIKE unaccent(${pattern})))`,
      );
    }
    if (after) sql.conditions.push(`(b.created_at, b.id) < (${sql.param(after[0])}::timestamptz, ${sql.param(after[1])}::uuid)`);
    const pendingCount = `count(d.id) FILTER (WHERE d.status IN ('awaiting_upload', 'uploading', 'upload_failed'))`;
    const having =
      query.status === 'open' ? `HAVING ${pendingCount} > 0` : query.status === 'completed' ? `HAVING ${pendingCount} = 0` : '';
    const limit = sql.param(query.limit + 1);
    const result = await pool.query<BatchRow>(
      `${BATCH_SELECT}
        ${sql.conditions.length ? `WHERE ${sql.conditions.join(' AND ')}` : ''}
        GROUP BY b.id, t.name, u.display_name
        ${having}
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT ${limit}`,
      sql.params,
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(toBatch),
      nextCursor: result.rows.length > query.limit && last ? encodeCursor(last.cursor_at, last.id) : null,
    };
  }

  async function transition(documentId: string, status: DocumentStatus, errorCode: string | null) {
    await pool.query('UPDATE documents SET status = $2, error_code = $3, updated_at = now() WHERE id = $1', [
      documentId,
      status,
      errorCode,
    ]);
  }

  async function reject(
    ctx: AuthenticatedContext,
    row: { id: string; batch_id: string; team_id: string | null },
    reason: RejectionReason,
    extra = {},
  ) {
    await withTransaction(pool, async (db) => {
      await db.query(`UPDATE documents SET status = 'rejected', error_code = $2, updated_at = now() WHERE id = $1`, [row.id, reason]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'document.rejected',
        targetType: 'document',
        targetId: row.id,
        ...(row.team_id ? { teamId: row.team_id } : {}),
        correlationId: ctx.correlationId,
        metadata: { reason, ...extra },
      });
    });
    throw new AppError(422, 'DOCUMENT_REJECTED', rejectionMessages[reason], { reason, documentId: row.id, ...extra });
  }

  async function fail(ctx: AuthenticatedContext, row: { id: string; team_id: string | null }, reason: FailureReason): Promise<never> {
    await transition(row.id, 'upload_failed', reason);
    await recordAudit(pool, {
      actorUserId: ctx.actor.id,
      action: 'document.upload_failed',
      targetType: 'document',
      targetId: row.id,
      ...(row.team_id ? { teamId: row.team_id } : {}),
      correlationId: ctx.correlationId,
      metadata: { reason },
    });
    throw new AppError(reason === 'storage_unavailable' ? 503 : 400, 'UPLOAD_FAILED', failureMessages[reason], {
      reason,
      documentId: row.id,
      retryable: true,
    });
  }

  /**
   * Recebe o conteúdo de um documento. Só marca `stored` depois de gravar o objeto, conferir o tamanho
   * no armazenamento e registrar a versão original (ADR-006).
   */
  async function uploadContent(ctx: AuthenticatedContext, documentId: string, body: Readable, contentLength: number | undefined) {
    const current = await loadDocument(pool, ctx, documentId);
    if (!canUploadToBatch(ctx.actor, { teamId: current.team_id, ownerId: current.owner_id })) {
      throw forbidden('Somente quem criou o lote envia o conteúdo');
    }
    const declaredSize = Number(current.declared_size);
    if (contentLength === undefined || contentLength !== declaredSize) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Content-Length deve ser igual ao tamanho declarado', { declaredSize });
    }

    // Reserva o documento: só um envio por vez; um envio abandonado pode ser retomado após o prazo.
    const claimed = await pool.query<DocumentRow>(
      `UPDATE documents SET status = 'uploading', error_code = NULL, upload_started_at = now(), updated_at = now()
        WHERE id = $1 AND (status IN ('awaiting_upload', 'upload_failed')
              OR (status = 'uploading' AND upload_started_at < now() - make_interval(mins => $2)))
        RETURNING *`,
      [documentId, STALE_UPLOAD_MINUTES],
    );
    if (!claimed.rowCount) throw conflict(`Documento não aceita envio no estado "${current.status}"`);
    const row = { ...current, ...claimed.rows[0]! };

    let spooled: SpooledFile | undefined;
    try {
      try {
        spooled = await spoolToTempFile(body, declaredSize, config.UPLOAD_TMP_DIR);
      } catch (error) {
        if (error instanceof TooLargeError) return await reject(ctx, row, 'size_mismatch');
        return await fail(ctx, row, 'interrupted');
      }
      if (spooled.size !== declaredSize) return await fail(ctx, row, 'interrupted');

      const detected = await detectFormat(spooled.path);
      if (!detected.ok) return await reject(ctx, row, detected.reason);
      const extension = extensionOf(row.display_name);
      if (!extension || formatForExtension(extension) !== detected.format) {
        return await reject(ctx, row, 'extension_mismatch', { detectedFormat: detected.format });
      }

      const duplicate = await pool.query<{ id: string }>(
        `SELECT id FROM documents WHERE batch_id = $1 AND sha256 = $2 AND status = 'stored' AND id <> $3`,
        [row.batch_id, spooled.sha256, row.id],
      );
      if (duplicate.rows[0]) return await reject(ctx, row, 'duplicate', { duplicateOf: duplicate.rows[0].id });

      const key = `batches/${row.batch_id}/documents/${row.id}/original`;
      try {
        await storage.putFile(key, spooled.path, spooled.size, CONTENT_TYPES[detected.format]);
        const stored = await storage.head(key);
        if (stored?.size !== spooled.size) throw new Error('Tamanho divergente no armazenamento');
      } catch {
        return await fail(ctx, row, 'storage_unavailable');
      }

      const sha256 = spooled.sha256;
      const size = spooled.size;
      try {
        const updated = await withTransaction(pool, async (db) => {
          await db.query(
            `INSERT INTO document_versions (document_id, kind, object_key, format, size_bytes, sha256)
             VALUES ($1, 'original', $2, $3, $4, $5)
             ON CONFLICT (document_id, kind) DO NOTHING`,
            [row.id, key, detected.format, size, sha256],
          );
          const result = await db.query<DocumentRow>(
            `UPDATE documents SET status = 'stored', detected_format = $2, sha256 = $3, stored_at = now(), error_code = NULL, updated_at = now()
              WHERE id = $1 AND status = 'uploading' RETURNING *`,
            [row.id, detected.format, sha256],
          );
          if (!result.rowCount) throw conflict('Documento mudou de estado durante o envio');
          await recordAudit(db, {
            actorUserId: ctx.actor.id,
            action: 'document.stored',
            targetType: 'document',
            targetId: row.id,
            ...(row.team_id ? { teamId: row.team_id } : {}),
            correlationId: ctx.correlationId,
            metadata: { format: detected.format, size },
          });
          await enqueueTranslations(db, { documentId: row.id }, ctx.actor.id);
          return result.rows[0]!;
        });
        return toDocument(updated);
      } catch (error) {
        // Mesmo conteúdo armazenado em paralelo no mesmo lote.
        if ((error as { code?: string }).code === '23505') {
          await storage.delete(key).catch(() => undefined);
          return await reject(ctx, row, 'duplicate');
        }
        throw error;
      }
    } catch (error) {
      // Erro inesperado: nunca deixar o documento preso em `uploading` nem aparentar sucesso.
      if (!(error instanceof AppError)) await transition(row.id, 'upload_failed', 'interrupted').catch(() => undefined);
      throw error;
    } finally {
      await spooled?.dispose();
    }
  }

  async function cancelDocument(ctx: AuthenticatedContext, documentId: string) {
    return withTransaction(pool, async (db) => {
      const row = await loadDocument(db, ctx, documentId, true);
      if (!canCancelInBatch(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) throw forbidden();
      if (row.status !== 'awaiting_upload' && row.status !== 'upload_failed') {
        throw conflict(`Documento não pode ser cancelado no estado "${row.status}"`);
      }
      const updated = await db.query<DocumentRow>(
        `UPDATE documents SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
        [documentId],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'document.cancelled',
        targetType: 'document',
        targetId: documentId,
        ...(row.team_id ? { teamId: row.team_id } : {}),
        correlationId: ctx.correlationId,
      });
      return toDocument(updated.rows[0]!);
    });
  }

  async function cancelBatch(ctx: AuthenticatedContext, batchId: string) {
    return withTransaction(pool, async (db) => {
      const batch = await loadBatch(db, ctx, batchId);
      if (!canCancelInBatch(ctx.actor, { teamId: batch.team_id, ownerId: batch.owner_id })) throw forbidden();
      const result = await db.query(
        `UPDATE documents SET status = 'cancelled', updated_at = now()
          WHERE batch_id = $1 AND status IN ('awaiting_upload', 'upload_failed')`,
        [batchId],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'batch.cancelled',
        targetType: 'batch',
        targetId: batchId,
        ...(batch.team_id ? { teamId: batch.team_id } : {}),
        correlationId: ctx.correlationId,
        metadata: { cancelled: result.rowCount ?? 0 },
      });
      return { cancelled: result.rowCount ?? 0 };
    });
  }

  /**
   * Direciona (ou redireciona) um lote para uma equipe. A partir daí todos da equipe trabalham com ele;
   * os objetos não mudam de lugar, pois a chave independe da equipe.
   */
  async function assignBatch(ctx: AuthenticatedContext, batchId: string, teamId: string) {
    if (!canAssignBatch(ctx.actor)) {
      await loadBatch(pool, ctx, batchId);
      throw forbidden('Somente o Diretor direciona lotes');
    }
    await withTransaction(pool, async (db) => {
      const found = await db.query<{ team_id: string | null }>('SELECT team_id FROM batches WHERE id = $1 FOR UPDATE', [batchId]);
      const batch = found.rows[0];
      if (!batch) throw notFound('Lote não encontrado');
      const team = await db.query('SELECT 1 FROM teams WHERE id = $1 FOR SHARE', [teamId]);
      if (!team.rowCount) throw notFound('Equipe não encontrada');
      if (batch.team_id === teamId) return;
      await db.query('UPDATE batches SET team_id = $2, assigned_at = now(), assigned_by = $3 WHERE id = $1', [
        batchId,
        teamId,
        ctx.actor.id,
      ]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'batch.assigned',
        targetType: 'batch',
        targetId: batchId,
        teamId,
        correlationId: ctx.correlationId,
        metadata: { from: batch.team_id, to: teamId },
      });
      // Documentos armazenados antes da criação desta regra ainda podem estar fora da fila.
      await enqueueTranslations(db, { batchId }, ctx.actor.id);
      const name = (await db.query<{ name: string | null }>('SELECT name FROM batches WHERE id = $1', [batchId])).rows[0]?.name;
      await notify(
        db,
        { teamId, leaders: true, operators: true, exclude: ctx.actor.id },
        {
          kind: 'batch_assigned',
          title: `Novo lote para a equipe${name ? `: ${name}` : ''}`,
          body: 'O Diretor direcionou um lote para a sua equipe; as traduções já aparecem em Traduções.',
          batchId,
        },
      );
    });
    return getBatch(ctx, batchId);
  }

  /** Download do original: permissão reavaliada agora e acesso auditado. */
  async function openOriginal(ctx: AuthenticatedContext, documentId: string) {
    const row = await loadDocument(pool, ctx, documentId);
    if (row.status !== 'stored') throw conflict('Documento ainda não está disponível');
    const version = await pool.query<{ object_key: string; format: DetectedFormat; size_bytes: string }>(
      `SELECT object_key, format, size_bytes FROM document_versions WHERE document_id = $1 AND kind = 'original'`,
      [documentId],
    );
    const original = version.rows[0];
    if (!original) throw notFound('Versão original não encontrada');
    let stream: Readable;
    try {
      stream = await storage.get(original.object_key);
    } catch {
      throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Armazenamento indisponível');
    }
    await recordAudit(pool, {
      actorUserId: ctx.actor.id,
      action: 'document.downloaded',
      targetType: 'document',
      targetId: documentId,
      ...(row.team_id ? { teamId: row.team_id } : {}),
      correlationId: ctx.correlationId,
      metadata: { version: 'original' },
    });
    return { stream, name: row.display_name, contentType: CONTENT_TYPES[original.format], size: Number(original.size_bytes) };
  }

  /**
   * Documentos enviados com as traduções geradas a partir de cada um (ADR-010): base da área de downloads e da
   * localização de um original pelo seu resultado, e vice-versa.
   */
  async function searchDocuments(ctx: AuthenticatedContext, query: DocumentSearchQuery) {
    const after = decodeCursor(query.cursor, ([at, id]) => !!at && !Number.isNaN(Date.parse(at)) && !!id && UUID.test(id));
    const sql = sqlConditions();
    addVisibility(sql, ctx.actor);
    if (query.teamId) sql.conditions.push(`b.team_id = ${sql.param(query.teamId)}`);
    if (query.unassigned) sql.conditions.push('b.team_id IS NULL');
    if (query.batchId) sql.conditions.push(`b.id = ${sql.param(query.batchId)}`);
    if (query.mine) sql.conditions.push(`b.owner_id = ${sql.param(ctx.actor.id)}`);
    if (query.uploadedBy) sql.conditions.push(`b.owner_id = ${sql.param(query.uploadedBy)}`);
    if (query.status?.length) sql.conditions.push(`d.status = ANY(${sql.param(query.status)}::text[])`);
    if (query.format?.length) sql.conditions.push(`d.detected_format = ANY(${sql.param(query.format)}::text[])`);
    if (query.tag) sql.conditions.push(`${sql.param(query.tag)} = ANY(d.tags)`);
    if (query.untagged) sql.conditions.push('cardinality(d.tags) = 0');
    if (query.from) sql.conditions.push(`coalesce(d.stored_at, d.updated_at) >= ${sql.param(query.from)}::date`);
    if (query.to) sql.conditions.push(`coalesce(d.stored_at, d.updated_at) < ${sql.param(query.to)}::date + 1`);
    if (query.translation === 'none') {
      sql.conditions.push(`NOT EXISTS (SELECT 1 FROM translation_jobs j WHERE j.document_id = d.id AND j.status <> 'cancelled')`);
    } else if (query.translation === 'active') {
      sql.conditions.push(
        `EXISTS (SELECT 1 FROM translation_jobs j WHERE j.document_id = d.id AND j.status IN ('queued', 'processing', 'in_review', 'awaiting_approval'))`,
      );
    } else if (query.translation === 'approved') {
      sql.conditions.push(`EXISTS (SELECT 1 FROM translation_jobs j WHERE j.document_id = d.id AND j.status = 'approved')`);
    } else if (query.translation === 'failed') {
      sql.conditions.push(`EXISTS (SELECT 1 FROM translation_jobs j WHERE j.document_id = d.id AND j.status = 'failed')`);
    }
    if (query.q) {
      const pattern = sql.param(likePattern(query.q));
      sql.conditions.push(
        `(unaccent(d.display_name) ILIKE unaccent(${pattern}) OR unaccent(coalesce(b.name, '')) ILIKE unaccent(${pattern})
          OR unaccent(u.display_name) ILIKE unaccent(${pattern})
          OR EXISTS (SELECT 1 FROM translation_jobs j WHERE j.document_id = d.id
                      AND (unaccent(coalesce(j.document_type, '')) ILIKE unaccent(${pattern})
                           OR coalesce(j.number_label, '') ILIKE ${pattern})))`,
      );
    }
    if (after) {
      sql.conditions.push(
        `(coalesce(d.stored_at, d.updated_at), d.id) < (${sql.param(after[0])}::timestamptz, ${sql.param(after[1])}::uuid)`,
      );
    }
    const limit = sql.param(query.limit + 1);
    const result = await pool.query<
      DocumentRow & {
        batch_name: string | null;
        team_id: string | null;
        team_name: string | null;
        owner_id: string;
        owner_name: string;
        cursor_at: string;
        translations: Array<{
          id: string;
          sourceLanguage: 'pt' | 'en';
          targetLanguage: 'pt' | 'en';
          status: string;
          number: string | null;
          documentType: string | null;
          approvedAt: string | null;
        }>;
      }
    >(
      `SELECT d.*, b.name AS batch_name, b.team_id, t.name::text AS team_name, b.owner_id, u.display_name AS owner_name,
              to_char(coalesce(d.stored_at, d.updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
              (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'id', j.id, 'sourceLanguage', j.source_language, 'targetLanguage', j.target_language, 'status', j.status,
                        'number', j.number_label,
                        'documentType', j.document_type, 'approvedAt', j.approved_at) ORDER BY j.created_at DESC), '[]'::jsonb)
                 FROM translation_jobs j WHERE j.document_id = d.id) AS translations
         FROM documents d
         JOIN batches b ON b.id = d.batch_id
         LEFT JOIN teams t ON t.id = b.team_id
         JOIN users u ON u.id = b.owner_id
        ${sql.conditions.length ? `WHERE ${sql.conditions.join(' AND ')}` : ''}
        ORDER BY coalesce(d.stored_at, d.updated_at) DESC, d.id DESC
        LIMIT ${limit}`,
      sql.params,
    );
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        ...toDocument(row),
        batch: { id: row.batch_id, name: row.batch_name },
        team: row.team_id ? { id: row.team_id, name: row.team_name ?? '' } : null,
        uploadedBy: { id: row.owner_id, displayName: row.owner_name },
        translations: row.translations,
      })),
      nextCursor: result.rows.length > query.limit && last ? encodeCursor(last.cursor_at, last.id) : null,
    };
  }

  /** Etiquetas de um documento: quem vê o documento ajuda a classificá-lo. */
  async function updateTags(ctx: AuthenticatedContext, documentId: string, tags: string[]) {
    return withTransaction(pool, async (db) => {
      const row = await loadDocument(db, ctx, documentId, true);
      const updated = await db.query<DocumentRow>('UPDATE documents SET tags = $2, updated_at = now() WHERE id = $1 RETURNING *', [
        documentId,
        tags,
      ]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'document.tagged',
        targetType: 'document',
        targetId: documentId,
        ...(row.team_id ? { teamId: row.team_id } : {}),
        correlationId: ctx.correlationId,
        metadata: { tags },
      });
      return toDocument(updated.rows[0]!);
    });
  }

  /** Etiquetas em uso nos documentos que o ator vê, das mais usadas para as menos. */
  async function listTags(ctx: AuthenticatedContext) {
    const sql = sqlConditions();
    addVisibility(sql, ctx.actor);
    const result = await pool.query<{ tag: string; count: number }>(
      `SELECT tag, count(*)::int AS count FROM documents d JOIN batches b ON b.id = d.batch_id, unnest(d.tags) AS tag
        ${sql.conditions.length ? `WHERE ${sql.conditions.join(' AND ')}` : ''}
        GROUP BY tag ORDER BY count(*) DESC, tag LIMIT 300`,
      sql.params,
    );
    return result.rows;
  }

  return {
    createBatch,
    listBatches,
    getBatch,
    assignBatch,
    uploadContent,
    cancelDocument,
    cancelBatch,
    openOriginal,
    searchDocuments,
    updateTags,
    listTags,
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;

const rejectionMessages: Record<RejectionReason, string> = {
  unsupported_extension: 'Extensão não aceita',
  empty: 'Arquivo vazio',
  too_large: 'Arquivo acima do limite',
  size_mismatch: 'O conteúdo recebido não tem o tamanho declarado',
  unknown_format: 'Formato não reconhecido; envie DOCX, PDF, JPG, PNG ou PPTX',
  protected_or_legacy: 'Documento protegido por senha ou em formato legado (.doc/.ppt)',
  invalid_archive: 'Arquivo corrompido ou inválido',
  extension_mismatch: 'O conteúdo não corresponde à extensão do arquivo',
  duplicate: 'O mesmo conteúdo já foi enviado neste lote',
};

const failureMessages: Record<FailureReason, string> = {
  interrupted: 'Envio interrompido; tente novamente',
  storage_unavailable: 'Armazenamento indisponível; tente novamente',
};
