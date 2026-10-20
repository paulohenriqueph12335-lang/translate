import { z } from 'zod';

/**
 * Regras de numeração por tradutor juramentado (ADR-014). Funções puras: a conferência recebe o estado já lido do banco
 * (estoque, emitidos, livro atual) e devolve os problemas e os valores calculados.
 */

export const SCHEMES = ['free_text', 'prefixed', 'book_sheet', 'stock', 'reusable_stock'] as const;
export type Scheme = (typeof SCHEMES)[number];

export const schemeLabel: Record<Scheme, string> = {
  free_text: 'Livre (digitado, sem repetir)',
  prefixed: 'Sigla + ano + número (ex.: NB-2026-1111), com valores de protocolo e assinatura',
  book_sheet: 'Número, livro e folha automáticos, com limite de folhas por livro',
  stock: 'Números da planilha (uso único)',
  reusable_stock: 'Números da planilha por idioma, até 2 usos em protocolos diferentes',
};

const money = z.number().min(0).max(1_000_000);
const optionalInt = (max: number) => z.number().int().min(1).max(max).nullable().optional();

/** Parâmetros da regra; os que não se aplicam ao esquema são ignorados. */
export const NumberingConfig = z.strictObject({
  /** Máximo de números emitidos para o tradutor (ninguém passa disso); nulo = sem limite. */
  limit: optionalInt(10_000_000),
  /** Avisar os Supervisores quando restarem este número ou menos (limite, estoque ou folhas do livro). */
  alertRemaining: optionalInt(1_000_000),
  /** prefixed: sigla do número ("NB" → NB-2026-1111). */
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{1,10}$/, 'Sigla de 1 a 10 letras')
    .nullable()
    .optional(),
  /** prefixed: valores padrão. */
  protocolValue: money.nullable().optional(),
  translatorFee: money.nullable().optional(),
  /** prefixed: total de assinaturas pagas a partir do qual a assinatura passa a ser gratuita (ex.: 4000). */
  subscriptionCap: money.nullable().optional(),
  /** prefixed: data (AAAA-MM-DD) desde quando a assinatura é somada. */
  subscriptionSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  /** book_sheet: folhas por livro (ex.: 400, 500). */
  sheetLimit: optionalInt(100_000),
  /** Pede o número de páginas (laudas) de cada documento. */
  recordPages: z.boolean().optional(),
  /** reusable_stock: usos de cada número (padrão 2). */
  maxUses: z.number().int().min(1).max(10).optional(),
  /** reusable_stock: idiomas do tradutor (ex.: Francês, Italiano). */
  languages: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  /** Pede se a tradução é digital ou impressa. */
  requiresMedium: z.boolean().optional(),
  /** Lembrete mostrado e notificado na conclusão (ex.: enviar por e-mail para a equipe responsável). */
  reminder: z.string().trim().max(500).nullable().optional(),
  /** Páginas gratuitas e preço por página extra (ex.: 3 e R$ 2,00). */
  freePages: z.number().int().min(0).max(10_000).nullable().optional(),
  pricePerExtraPage: money.nullable().optional(),
});
export type NumberingConfig = z.infer<typeof NumberingConfig>;

/** Regras prontas dos tradutores da organização, para o Supervisor partir de uma delas. */
export const PRESETS: Record<string, { scheme: Scheme; config: NumberingConfig; description: string }> = {
  walter: {
    scheme: 'prefixed',
    config: { prefix: 'NB', subscriptionCap: 4000, limit: null },
    description: 'Sigla + número, valor do protocolo e da assinatura; assinatura gratuita após R$ 4.000,00.',
  },
  patricia: {
    scheme: 'book_sheet',
    config: { sheetLimit: 400, recordPages: true },
    description: 'Número, livro e folha; troca de livro ao chegar a 400 folhas.',
  },
  jeferson: {
    scheme: 'book_sheet',
    config: { sheetLimit: 500, recordPages: true },
    description: 'Número, livro e folha; troca de livro ao chegar a 500 folhas; laudas por documento.',
  },
  carla: {
    scheme: 'reusable_stock',
    config: { maxUses: 2, languages: ['Francês', 'Italiano'] },
    description: 'Lotes por idioma (pagos e gratuitos); cada número até 2 vezes, em protocolos diferentes.',
  },
  bruno: {
    scheme: 'stock',
    config: { reminder: 'Enviar a tradução e os documentos por e-mail para a equipe responsável.' },
    description: 'Livro e número da tradução; lembrete de envio por e-mail.',
  },
  antonio: { scheme: 'stock', config: { requiresMedium: true }, description: 'Número, livro e se é digital ou impresso.' },
  vivian: {
    scheme: 'stock',
    config: { recordPages: true, freePages: 3, pricePerExtraPage: 2 },
    description: 'Livro (G-2026) e número (G-2026-15555); até 3 páginas grátis, R$ 2,00 por página extra.',
  },
};

export interface EntryInput {
  number?: string | null;
  book?: string | null;
  pages?: number | null;
  protocol?: string | null;
  medium?: 'digital' | 'impresso' | null;
  language?: string | null;
  free?: boolean;
  protocolValue?: number | null;
  translatorFee?: number | null;
}

export type AnomalyCode =
  | 'missing'
  | 'pattern'
  | 'duplicate'
  | 'not_in_stock'
  | 'blocked'
  | 'reserved'
  | 'uses_exhausted'
  | 'same_protocol'
  | 'free_mismatch'
  | 'limit_reached'
  | 'book_locked'
  | 'out_of_sequence'
  | 'zero_protocol';

export interface Anomaly {
  code: AnomalyCode;
  severity: 'error' | 'warning';
  message: string;
}

/** Linha do estoque com o uso atual (outras traduções, sem contar esta). */
export interface StockState {
  id: string;
  number: string;
  book: string | null;
  free: boolean;
  status: 'available' | 'reserved' | 'blocked';
  reservedFor: string | null;
  maxUses: number;
  uses: number;
  usedInSameProtocol: boolean;
}

/** Livro com limite de folhas que receberá esta tradução (o atual ou, se esgotado, o próximo da fila). */
export interface BookState {
  id: string;
  book: string;
  nextNumber: number;
  nextSheet: number;
  /** `true` quando o atual esgotou e este é o próximo da fila. */
  advanced: boolean;
}

export interface CheckState {
  actorId: string;
  /** Quem cuida dos tradutores (Supervisor) e o Diretor podem usar números reservados e autorizar protocolo zerado. */
  actorIsManager: boolean;
  /** Números já emitidos para o tradutor (para o limite). */
  issued: number;
  /** O tradutor tem estoque cadastrado (para o esquema livre e com sigla, o estoque é opcional). */
  hasStock: boolean;
  /** Linha do estoque com o número e o idioma informados, se existir. */
  stock: StockState | null;
  /** Outras traduções (rascunho ou emitidas) com o mesmo número, nos esquemas de número único. */
  duplicates: number;
  /** Livro que receberá a tradução, no esquema de livro e folha; nulo = não há livro disponível. */
  book: BookState | null;
  /** Soma das assinaturas pagas desde `subscriptionSince` (Walter). */
  subscriptionPaid: number;
  /** Protocolo zerado já autorizado por Supervisor ou Diretor. */
  zeroProtocolAuthorized: boolean;
}

export interface CheckResult {
  anomalies: Anomaly[];
  /** Valores finais (calculados ou confirmados) que serão emitidos. */
  computed: {
    number: string | null;
    book: string | null;
    sheetStart: number | null;
    sheetEnd: number | null;
    pages: number | null;
    free: boolean;
    protocolValue: number | null;
    translatorFee: number | null;
    pageCharge: number | null;
    stockId: string | null;
    bookId: string | null;
  };
}

const clean = (value: string | null | undefined) => (value ?? '').trim();

/** Formato "SIGLA-AAAA-número" do esquema com sigla. */
export const prefixedPattern = (prefix: string) => new RegExp(`^${prefix.toUpperCase()}-\\d{4}-\\d{1,9}$`);

/** Cobrança das páginas acima das gratuitas. */
export const pageCharge = (pages: number, freePages: number, price: number) => Math.max(0, pages - freePages) * price;

/** Quantos números ainda podem ser emitidos pelo limite do Supervisor (nulo = sem limite). */
export const remainingByLimit = (config: NumberingConfig, issued: number) => (config.limit ? Math.max(0, config.limit - issued) : null);

/**
 * Confere a numeração preenchida contra a regra do tradutor. Erros impedem marcar como pronta e concluir; avisos só
 * informam. Nada aqui grava: a emissão acontece na conclusão, sob bloqueio do tradutor.
 */
export function checkEntry(scheme: Scheme, config: NumberingConfig, input: EntryInput, state: CheckState): CheckResult {
  const anomalies: Anomaly[] = [];
  const error = (code: AnomalyCode, message: string) => anomalies.push({ code, severity: 'error', message });
  const warning = (code: AnomalyCode, message: string) => anomalies.push({ code, severity: 'warning', message });
  const number = clean(input.number);
  const book = clean(input.book);
  const protocol = clean(input.protocol);
  const pages = input.pages ?? null;
  const computed: CheckResult['computed'] = {
    number: number || null,
    book: book || null,
    sheetStart: null,
    sheetEnd: null,
    pages,
    free: input.free === true,
    protocolValue: null,
    translatorFee: null,
    pageCharge: null,
    stockId: null,
    bookId: null,
  };

  // Limite do Supervisor (o esquema com sigla não tem limite, como o do Walter, salvo se ele definir um).
  const remaining = remainingByLimit(config, state.issued);
  if (remaining === 0) error('limit_reached', `Limite de ${config.limit} números deste tradutor atingido; peça ao Supervisor para ampliar`);

  if ((config.recordPages || scheme === 'book_sheet') && !pages) error('missing', 'Informe o número de páginas (laudas) do documento');
  if (config.requiresMedium && !input.medium) error('missing', 'Marque se a tradução é digital ou impressa');

  if (scheme === 'book_sheet') {
    if (!state.book) {
      error(
        'book_locked',
        'O livro chegou ao limite de folhas e não há próximo livro cadastrado: numeração travada até o Supervisor cadastrar',
      );
    } else {
      computed.number = String(state.book.nextNumber);
      computed.book = state.book.book;
      computed.bookId = state.book.id;
      computed.sheetStart = state.book.nextSheet;
      computed.sheetEnd = pages ? state.book.nextSheet + pages - 1 : null;
      if (number && number !== computed.number)
        error('out_of_sequence', `Número fora da sequência: o próximo deste tradutor é ${computed.number}`);
      if (book && book !== computed.book) error('out_of_sequence', `Livro fora da sequência: o atual é ${computed.book}`);
      if (state.book.advanced) warning('book_locked', `O livro anterior chegou ao limite: esta tradução abre o livro ${state.book.book}`);
      else if (config.sheetLimit && computed.sheetEnd && computed.sheetEnd > config.sheetLimit)
        warning('book_locked', `O documento passa da folha ${config.sheetLimit}; o próximo já sai no livro seguinte`);
    }
    return { anomalies, computed };
  }

  if (!number) {
    error('missing', 'Informe o número');
    return { anomalies, computed };
  }

  if (scheme === 'prefixed' && config.prefix && !prefixedPattern(config.prefix).test(number))
    error('pattern', `Número fora do formato ${config.prefix.toUpperCase()}-AAAA-número (ex.: ${config.prefix.toUpperCase()}-2026-1111)`);

  const usesStock = scheme === 'stock' || scheme === 'reusable_stock' || state.hasStock;
  if (usesStock) {
    const stock = state.stock;
    if (!stock) error('not_in_stock', `O nº ${number} não está na planilha deste tradutor${input.language ? ` (${input.language})` : ''}`);
    else {
      computed.stockId = stock.id;
      computed.book = computed.book ?? stock.book;
      if (stock.book && book && book !== stock.book) error('out_of_sequence', `O nº ${number} é do livro ${stock.book}`);
      if (stock.status === 'blocked') error('blocked', `O nº ${number} está bloqueado pelo Supervisor`);
      if (stock.status === 'reserved' && stock.reservedFor !== state.actorId && !state.actorIsManager)
        error('reserved', `O nº ${number} está reservado para outra pessoa`);
      if (stock.uses >= stock.maxUses)
        error('uses_exhausted', stock.maxUses > 1 ? `O nº ${number} já foi usado ${stock.maxUses} vezes` : `O nº ${number} já foi usado`);
      if (scheme === 'reusable_stock') {
        if (!protocol) error('missing', 'Informe o protocolo: o mesmo número não pode se repetir no mesmo protocolo');
        else if (stock.usedInSameProtocol) error('same_protocol', `O nº ${number} já foi usado no protocolo ${protocol}`);
        if (input.free === true && !stock.free) error('free_mismatch', `O nº ${number} não é do lote gratuito`);
        computed.free = stock.free;
      }
    }
  } else if (state.duplicates > 0) error('duplicate', `O nº ${number} já foi usado por este tradutor`);

  if (scheme === 'prefixed') {
    const protocolValue = input.protocolValue ?? config.protocolValue ?? null;
    if (protocolValue === null) error('missing', 'Informe o valor do protocolo');
    else if (protocolValue === 0 && !state.zeroProtocolAuthorized && !state.actorIsManager)
      error('zero_protocol', 'Protocolo zerado só com autorização do Supervisor ou do Diretor');
    computed.protocolValue = protocolValue;
    // Assinatura: gratuita por escolha (antes do teto) ou automaticamente quando o total pago chega ao teto.
    const capReached = !!config.subscriptionCap && state.subscriptionPaid >= config.subscriptionCap;
    const free = input.free === true || capReached;
    computed.free = free;
    computed.translatorFee = free ? 0 : (input.translatorFee ?? config.translatorFee ?? null);
    if (!free && computed.translatorFee === null) error('missing', 'Informe o valor da assinatura (ou marque como gratuita)');
    if (capReached && input.free !== true)
      warning('free_mismatch', `Assinatura gratuita: o total pago chegou a R$ ${config.subscriptionCap!.toFixed(2)}`);
  }

  if (pages && config.freePages !== null && config.freePages !== undefined && config.pricePerExtraPage)
    computed.pageCharge = pageCharge(pages, config.freePages, config.pricePerExtraPage);

  return { anomalies, computed };
}

export interface StockRow {
  number: string;
  book: string | null;
  language: string;
  free: boolean;
}

const HEADER_ALIASES: Record<string, keyof StockRow> = {
  numero: 'number',
  número: 'number',
  number: 'number',
  nº: 'number',
  n: 'number',
  traducao: 'number',
  tradução: 'number',
  livro: 'book',
  book: 'book',
  idioma: 'language',
  language: 'language',
  lingua: 'language',
  língua: 'language',
  gratuito: 'free',
  free: 'free',
  tipo: 'free',
};

const truthy = (value: string) => /^(s|sim|y|yes|1|true|x|gratuito|gratis|grátis|free)$/i.test(value.trim());

/**
 * Lê a planilha de números (CSV do Excel: separador ";" ou ",", com ou sem cabeçalho, com BOM). Colunas reconhecidas:
 * número, livro, idioma e gratuito (sim/não). Sem cabeçalho, a 1ª coluna é o número e a 2ª, o livro. Valores padrão
 * de idioma e de lote gratuito valem para as linhas que não informarem.
 */
export function parseStockCsv(text: string, defaults: { language?: string; free?: boolean } = {}) {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const separator = (lines[0] ?? '').split(';').length >= (lines[0] ?? '').split(',').length ? ';' : ',';
  const split = (line: string) =>
    line.split(separator).map((cell) =>
      cell
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .trim(),
    );
  const first = split(lines[0] ?? '');
  const headers = first.map((cell) => HEADER_ALIASES[cell.toLowerCase().replace(/\s+/g, '')]);
  const hasHeader = headers.some(Boolean);
  const columns: Array<keyof StockRow | undefined> = hasHeader ? headers : ['number', 'book'];
  const rows: StockRow[] = [];
  const problems: Array<{ line: number; message: string }> = [];
  const seen = new Set<string>();
  lines.slice(hasHeader ? 1 : 0).forEach((line, index) => {
    const lineNumber = index + (hasHeader ? 2 : 1);
    const cells = split(line);
    const value = (key: keyof StockRow) => {
      const position = columns.indexOf(key);
      return position >= 0 ? (cells[position] ?? '') : '';
    };
    const number = value('number');
    if (!number) return problems.push({ line: lineNumber, message: 'Linha sem número' });
    if (number.length > 40) return problems.push({ line: lineNumber, message: `Número longo demais: ${number.slice(0, 20)}…` });
    const language = value('language') || defaults.language || '';
    const key = `${language.toLowerCase()}|${number}`;
    if (seen.has(key)) return problems.push({ line: lineNumber, message: `Número repetido na planilha: ${number}` });
    seen.add(key);
    const freeCell = value('free');
    rows.push({ number, book: value('book') || null, language, free: freeCell ? truthy(freeCell) : defaults.free === true });
    return undefined;
  });
  return { rows, problems, read: lines.length - (hasHeader ? 1 : 0) };
}
