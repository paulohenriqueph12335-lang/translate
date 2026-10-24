import type { PoolClient } from 'pg';
import { notify, recordAudit, withTransaction } from '@tradutor/core/db';
import { canWorkOnTranslation, isDirector, type Actor } from '../access/policy.js';
import { AppError, conflict, forbidden, notFound } from '../../http/errors.js';
import type { AuthenticatedContext, ServiceDeps } from '../context.js';
import { likePattern } from '../pagination.js';
import { canManageTranslators } from '../translators/service.js';
import {
  checkEntry,
  NumberingConfig,
  parseStockCsv,
  PRESETS,
  remainingByLimit,
  schemeLabel,
  type Anomaly,
  type BookState,
  type CheckResult,
  type EntryInput,
  type Scheme,
  type StockState,
} from './rules.js';

type Db = Pick<PoolClient, 'query'>;

/** Supervisores administram a numeração dos tradutores; o Diretor acompanha e autoriza exceções. */
const canAdminister = (actor: Actor) => canManageTranslators(actor);
const canAuthorize = (actor: Actor) => canManageTranslators(actor) || isDirector(actor);

interface RuleRow {
  id: string;
  name: string;
  active: boolean;
  numbering_scheme: Scheme;
  numbering_config: unknown;
}

interface EntryRow {
  job_id: string;
  translator_id: string;
  translator_name: string;
  number: string | null;
  book: string | null;
  sheet_start: number | null;
  sheet_end: number | null;
  pages: number | null;
  protocol: string | null;
  medium: 'digital' | 'impresso' | null;
  language: string;
  free: boolean;
  protocol_value: string | null;
  translator_fee: string | null;
  page_charge: string | null;
  zero_protocol_authorized_by: string | null;
  authorized_by_name: string | null;
  status: 'draft' | 'issued' | 'void';
  anomalies: Anomaly[];
  entered_by_name: string;
  issued_at: Date | null;
  updated_at: Date;
}

const toNumber = (value: string | null) => (value === null ? null : Number(value));
const toEntry = (row: EntryRow) => ({
  translatorId: row.translator_id,
  translatorName: row.translator_name,
  number: row.number,
  book: row.book,
  sheetStart: row.sheet_start,
  sheetEnd: row.sheet_end,
  pages: row.pages,
  protocol: row.protocol,
  medium: row.medium,
  language: row.language || null,
  free: row.free,
  protocolValue: toNumber(row.protocol_value),
  translatorFee: toNumber(row.translator_fee),
  pageCharge: toNumber(row.page_charge),
  zeroProtocolAuthorizedBy: row.authorized_by_name,
  status: row.status,
  anomalies: row.anomalies,
  enteredBy: row.entered_by_name,
  issuedAt: row.issued_at?.toISOString() ?? null,
  updatedAt: row.updated_at.toISOString(),
});

const ENTRY_SELECT = `
  SELECT e.*, s.name AS translator_name, u.display_name AS entered_by_name, a.display_name AS authorized_by_name
    FROM numbering_entries e
    JOIN sworn_translators s ON s.id = e.translator_id
    JOIN users u ON u.id = e.entered_by
    LEFT JOIN users a ON a.id = e.zero_protocol_authorized_by`;

/** Texto da folha para o número exibido e a máscara: "12" ou "12 a 14". */
export const sheetText = (start: number | null, end: number | null) =>
  start ? (end && end !== start ? `${start} a ${end}` : String(start)) : null;

/** IDs dos Supervisores (quem cuida dos tradutores) para os avisos de numeração. */
async function managers(db: Db) {
  const result = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u JOIN team_memberships m ON m.user_id = u.id
      WHERE u.status = 'active' AND m.role = 'leader'`,
  );
  return result.rows.map((row) => row.id);
}

export function createTranslatorNumberingService({ pool }: ServiceDeps) {
  async function loadRule(db: Db, translatorId: string, lock = false) {
    const row = (
      await db.query<RuleRow>(
        `SELECT id, name, active, numbering_scheme, numbering_config FROM sworn_translators WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
        [translatorId],
      )
    ).rows[0];
    if (!row) throw notFound('Tradutor não encontrado');
    return { ...row, config: NumberingConfig.parse(row.numbering_config ?? {}) };
  }

  /** Livro que receberá a próxima tradução (atual ou o próximo da fila, se o atual esgotou); nulo = travado. */
  async function bookState(db: Db, translatorId: string, sheetLimit: number | null | undefined): Promise<BookState | null> {
    const books = (
      await db.query<{ id: string; book: string; next_number: number; next_sheet: number; status: string }>(
        `SELECT id, book, next_number, next_sheet, status FROM numbering_books
          WHERE translator_id = $1 AND status IN ('current', 'queued') ORDER BY (status = 'current') DESC, position`,
        [translatorId],
      )
    ).rows;
    const current = books.find((book) => book.status === 'current');
    const queued = books.filter((book) => book.status === 'queued');
    const toState = (book: (typeof books)[number], advanced: boolean): BookState => ({
      id: book.id,
      book: book.book,
      nextNumber: book.next_number,
      nextSheet: book.next_sheet,
      advanced,
    });
    if (current && !(sheetLimit && current.next_sheet > sheetLimit)) return toState(current, false);
    const next = queued[0];
    return next ? toState(next, !!current) : null;
  }

  /** Estado para a conferência, sem contar a própria tradução. */
  async function stateFor(
    db: Db,
    rule: Awaited<ReturnType<typeof loadRule>>,
    jobId: string,
    input: EntryInput,
    actor: Actor,
    zeroProtocolAuthorized: boolean,
  ) {
    const number = (input.number ?? '').trim();
    const language = (input.language ?? '').trim();
    const protocol = (input.protocol ?? '').trim();
    const [issued, hasStock, stockRow, duplicates, paid] = await Promise.all([
      db.query<{ n: number }>(`SELECT count(*)::int AS n FROM numbering_entries WHERE translator_id = $1 AND status = 'issued'`, [rule.id]),
      db.query<{ n: number }>('SELECT count(*)::int AS n FROM numbering_stock WHERE translator_id = $1', [rule.id]),
      number
        ? db.query<{
            id: string;
            number: string;
            book: string | null;
            free: boolean;
            status: StockState['status'];
            reserved_for: string | null;
            max_uses: number;
            uses: number;
            same_protocol: boolean;
          }>(
            `SELECT s.id, s.number, s.book, s.free, s.status, s.reserved_for, s.max_uses,
                    (SELECT count(*)::int FROM numbering_entries e WHERE e.stock_id = s.id AND e.status <> 'void' AND e.job_id <> $4) AS uses,
                    EXISTS (SELECT 1 FROM numbering_entries e WHERE e.stock_id = s.id AND e.status <> 'void' AND e.job_id <> $4
                             AND $5 <> '' AND lower(e.protocol) = lower($5)) AS same_protocol
               FROM numbering_stock s
              WHERE s.translator_id = $1 AND lower(s.number) = lower($2) AND ($3 = '' OR lower(s.language) = lower($3) OR s.language = '')
              ORDER BY (lower(s.language) = lower($3)) DESC LIMIT 1`,
            [rule.id, number, language, jobId, protocol],
          )
        : Promise.resolve({ rows: [] }),
      number
        ? db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM numbering_entries
              WHERE translator_id = $1 AND lower(number) = lower($2) AND status <> 'void' AND job_id <> $3`,
            [rule.id, number, jobId],
          )
        : Promise.resolve({ rows: [{ n: 0 }] }),
      db.query<{ total: string }>(
        `SELECT coalesce(sum(translator_fee), 0) AS total FROM numbering_entries
          WHERE translator_id = $1 AND status = 'issued' AND ($2::date IS NULL OR issued_at >= $2::date)`,
        [rule.id, rule.config.subscriptionSince ?? null],
      ),
    ]);
    const stock = stockRow.rows[0];
    return {
      actorId: actor.id,
      actorIsManager: canAuthorize(actor),
      issued: issued.rows[0]!.n,
      hasStock: hasStock.rows[0]!.n > 0,
      stock: stock
        ? {
            id: stock.id,
            number: stock.number,
            book: stock.book,
            free: stock.free,
            status: stock.status,
            reservedFor: stock.reserved_for,
            maxUses: stock.max_uses,
            uses: stock.uses,
            usedInSameProtocol: stock.same_protocol,
          }
        : null,
      duplicates: duplicates.rows[0]!.n,
      book: rule.numbering_scheme === 'book_sheet' ? await bookState(db, rule.id, rule.config.sheetLimit) : null,
      subscriptionPaid: Number(paid.rows[0]!.total),
      zeroProtocolAuthorized,
    };
  }

  async function loadJob(db: Db, ctx: AuthenticatedContext, jobId: string, lock = false) {
    const row = (
      await db.query<{
        id: string;
        status: string;
        team_id: string | null;
        owner_id: string;
        document_name: string;
        source_language: string;
        current_revision: number | null;
        consecutive_rejections: number;
      }>(
        `SELECT j.id, j.status, b.team_id, b.owner_id, d.display_name AS document_name, j.source_language,j.current_revision,j.consecutive_rejections
           FROM translation_jobs j JOIN documents d ON d.id = j.document_id JOIN batches b ON b.id = d.batch_id
          WHERE j.id = $1 ${lock ? 'FOR UPDATE OF j' : ''}`,
        [jobId],
      )
    ).rows[0];
    if (!row || !canWorkOnTranslation(ctx.actor, { teamId: row.team_id, ownerId: row.owner_id })) throw notFound('Tradução não encontrada');
    return row;
  }

  const entryOf = async (db: Db, jobId: string) => (await db.query<EntryRow>(`${ENTRY_SELECT} WHERE e.job_id = $1`, [jobId])).rows[0];

  const inputOf = (row: EntryRow): EntryInput => ({
    number: row.number,
    book: row.book,
    pages: row.pages,
    protocol: row.protocol,
    medium: row.medium,
    language: row.language,
    free: row.free,
    protocolValue: toNumber(row.protocol_value),
    translatorFee: toNumber(row.translator_fee),
  });

  const ruleView = (rule: Awaited<ReturnType<typeof loadRule>>) => ({
    translatorId: rule.id,
    translatorName: rule.name,
    scheme: rule.numbering_scheme,
    schemeLabel: schemeLabel[rule.numbering_scheme],
    config: rule.config,
  });

  // ---------- Regra do tradutor (Supervisor) ----------

  async function getRule(ctx: AuthenticatedContext, translatorId: string) {
    const rule = await loadRule(pool, translatorId);
    return { rule: ruleView(rule), presets: canAdminister(ctx.actor) ? PRESETS : undefined };
  }

  async function setRule(ctx: AuthenticatedContext, translatorId: string, input: { scheme: Scheme; config: NumberingConfig }) {
    if (!canAdminister(ctx.actor)) throw forbidden('Somente Supervisores configuram a numeração dos tradutores');
    await withTransaction(pool, async (db) => {
      await loadRule(db, translatorId, true);
      await db.query(
        'UPDATE sworn_translators SET numbering_scheme = $2, numbering_config = $3, updated_by = $4, updated_at = now() WHERE id = $1',
        [translatorId, input.scheme, JSON.stringify(input.config), ctx.actor.id],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'numbering.rule_set',
        targetType: 'translator',
        targetId: translatorId,
        correlationId: ctx.correlationId,
        metadata: { scheme: input.scheme, ...input.config },
      });
    });
    return getRule(ctx, translatorId);
  }

  // ---------- Estoque por planilha ----------

  async function importStock(
    ctx: AuthenticatedContext,
    translatorId: string,
    input: { fileName: string; text: string; language?: string; free?: boolean },
  ) {
    if (!canAdminister(ctx.actor)) throw forbidden('Somente Supervisores enviam as planilhas de números');
    return withTransaction(pool, async (db) => {
      const rule = await loadRule(db, translatorId, true);
      const parsed = parseStockCsv(input.text, { ...(input.language ? { language: input.language } : {}), free: input.free === true });
      if (!parsed.rows.length) throw new AppError(400, 'VALIDATION_FAILED', 'A planilha não tem números', { problems: parsed.problems });
      const maxUses = rule.numbering_scheme === 'reusable_stock' ? (rule.config.maxUses ?? 2) : 1;
      const created = await db.query<{ id: string }>(
        `INSERT INTO numbering_imports (translator_id, file_name, rows_read, rows_imported, problems, uploaded_by)
         VALUES ($1, $2, $3, 0, '[]', $4) RETURNING id`,
        [translatorId, input.fileName.slice(0, 255), parsed.read, ctx.actor.id],
      );
      const importId = created.rows[0]!.id;
      const inserted = await db.query<{ number: string; language: string }>(
        `INSERT INTO numbering_stock (translator_id, language, number, book, free, max_uses, import_id)
         SELECT $1, row.language, row.number, nullif(row.book, ''), row.free, $2, $3
           FROM jsonb_to_recordset($4::jsonb) AS row(number text, book text, language text, free boolean)
         ON CONFLICT (translator_id, language, number) DO NOTHING
         RETURNING number, language`,
        [translatorId, maxUses, importId, JSON.stringify(parsed.rows)],
      );
      const insertedKeys = new Set(inserted.rows.map((row) => `${row.language.toLowerCase()}|${row.number}`));
      const problems = [
        ...parsed.problems,
        ...parsed.rows
          .filter((row) => !insertedKeys.has(`${row.language.toLowerCase()}|${row.number}`))
          .map((row) => ({ line: 0, message: `Já estava no estoque: ${row.number}${row.language ? ` (${row.language})` : ''}` })),
      ];
      await db.query('UPDATE numbering_imports SET rows_imported = $2, problems = $3 WHERE id = $1', [
        importId,
        inserted.rowCount ?? 0,
        JSON.stringify(problems.slice(0, 500)),
      ]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'numbering.stock_imported',
        targetType: 'translator',
        targetId: translatorId,
        correlationId: ctx.correlationId,
        metadata: { file: input.fileName, read: parsed.read, imported: inserted.rowCount ?? 0, problems: problems.length },
      });
      return { read: parsed.read, imported: inserted.rowCount ?? 0, problems };
    });
  }

  async function listStock(
    ctx: AuthenticatedContext,
    translatorId: string,
    query: {
      status?: 'available' | 'reserved' | 'blocked';
      usage?: 'unused' | 'used' | 'exhausted';
      language?: string;
      free?: boolean;
      q?: string;
      limit: number;
      offset: number;
    },
  ) {
    if (!canAuthorize(ctx.actor)) throw forbidden();
    await loadRule(pool, translatorId);
    const params: unknown[] = [translatorId];
    const param = (value: unknown) => (params.push(value), `$${params.length}`);
    const conditions = ['s.translator_id = $1'];
    if (query.status) conditions.push(`s.status = ${param(query.status)}`);
    if (query.language !== undefined) conditions.push(`lower(s.language) = lower(${param(query.language)})`);
    if (query.free !== undefined) conditions.push(`s.free = ${param(query.free)}`);
    if (query.q) conditions.push(`s.number ILIKE ${param(likePattern(query.q))}`);
    const uses = `(SELECT count(*) FROM numbering_entries e WHERE e.stock_id = s.id AND e.status <> 'void')`;
    if (query.usage === 'unused') conditions.push(`${uses} = 0`);
    if (query.usage === 'used') conditions.push(`${uses} > 0`);
    if (query.usage === 'exhausted') conditions.push(`${uses} >= s.max_uses`);
    const rows = await pool.query<{
      id: string;
      number: string;
      book: string | null;
      language: string;
      free: boolean;
      max_uses: number;
      status: string;
      reserved_for: string | null;
      reserved_name: string | null;
      notify_on_use: boolean;
      note: string | null;
      uses: number;
      protocols: string[];
    }>(
      `SELECT s.*, r.display_name AS reserved_name, ${uses}::int AS uses,
              coalesce((SELECT array_agg(e.protocol) FROM numbering_entries e WHERE e.stock_id = s.id AND e.status <> 'void' AND e.protocol IS NOT NULL), '{}') AS protocols
         FROM numbering_stock s LEFT JOIN users r ON r.id = s.reserved_for
        WHERE ${conditions.join(' AND ')}
        ORDER BY s.language, s.number LIMIT ${param(query.limit + 1)} OFFSET ${param(query.offset)}`,
      params,
    );
    return {
      items: rows.rows.slice(0, query.limit).map((row) => ({
        id: row.id,
        number: row.number,
        book: row.book,
        language: row.language || null,
        free: row.free,
        maxUses: row.max_uses,
        uses: row.uses,
        protocols: row.protocols,
        status: row.status,
        reservedFor: row.reserved_for ? { id: row.reserved_for, name: row.reserved_name } : null,
        notifyOnUse: row.notify_on_use,
        note: row.note,
      })),
      hasMore: rows.rows.length > query.limit,
    };
  }

  async function updateStock(
    ctx: AuthenticatedContext,
    stockId: string,
    input: { status?: 'available' | 'reserved' | 'blocked'; reservedFor?: string | null; notifyOnUse?: boolean; note?: string | null },
  ) {
    if (!canAdminister(ctx.actor)) throw forbidden('Somente Supervisores reservam, bloqueiam ou marcam números');
    return withTransaction(pool, async (db) => {
      const found = (
        await db.query<{ translator_id: string; status: string }>(
          'SELECT translator_id, status FROM numbering_stock WHERE id = $1 FOR UPDATE',
          [stockId],
        )
      ).rows[0];
      if (!found) throw notFound('Número não encontrado');
      if (input.status === 'reserved' && !input.reservedFor)
        throw new AppError(400, 'VALIDATION_FAILED', 'Escolha para quem o número fica reservado');
      await db.query(
        `UPDATE numbering_stock SET status = coalesce($2, status),
                reserved_for = CASE WHEN coalesce($2, status) = 'reserved' THEN coalesce($3, reserved_for) ELSE NULL END,
                notify_on_use = coalesce($4, notify_on_use), note = CASE WHEN $6 THEN $5 ELSE note END, updated_at = now()
          WHERE id = $1`,
        [stockId, input.status ?? null, input.reservedFor ?? null, input.notifyOnUse ?? null, input.note ?? null, input.note !== undefined],
      );
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'numbering.stock_updated',
        targetType: 'numbering_stock',
        targetId: stockId,
        correlationId: ctx.correlationId,
        metadata: { ...input },
      });
      return { ok: true };
    });
  }

  /** Excluir só número nunca usado; usado, o Supervisor bloqueia (fica no histórico). */
  async function deleteStock(ctx: AuthenticatedContext, stockId: string) {
    if (!canAdminister(ctx.actor)) throw forbidden('Somente Supervisores excluem números');
    await withTransaction(pool, async (db) => {
      const found = (
        await db.query<{ number: string; translator_id: string; used: boolean }>(
          `SELECT number, translator_id, EXISTS (SELECT 1 FROM numbering_entries e WHERE e.stock_id = s.id) AS used
             FROM numbering_stock s WHERE id = $1 FOR UPDATE`,
          [stockId],
        )
      ).rows[0];
      if (!found) throw notFound('Número não encontrado');
      if (found.used) throw conflict(`O nº ${found.number} já foi usado e não pode ser excluído; bloqueie-o se não deve mais ser usado`);
      await db.query('DELETE FROM numbering_stock WHERE id = $1', [stockId]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'numbering.stock_deleted',
        targetType: 'translator',
        targetId: found.translator_id,
        correlationId: ctx.correlationId,
        metadata: { number: found.number },
      });
    });
  }

  // ---------- Livros com limite de folhas ----------

  async function listBooks(ctx: AuthenticatedContext, translatorId: string) {
    if (!canAuthorize(ctx.actor)) throw forbidden();
    const rule = await loadRule(pool, translatorId);
    const rows = await pool.query<{
      id: string;
      position: number;
      book: string;
      next_number: number;
      next_sheet: number;
      status: string;
      started_at: Date | null;
      closed_at: Date | null;
    }>('SELECT * FROM numbering_books WHERE translator_id = $1 ORDER BY position', [translatorId]);
    return {
      sheetLimit: rule.config.sheetLimit ?? null,
      items: rows.rows.map((row) => ({
        id: row.id,
        position: row.position,
        book: row.book,
        nextNumber: row.next_number,
        nextSheet: row.next_sheet,
        status: row.status,
        sheetsLeft: rule.config.sheetLimit ? Math.max(0, rule.config.sheetLimit - row.next_sheet + 1) : null,
        startedAt: row.started_at?.toISOString() ?? null,
        closedAt: row.closed_at?.toISOString() ?? null,
      })),
    };
  }

  /** Cadastra o próximo livro (ou o primeiro, que já vira o atual). */
  async function addBook(ctx: AuthenticatedContext, translatorId: string, input: { book: string; nextNumber: number; nextSheet?: number }) {
    if (!canAdminister(ctx.actor)) throw forbidden('Somente Supervisores cadastram livros');
    try {
      await withTransaction(pool, async (db) => {
        await loadRule(db, translatorId, true);
        const state = (
          await db.query<{ position: number; current: boolean }>(
            `SELECT coalesce(max(position), 0) + 1 AS position, bool_or(status = 'current') AS current FROM numbering_books WHERE translator_id = $1`,
            [translatorId],
          )
        ).rows[0]!;
        await db.query(
          `INSERT INTO numbering_books (translator_id, position, book, next_number, next_sheet, status, created_by, started_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'current' THEN now() END)`,
          [
            translatorId,
            state.position,
            input.book,
            input.nextNumber,
            input.nextSheet ?? 1,
            state.current ? 'queued' : 'current',
            ctx.actor.id,
          ],
        );
        await recordAudit(db, {
          actorUserId: ctx.actor.id,
          action: 'numbering.book_added',
          targetType: 'translator',
          targetId: translatorId,
          correlationId: ctx.correlationId,
          metadata: { ...input },
        });
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict(`O livro ${input.book} já está cadastrado para este tradutor`);
      throw error;
    }
    return listBooks(ctx, translatorId);
  }

  async function removeBook(ctx: AuthenticatedContext, bookId: string) {
    if (!canAdminister(ctx.actor)) throw forbidden('Somente Supervisores removem livros');
    const removed = await pool.query(`DELETE FROM numbering_books WHERE id = $1 AND status = 'queued' RETURNING translator_id`, [bookId]);
    if (!removed.rowCount) throw conflict('Só é possível remover um livro que ainda não começou');
  }

  // ---------- Numeração da tradução (usuário) ----------

  /** Numeração preenchida, a regra do tradutor e a conferência atual (com o que o sistema prevê, no livro e folha). */
  async function getEntry(ctx: AuthenticatedContext, jobId: string, translatorId?: string) {
    await loadJob(pool, ctx, jobId);
    const entry = await entryOf(pool, jobId);
    const chosen = translatorId ?? entry?.translator_id;
    if (!chosen) return { entry: null, rule: null, check: null };
    const rule = await loadRule(pool, chosen);
    const input = entry && entry.translator_id === chosen ? inputOf(entry) : {};
    const check =
      entry?.status === 'issued'
        ? null
        : checkEntry(
            rule.numbering_scheme,
            rule.config,
            input,
            await stateFor(pool, rule, jobId, input, ctx.actor, !!entry?.zero_protocol_authorized_by),
          );
    return { entry: entry ? toEntry(entry) : null, rule: ruleView(rule), check };
  }

  /** O usuário grava a numeração; a conferência roda e os problemas ficam registrados (e avisam os Supervisores). */
  async function saveEntry(
    ctx: AuthenticatedContext,
    jobId: string,
    input: EntryInput & { translatorId: string; confirmCompleted?: boolean },
  ) {
    return withTransaction(pool, async (db) => {
      const job = await loadJob(db, ctx, jobId, true);
      if (job.status !== 'in_review' && job.status !== 'awaiting_approval')
        throw conflict('A numeração só muda enquanto a tradução está em revisão');
      if (job.consecutive_rejections >= 3)
        throw new AppError(409, 'CONFLICT', 'Registre uma nova forma de formatação antes de alterar o Word', {
          reason: 'review_attempts_exhausted',
        });
      if (job.status === 'awaiting_approval' && !input.confirmCompleted)
        throw new AppError(409, 'CONFLICT', 'Confirme a alteração da numeração deste documento pronto', {
          reason: 'completed_confirmation_required',
        });
      const previous = await entryOf(db, jobId);
      if (previous?.status === 'issued') throw conflict('O número já foi emitido; peça alteração em Numeração');
      const rule = await loadRule(db, input.translatorId);
      if (!rule.active) throw conflict(`${rule.name} está inativo`);
      const authorized = previous?.translator_id === rule.id ? previous.zero_protocol_authorized_by : null;
      const check = checkEntry(rule.numbering_scheme, rule.config, input, await stateFor(db, rule, jobId, input, ctx.actor, !!authorized));
      await upsertDraft(db, ctx, jobId, rule.id, input, check, authorized);
      const saved = (await entryOf(db, jobId))!;
      const displayed = (entry: EntryRow) => ({
        translator: entry.translator_id,
        number: entry.number,
        book: entry.book,
        sheetStart: entry.sheet_start,
        sheetEnd: entry.sheet_end,
        pages: entry.pages,
        protocol: entry.protocol,
        medium: entry.medium,
        language: entry.language,
        free: entry.free,
        protocolValue: toNumber(entry.protocol_value),
        translatorFee: toNumber(entry.translator_fee),
        pageCharge: toNumber(entry.page_charge),
      });
      const changed = !previous || JSON.stringify(displayed(previous)) !== JSON.stringify(displayed(saved));
      let revision = job.current_revision;
      if (changed && job.current_revision) {
        const next = (
          await db.query<{ revision: number }>(`SELECT coalesce(max(revision),0)+1 AS revision FROM translation_drafts WHERE job_id=$1`, [
            jobId,
          ])
        ).rows[0]!.revision;
        await db.query(
          `INSERT INTO translation_drafts(job_id,revision,content,issues,origin,author_id)
           SELECT job_id,$3,content,issues,'human',$4 FROM translation_drafts WHERE job_id=$1 AND revision=$2`,
          [jobId, job.current_revision, next, ctx.actor.id],
        );
        await db.query(`UPDATE translation_jobs SET current_revision=$2,inspection_revision=NULL,updated_at=now() WHERE id=$1`, [
          jobId,
          next,
        ]);
        revision = next;
      }
      const errors = check.anomalies.filter((anomaly) => anomaly.severity === 'error');
      const before = new Set((previous?.anomalies ?? []).map((anomaly) => anomaly.message));
      const fresh = errors.filter((anomaly) => !before.has(anomaly.message));
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'numbering.entry_saved',
        targetType: 'translation',
        targetId: jobId,
        ...(job.team_id ? { teamId: job.team_id } : {}),
        correlationId: ctx.correlationId,
        metadata: {
          translator: rule.name,
          number: check.computed.number,
          anomalies: errors.map((anomaly) => anomaly.code),
          changed,
          revision,
          previousRevision: job.current_revision,
          confirmedCompleted: input.confirmCompleted === true,
        },
      });
      // Anomalia nova (duplicado, fora do estoque, fora da sequência…): os Supervisores ficam sabendo.
      if (fresh.length) {
        await notify(
          db,
          { teamId: job.team_id, users: await managers(db), exclude: ctx.actor.id },
          {
            kind: 'numbering_anomaly',
            title: `Numeração com problema: ${job.document_name}`,
            body: `${rule.name}: ${fresh.map((anomaly) => anomaly.message).join('; ')}`.slice(0, 1000),
            translationId: jobId,
          },
        );
      }
      return { entry: toEntry(saved), rule: ruleView(rule), check, revision };
    });
  }

  async function upsertDraft(
    db: Db,
    ctx: AuthenticatedContext,
    jobId: string,
    translatorId: string,
    input: EntryInput,
    check: CheckResult,
    authorizedBy: string | null,
  ) {
    const c = check.computed;
    await db.query(
      `INSERT INTO numbering_entries (job_id, translator_id, number, book, sheet_start, sheet_end, pages, protocol, medium, language, free,
                                      protocol_value, translator_fee, page_charge, zero_protocol_authorized_by, stock_id, book_id, status, anomalies, entered_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'draft', $18, $19, now())
       ON CONFLICT (job_id) DO UPDATE SET translator_id = EXCLUDED.translator_id, number = EXCLUDED.number, book = EXCLUDED.book,
         sheet_start = EXCLUDED.sheet_start, sheet_end = EXCLUDED.sheet_end, pages = EXCLUDED.pages, protocol = EXCLUDED.protocol,
         medium = EXCLUDED.medium, language = EXCLUDED.language, free = EXCLUDED.free, protocol_value = EXCLUDED.protocol_value,
         translator_fee = EXCLUDED.translator_fee, page_charge = EXCLUDED.page_charge,
         zero_protocol_authorized_by = EXCLUDED.zero_protocol_authorized_by, stock_id = EXCLUDED.stock_id, book_id = EXCLUDED.book_id,
         anomalies = EXCLUDED.anomalies, entered_by = EXCLUDED.entered_by, updated_at = now()`,
      [
        jobId,
        translatorId,
        c.number,
        c.book,
        c.sheetStart,
        c.sheetEnd,
        c.pages,
        (input.protocol ?? '').trim() || null,
        input.medium ?? null,
        (input.language ?? '').trim(),
        c.free,
        c.protocolValue,
        c.translatorFee,
        c.pageCharge,
        authorizedBy,
        c.stockId,
        c.bookId,
        JSON.stringify(check.anomalies),
        ctx.actor.id,
      ],
    );
  }

  /** Protocolo zerado (Walter): só Supervisor ou Diretor autoriza. */
  async function authorizeZeroProtocol(ctx: AuthenticatedContext, jobId: string, options: { confirmCompleted?: boolean } = {}) {
    if (!canAuthorize(ctx.actor)) throw forbidden('Somente o Supervisor ou o Diretor autoriza protocolo zerado');
    await withTransaction(pool, async (db) => {
      const job = await loadJob(db, ctx, jobId, true);
      if (!['in_review', 'awaiting_approval'].includes(job.status)) throw conflict('A autorização só muda durante a revisão');
      if (job.status === 'awaiting_approval' && !options.confirmCompleted)
        throw new AppError(409, 'CONFLICT', 'Confirme a autorização de protocolo zerado deste documento pronto', {
          reason: 'completed_confirmation_required',
        });
      if (job.consecutive_rejections >= 3)
        throw new AppError(409, 'CONFLICT', 'Registre uma nova forma de formatação antes de tentar novamente', {
          reason: 'review_attempts_exhausted',
        });
      const entry = await entryOf(db, jobId);
      if (!entry || entry.status !== 'draft') throw conflict('Preencha a numeração antes de autorizar');
      await db.query('UPDATE numbering_entries SET zero_protocol_authorized_by = $2, updated_at = now() WHERE job_id = $1', [
        jobId,
        ctx.actor.id,
      ]);
      if (entry.zero_protocol_authorized_by !== ctx.actor.id)
        await db.query('UPDATE translation_jobs SET last_activity_at=now() WHERE id=$1', [jobId]);
      await recordAudit(db, {
        actorUserId: ctx.actor.id,
        action: 'numbering.zero_protocol_authorized',
        targetType: 'translation',
        targetId: jobId,
        ...(job.team_id ? { teamId: job.team_id } : {}),
        correlationId: ctx.correlationId,
        metadata: { confirmedCompleted: options.confirmCompleted === true },
      });
    });
    return getEntry(ctx, jobId);
  }

  /** Erros de numeração em aberto (para bloquear "Pronta" enquanto houver anomalia). */
  async function openErrors(db: Db, jobId: string) {
    const entry = await entryOf(db, jobId);
    return entry ? entry.anomalies.filter((anomaly) => anomaly.severity === 'error') : [];
  }

  /**
   * Emite a numeração na conclusão, sob bloqueio do tradutor (dois Supervisores não emitem o mesmo número).
   * Sem numeração preenchida, usa a digitada na conclusão (`fallback`). Devolve os rótulos e o lembrete do tradutor.
   */
  async function issue(
    db: Db,
    ctx: AuthenticatedContext,
    job: { id: string; team_id: string | null; document_name: string; assignee_id: string | null; submitted_by: string | null },
    fallback: (EntryInput & { translatorId?: string }) | null,
  ) {
    const existing = await entryOf(db, job.id);
    const translatorId = existing?.translator_id ?? fallback?.translatorId;
    if (!translatorId) {
      throw new AppError(409, 'CONFLICT', 'Preencha a numeração (tradutor e número) antes de concluir', { reason: 'translator_required' });
    }
    const rule = await loadRule(db, translatorId, true);
    if (!rule.active) throw conflict(`${rule.name} está inativo; escolha outro tradutor`);
    // Quem conclui pode completar ou corrigir o que foi preenchido; trocando o tradutor, vale só o que veio agora.
    const { translatorId: _chosen, ...typed } = fallback ?? {};
    const sameTranslator = existing?.translator_id === rule.id;
    const input: EntryInput = {
      ...(existing && sameTranslator ? inputOf(existing) : {}),
      ...Object.fromEntries(Object.entries(typed).filter(([, value]) => value !== undefined)),
    };
    const authorized = sameTranslator ? (existing?.zero_protocol_authorized_by ?? null) : null;
    const check = checkEntry(rule.numbering_scheme, rule.config, input, await stateFor(db, rule, job.id, input, ctx.actor, !!authorized));
    const errors = check.anomalies.filter((anomaly) => anomaly.severity === 'error');
    if (errors.length) {
      const text = errors.map((anomaly) => anomaly.message).join('; ');
      // Campo faltando é pedido incompleto (400); repetição e demais problemas de regra, conflito (409).
      if (errors.every((anomaly) => anomaly.code === 'missing')) throw new AppError(400, 'VALIDATION_FAILED', text, { anomalies: errors });
      throw new AppError(409, 'CONFLICT', `Numeração com problema: ${text}`, {
        reason: errors.some((anomaly) => anomaly.code === 'duplicate' || anomaly.code === 'uses_exhausted')
          ? 'number_taken'
          : 'numbering_invalid',
        anomalies: errors,
      });
    }
    await upsertDraft(db, ctx, job.id, rule.id, input, check, authorized);
    const c = check.computed;
    if (c.bookId) {
      // Livro esgotado: fecha o atual e abre o próximo da fila, que recebe esta tradução.
      await db.query(
        `UPDATE numbering_books SET status = 'closed', closed_at = now() WHERE translator_id = $1 AND status = 'current' AND id <> $2`,
        [rule.id, c.bookId],
      );
      await db.query(
        `UPDATE numbering_books SET status = 'current', started_at = coalesce(started_at, now()), next_number = next_number + 1, next_sheet = $2
          WHERE id = $1`,
        [c.bookId, (c.sheetEnd ?? c.sheetStart ?? 1) + 1],
      );
    }
    await db.query(
      `UPDATE numbering_entries SET status = 'issued', issued_at = now(), anomalies = $2, updated_at = now() WHERE job_id = $1`,
      [job.id, JSON.stringify(check.anomalies)],
    );
    await alertsAfterIssue(db, rule, job, c);
    return {
      translatorId: rule.id,
      number: c.number!,
      book: c.book,
      sheet: sheetText(c.sheetStart, c.sheetEnd),
      reminder: rule.config.reminder ?? null,
      values: { protocolValue: c.protocolValue, translatorFee: c.translatorFee, pageCharge: c.pageCharge, free: c.free, pages: c.pages },
    };
  }

  /** Avisos aos Supervisores depois de emitir: limite, estoque e folhas acabando, número marcado, lembrete do tradutor. */
  async function alertsAfterIssue(
    db: Db,
    rule: Awaited<ReturnType<typeof loadRule>>,
    job: { id: string; team_id: string | null; document_name: string; assignee_id: string | null; submitted_by: string | null },
    c: CheckResult['computed'],
  ) {
    const people = await managers(db);
    const alert = rule.config.alertRemaining ?? null;
    const send = (kind: string, title: string, body: string) =>
      notify(db, { teamId: job.team_id, users: people }, { kind, title, body, translationId: job.id });
    const issued = (
      await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM numbering_entries WHERE translator_id = $1 AND status = 'issued'`, [
        rule.id,
      ])
    ).rows[0]!.n;
    const remaining = remainingByLimit(rule.config, issued);
    if (remaining !== null && (remaining === 0 || (alert !== null && remaining === alert)))
      await send(
        'numbering_low',
        `${rule.name}: ${remaining === 0 ? 'limite atingido' : `restam ${remaining} números`}`,
        `Limite de ${rule.config.limit} números definido pelo Supervisor.`,
      );
    if (c.stockId) {
      const stock = (
        await db.query<{ language: string; free: boolean; notify_on_use: boolean; number: string; left: number }>(
          `SELECT s.language, s.free, s.notify_on_use, s.number,
                  (SELECT coalesce(sum(greatest(o.max_uses - (SELECT count(*) FROM numbering_entries e WHERE e.stock_id = o.id AND e.status <> 'void'), 0)), 0)::int
                     FROM numbering_stock o WHERE o.translator_id = s.translator_id AND o.language = s.language AND o.free = s.free AND o.status = 'available') AS left
             FROM numbering_stock s WHERE s.id = $1`,
          [c.stockId],
        )
      ).rows[0]!;
      const lot = `${stock.free ? 'lote gratuito' : 'lote'}${stock.language ? ` (${stock.language})` : ''}`;
      if (stock.left === 0 || (alert !== null && stock.left === alert))
        await send(
          'numbering_low',
          `${rule.name}: ${stock.left === 0 ? `${lot} esgotado` : `restam ${stock.left} usos no ${lot}`}`,
          'Envie uma nova planilha de números em Tradutores.',
        );
      if (stock.notify_on_use)
        await send('numbering_used', `${rule.name}: nº ${stock.number} foi usado`, `Tradução: ${job.document_name}.`);
    }
    if (c.bookId && rule.config.sheetLimit) {
      const book = (
        await db.query<{ book: string; next_sheet: number; queued: number }>(
          `SELECT b.book, b.next_sheet, (SELECT count(*)::int FROM numbering_books q WHERE q.translator_id = b.translator_id AND q.status = 'queued') AS queued
             FROM numbering_books b WHERE b.id = $1`,
          [c.bookId],
        )
      ).rows[0]!;
      const left = Math.max(0, rule.config.sheetLimit - book.next_sheet + 1);
      if (book.queued === 0 && (left === 0 || (alert !== null && left <= alert)))
        await send(
          'numbering_low',
          `${rule.name}: livro ${book.book} ${left === 0 ? 'chegou ao limite' : `com ${left} folhas restantes`}`,
          'Cadastre o próximo livro e o número inicial: sem ele, a numeração deste tradutor trava.',
        );
    }
    if (rule.config.reminder)
      await notify(
        db,
        { teamId: job.team_id, users: [job.assignee_id, job.submitted_by] },
        {
          kind: 'numbering_reminder',
          title: `Lembrete (${rule.name}): ${job.document_name}`,
          body: rule.config.reminder,
          translationId: job.id,
        },
      );
  }

  // ---------- Painel do Supervisor ----------

  async function dashboard(ctx: AuthenticatedContext) {
    if (!canAuthorize(ctx.actor)) throw forbidden();
    const translators = await pool.query<RuleRow & { issued: number; drafts: number; anomalies: number; last30: number; paid: string }>(
      `SELECT s.id, s.name, s.active, s.numbering_scheme, s.numbering_config,
              (SELECT count(*)::int FROM numbering_entries e WHERE e.translator_id = s.id AND e.status = 'issued') AS issued,
              (SELECT count(*)::int FROM numbering_entries e WHERE e.translator_id = s.id AND e.status = 'draft') AS drafts,
              (SELECT count(*)::int FROM numbering_entries e WHERE e.translator_id = s.id AND e.status = 'draft'
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.anomalies) a WHERE a->>'severity' = 'error')) AS anomalies,
              (SELECT count(*)::int FROM numbering_entries e WHERE e.translator_id = s.id AND e.status = 'issued' AND e.issued_at > now() - interval '30 days') AS last30,
              (SELECT coalesce(sum(e.translator_fee), 0) FROM numbering_entries e WHERE e.translator_id = s.id AND e.status = 'issued'
                 AND ((s.numbering_config->>'subscriptionSince') IS NULL OR e.issued_at >= (s.numbering_config->>'subscriptionSince')::date)) AS paid
         FROM sworn_translators s ORDER BY s.active DESC, s.name`,
    );
    const stock = await pool.query<{
      translator_id: string;
      language: string;
      free: boolean;
      numbers: number;
      uses: number;
      capacity: number;
      available: number;
      reserved: number;
      blocked: number;
    }>(
      `SELECT s.translator_id, s.language, s.free, count(*)::int AS numbers,
              sum(u.uses)::int AS uses, sum(s.max_uses)::int AS capacity,
              sum(CASE WHEN s.status = 'available' THEN greatest(s.max_uses - u.uses, 0) ELSE 0 END)::int AS available,
              count(*) FILTER (WHERE s.status = 'reserved')::int AS reserved, count(*) FILTER (WHERE s.status = 'blocked')::int AS blocked
         FROM numbering_stock s,
              LATERAL (SELECT count(*)::int AS uses FROM numbering_entries e WHERE e.stock_id = s.id AND e.status <> 'void') u
        GROUP BY s.translator_id, s.language, s.free ORDER BY s.language, s.free`,
    );
    const books = await pool.query<{ translator_id: string; book: string; next_number: number; next_sheet: number; status: string }>(
      `SELECT translator_id, book, next_number, next_sheet, status FROM numbering_books WHERE status IN ('current', 'queued') ORDER BY position`,
    );
    return {
      items: translators.rows.map((row) => {
        const config = NumberingConfig.parse(row.numbering_config ?? {});
        const lots = stock.rows.filter((lot) => lot.translator_id === row.id);
        const current = books.rows.find((book) => book.translator_id === row.id && book.status === 'current');
        const queued = books.rows.filter((book) => book.translator_id === row.id && book.status === 'queued');
        const sheetsLeft = current && config.sheetLimit ? Math.max(0, config.sheetLimit - current.next_sheet + 1) : null;
        const remaining = remainingByLimit(config, row.issued);
        const capacityLeft = lots.reduce((sum, lot) => sum + lot.available, 0);
        const locked =
          row.numbering_scheme === 'book_sheet'
            ? !queued.length && (!current || sheetsLeft === 0)
            : remaining === 0 || ((row.numbering_scheme === 'stock' || row.numbering_scheme === 'reusable_stock') && capacityLeft === 0);
        const left = [remaining, row.numbering_scheme === 'book_sheet' ? sheetsLeft : lots.length ? capacityLeft : null].filter(
          (value): value is number => value !== null,
        );
        return {
          id: row.id,
          name: row.name,
          active: row.active,
          scheme: row.numbering_scheme,
          schemeLabel: schemeLabel[row.numbering_scheme],
          limit: config.limit ?? null,
          issued: row.issued,
          remaining,
          drafts: row.drafts,
          anomalies: row.anomalies,
          last30: row.last30,
          alertRemaining: config.alertRemaining ?? null,
          /** Algo acabando: abaixo do aviso definido pelo Supervisor. */
          low: config.alertRemaining ? left.some((value) => value <= config.alertRemaining!) : false,
          locked,
          lots: lots.map((lot) => ({
            language: lot.language || null,
            free: lot.free,
            numbers: lot.numbers,
            uses: lot.uses,
            capacity: lot.capacity,
            available: lot.available,
            reserved: lot.reserved,
            blocked: lot.blocked,
          })),
          book: current
            ? {
                book: current.book,
                nextNumber: current.next_number,
                nextSheet: current.next_sheet,
                sheetsLeft,
                sheetLimit: config.sheetLimit ?? null,
              }
            : null,
          queuedBooks: queued.map((book) => ({ book: book.book, nextNumber: book.next_number })),
          subscription:
            row.numbering_scheme === 'prefixed' && config.subscriptionCap
              ? { paid: Number(row.paid), cap: config.subscriptionCap, free: Number(row.paid) >= config.subscriptionCap }
              : null,
        };
      }),
    };
  }

  return {
    getRule,
    setRule,
    importStock,
    listStock,
    updateStock,
    deleteStock,
    listBooks,
    addBook,
    removeBook,
    getEntry,
    saveEntry,
    authorizeZeroProtocol,
    openErrors,
    issue,
    dashboard,
  };
}

export type TranslatorNumberingService = ReturnType<typeof createTranslatorNumberingService>;
