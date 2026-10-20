import { z } from 'zod';

/**
 * Rascunho estruturado de uma tradução juramentada (ADR-007).
 *
 * Lista plana de blocos, sem recursão.
 * A moldura juramentada (cabeçalho do tradutor, abertura, encerramento, assinatura e rodapé) não fica aqui:
 * é gerada pelo modelo do idioma de destino.
 */
export const LANGUAGES = ['pt', 'en', 'fr', 'it', 'es'] as const;
export const Language = z.enum(LANGUAGES);
export type Language = z.infer<typeof Language>;

/** Origem do conteúdo de um bloco, para o revisor saber o que conferir com mais cuidado. */
/** `machine`: provedor de tradução automática (ADR-008); `memory`: trecho já aprovado reaproveitado. */
export const BlockOrigin = z.enum(['rules', 'claude', 'human', 'machine', 'memory']);
export type BlockOrigin = z.infer<typeof BlockOrigin>;

const Align = z.enum(['left', 'center', 'right', 'justify']);

const common = {
  /** Trecho correspondente no original, quando conhecido (revisão lado a lado). */
  sourceText: z.string().nullable(),
  origin: BlockOrigin,
};

/**
 * Ênfase: trechos entre `**` saem em negrito (ex.: "certifies that **MARIANA ALVES TEIXEIRA** completed").
 * Usar só onde o original destaca o trecho.
 */
export const EMPHASIS_HELP = 'Text between ** is rendered in bold.';

export const HeadingBlock = z.object({
  kind: z.literal('heading'),
  text: z.string(),
  align: Align,
  /** `title` para o título principal do documento (ex.: "SCHOOL TRANSCRIPT"). */
  level: z.enum(['title', 'normal']),
  ...common,
});

export const ParagraphBlock = z.object({
  kind: z.literal('paragraph'),
  text: z.string(),
  align: Align,
  bold: z.boolean(),
  /** `small` para endereços e linhas de apoio; `tiny` para notas de rodapé de tabelas. */
  size: z.enum(['normal', 'small', 'tiny']),
  ...common,
});

/** Descrição de elemento não textual ou observação do tradutor; renderizada como "[Translator's note: …]". */
export const NoteBlock = z.object({
  kind: z.literal('translator_note'),
  text: z.string(),
  ...common,
});

/** Assinatura do original; renderizada como "[Illegible signature]" seguida de nome e cargo. */
export const SignatureBlock = z.object({
  kind: z.literal('signature'),
  /** `true` quando a assinatura é ilegível (o caso comum). */
  illegible: z.boolean(),
  name: z.string(),
  role: z.string(),
  ...common,
});

export const TableCell = z.object({
  text: z.string(),
  /** Texto original da célula, quando conhecido; alimenta a memória de tradução na aprovação. */
  sourceText: z.string().nullable().optional(),
  /** Quantas colunas a célula ocupa (1 = normal). */
  colSpan: z.number().int(),
  /** Quantas linhas a célula ocupa a partir desta (1 = normal). Células cobertas por mesclagem não aparecem nas linhas seguintes. */
  rowSpan: z.number().int(),
  bold: z.boolean(),
  align: Align,
});
export type TableCell = z.infer<typeof TableCell>;

export const TableRow = z.object({
  /** `header` usa o fundo de cabeçalho; `summary`, o fundo de totais. */
  style: z.enum(['normal', 'header', 'summary']),
  cells: z.array(TableCell),
});
export type TableRow = z.infer<typeof TableRow>;

export const TableBlock = z.object({
  kind: z.literal('table'),
  /** Larguras relativas das colunas da grade (somam qualquer valor; são normalizadas na renderização). */
  columns: z.array(z.number()),
  rows: z.array(TableRow),
  ...common,
});

export const SectionBlock = z.object({
  kind: z.literal('section'),
  /** Título de seção dentro do documento traduzido (ex.: "STUDIES COMPLETED"). */
  text: z.string(),
  ...common,
});

export const DraftBlock = z.discriminatedUnion('kind', [HeadingBlock, ParagraphBlock, NoteBlock, SignatureBlock, TableBlock, SectionBlock]);
export type DraftBlock = z.infer<typeof DraftBlock>;

export const Draft = z.object({
  sourceLanguage: Language,
  targetLanguage: Language,
  /** Tipo do documento no idioma de destino, para a linha "DOCUMENT TYPE: …" (ex.: "SCHOOL TRANSCRIPT"). */
  documentType: z.string(),
  /** Título do original no idioma de origem (ex.: "HISTÓRICO ESCOLAR"); identifica exemplos aprovados do mesmo tipo. */
  sourceTitle: z.string(),
  blocks: z.array(DraftBlock),
});
export type Draft = z.infer<typeof Draft>;

/** Validação estrutural que o schema não garante (spans, larguras). */
export function structuralProblems(draft: Draft): string[] {
  const problems: string[] = [];
  if (draft.sourceLanguage === draft.targetLanguage) problems.push('Idiomas de origem e destino iguais');
  draft.blocks.forEach((block, index) => {
    if (block.kind !== 'table') return;
    const width = block.columns.length;
    if (width === 0) problems.push(`Tabela ${index + 1} sem colunas`);
    // `carried[col]` = quantas linhas abaixo a coluna ainda está coberta por uma mesclagem vertical.
    let carried = new Array<number>(width).fill(0);
    block.rows.forEach((row, rowIndex) => {
      const occupied = carried.map((rows) => rows > 0);
      let used = occupied.filter(Boolean).length;
      for (const cell of row.cells) {
        if (cell.colSpan < 1 || cell.rowSpan < 1) problems.push(`Tabela ${index + 1}, linha ${rowIndex + 1}: mesclagem inválida`);
        used += cell.colSpan;
      }
      if (used !== width) problems.push(`Tabela ${index + 1}, linha ${rowIndex + 1}: ocupa ${used} de ${width} colunas`);
      const next = carried.map((rows) => (rows > 0 ? rows - 1 : 0));
      let col = 0;
      for (const cell of row.cells) {
        while (col < width && occupied[col]) col += 1;
        for (let span = 0; span < cell.colSpan && col < width; span += 1, col += 1) next[col] = Math.max(0, cell.rowSpan - 1);
      }
      carried = next;
    });
    if (carried.some((rows) => rows > 0)) problems.push(`Tabela ${index + 1}: mesclagem vertical passa da última linha`);
  });
  return problems;
}
