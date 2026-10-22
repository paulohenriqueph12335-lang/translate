import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from 'docx';
import { stripEmphasis } from './checks.js';
import { columnOf } from './codes.js';
import type { Draft, DraftBlock } from './draft.js';
import { longDate } from './conventions.js';
import { swornFrame, type TranslationNumbering, type TranslatorProfile } from './sworn-template.js';

/** Medidas e estilo do modelo de tradução juramentada (A4; margens de 2 cm, 2,5 cm no topo), em twips e meio-pontos. */
const PAGE = { width: 11906, height: 16838, top: 1418, right: 1134, bottom: 1134, left: 1134, header: 567, footer: 567 };
const CONTENT_WIDTH = PAGE.width - PAGE.left - PAGE.right;
/** Fonte e tamanhos (meio-ponto) em uso; definidos pela regra da modalidade no início de cada geração (ADR-015). */
let FONT = 'Times New Roman';
let SIZE = { large: 24, body: 22, small: 20, tiny: 18, letterhead: 16 };

/**
 * Aplica a fonte e o tamanho da regra enquanto o documento é montado. As skills pedem a mesma fonte e o mesmo tamanho
 * em todo o documento: títulos, linhas de apoio e tabelas saem no corpo da regra (só tabelas densas, com palavras que
 * não cabem na coluna, ainda diminuem). O rodapé com o número da página fica um pouco menor.
 */
function withLook<T>(look: { font: string; fontSize: number } | undefined, build: () => T): T {
  const saved = { font: FONT, size: SIZE };
  if (look) {
    const body = Math.round(look.fontSize * 2);
    FONT = look.font;
    SIZE = { large: body, body, small: body, tiny: body, letterhead: Math.max(12, body - 4) };
  }
  try {
    return build();
  } finally {
    FONT = saved.font;
    SIZE = saved.size;
  }
}
const LINE = 264; // 1,1 linha
const SHADES = { header: 'DFE6F1', summary: 'F1F4F9' } as const;
const GRID = { style: BorderStyle.SINGLE, size: 4, color: '555555' };
const WARNING_RED = 'C00000';

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

interface TextStyle {
  align?: keyof typeof ALIGN;
  bold?: boolean;
  italics?: boolean;
  size?: number;
  color?: string;
  after?: number;
  /** Fica na mesma página do parágrafo seguinte (títulos, seções, assinatura). */
  keepNext?: boolean;
}

/** Converte "texto **negrito** texto" em runs; o negrito do parágrafo inteiro prevalece. */
function runs(text: string, style: TextStyle) {
  return text.split(/(\*\*[^*]+\*\*)/g).flatMap((part) => {
    if (!part) return [];
    const emphasized = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    return [
      new TextRun({
        text: emphasized ? part.slice(2, -2) : part,
        // Só liga o que está ligado, como o modelo: "desligado" explícito no XML atrapalha estilos herdados.
        ...(style.bold || emphasized ? { bold: true } : {}),
        ...(style.italics ? { italics: true } : {}),
        size: style.size ?? SIZE.body,
        font: FONT,
        ...(style.color ? { color: style.color } : {}),
      }),
    ];
  });
}

const paragraph = (text: string, style: TextStyle = {}, extra: Record<string, never> = {}) =>
  new Paragraph({
    alignment: ALIGN[style.align ?? 'left'],
    spacing: { before: 0, after: style.after ?? 120, line: LINE },
    ...(style.keepNext ? { keepNext: true } : {}),
    children: runs(text, style),
    ...extra,
  });

export interface RenderOptions {
  profile: TranslatorProfile;
  /** Data do encerramento ("IN WITNESS WHEREOF … on …"). */
  issuedAt: Date;
  /** `null` gera prévia de rascunho, marcada como não aprovada. */
  numbering: TranslationNumbering | null;
  /** Modelo de máscara: marcadores no lugar de número, livro, folha e data, sem marca de rascunho. */
  placeholders?: boolean;
  /** Fonte e corpo da regra da modalidade (ADR-015); sem regra, Times New Roman 11. */
  look?: { font: string; fontSize: number };
}

/** Gera o DOCX da tradução juramentada a partir do rascunho e da moldura do idioma de destino. */
export async function renderSwornDocx(draft: Draft, options: RenderOptions): Promise<Buffer> {
  return Packer.toBuffer(withLook(options.look, () => buildSworn(draft, options)));
}

function buildSworn(draft: Draft, options: RenderOptions) {
  const frame = swornFrame(
    options.profile,
    draft.sourceLanguage,
    draft.targetLanguage,
    options.issuedAt,
    options.numbering,
    options.placeholders ?? false,
  );
  const isDraft = options.numbering === null && !options.placeholders;

  const [name, title, ...notes] = frame.header;
  const headerSpecs: Array<[string, TextStyle]> = [
    [name!.text, { align: 'center', bold: true, size: SIZE.small, after: 0 }],
    [title!.text, { align: 'center', size: SIZE.letterhead, after: 0 }],
    ...notes.map((line): [string, TextStyle] => [
      line.text,
      { align: 'center', bold: true, size: SIZE.letterhead, color: WARNING_RED, after: 0 },
    ]),
    ...(isDraft
      ? [[frame.draftMark, { align: 'center', bold: true, size: SIZE.small, color: WARNING_RED, after: 0 }] as [string, TextStyle]]
      : []),
  ];
  // Sem borda de parágrafo (regra das skills, ADR-015): o timbre se separa do corpo só pelo espaçamento.
  const headerLines = headerSpecs.map(([text, style], index) =>
    paragraph(text, index === headerSpecs.length - 1 ? { ...style, after: 160 } : style),
  );

  const footer = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: frame.footer.prefix, size: SIZE.letterhead, font: FONT }),
      new TextRun({ children: [PageNumber.CURRENT], size: SIZE.letterhead, font: FONT }),
      new TextRun({ text: frame.footer.between, size: SIZE.letterhead, font: FONT }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: SIZE.letterhead, font: FONT }),
    ],
  });

  const [signatureRule, signatureName, signatureTitle, signatureRegistration] = frame.signature;
  const body: Array<Paragraph | Table> = [
    paragraph(frame.titles[0]!, { align: 'center', bold: true, size: SIZE.large, after: 0 }),
    paragraph(frame.titles[1]!, { align: 'center', bold: true, after: 240 }),
    paragraph(frame.opening, { align: 'justify', after: 240 }),
    paragraph(`**${frame.documentTypeLabel}:** ${draft.documentType}`, { after: 240 }),
    ...draft.blocks.flatMap((block) => renderBlock(block, frame)),
    paragraph(frame.closing, { align: 'justify', after: 240 }),
    ...(options.profile.feeNote ? [paragraph(options.profile.feeNote, { size: SIZE.small, after: 480 })] : []),
    paragraph(signatureRule!.text, { align: 'center', after: 0 }),
    paragraph(signatureName!.text, { align: 'center', bold: true, after: 0 }),
    paragraph(signatureTitle!.text, { align: 'center', size: SIZE.small, after: 0 }),
    paragraph(signatureRegistration!.text, { align: 'center', size: SIZE.small, after: 0 }),
  ];

  const document = new Document({
    creator: options.profile.name,
    title: `${frame.titles[0]} – ${draft.documentType}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE.body }, paragraph: { spacing: { after: 0, line: LINE } } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: { top: PAGE.top, right: PAGE.right, bottom: PAGE.bottom, left: PAGE.left, header: PAGE.header, footer: PAGE.footer },
          },
        },
        headers: { default: new Header({ children: headerLines }) },
        footers: { default: new Footer({ children: [footer] }) },
        children: body,
      },
    ],
  });
  return document;
}

export interface PlainRenderOptions {
  /** Fonte e corpo da regra da modalidade. */
  look: { font: string; fontSize: number };
  /** Rascunho: marca no cabeçalho, no idioma de destino. */
  draft: boolean;
  /** Certificada: declaração de fidelidade, data e assinatura do tradutor. */
  statement?: string | null;
  translatorName?: string | null;
  issuedAt: Date;
}

/**
 * Tradução certificada, técnica ou simples (ADR-015): o conteúdo no layout do original, sem a moldura da tradução
 * pública, sem bordas de parágrafo e sem notas acrescentadas. A certificada termina com a declaração do tradutor.
 */
export async function renderPlainDocx(draft: Draft, options: PlainRenderOptions): Promise<Buffer> {
  return Packer.toBuffer(
    withLook(options.look, () => {
      const frame = swornFrame(
        {
          name: options.translatorName ?? '',
          titlePt: '',
          languagePt: '',
          registration: '',
          registrationEn: '',
          registrationPt: '',
          city: '',
          statePt: '',
          stateEn: '',
          letterheadNote: null,
          feeNote: null,
        },
        draft.sourceLanguage,
        draft.targetLanguage,
        options.issuedAt,
        null,
      );
      const header = options.draft
        ? [paragraph(frame.draftMark, { align: 'center', bold: true, size: SIZE.small, color: WARNING_RED, after: 160 })]
        : [];
      const footer = new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: [PageNumber.CURRENT], size: SIZE.letterhead, font: FONT }),
          new TextRun({ text: ' / ', size: SIZE.letterhead, font: FONT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: SIZE.letterhead, font: FONT }),
        ],
      });
      const closing = options.statement
        ? [
            paragraph(options.statement, { align: 'justify', after: 240 }),
            paragraph(longDate(options.issuedAt, draft.targetLanguage), { after: 480 }),
            paragraph('______________________________________', { align: 'center', after: 0 }),
            ...(options.translatorName ? [paragraph(options.translatorName, { align: 'center', bold: true, after: 0 })] : []),
          ]
        : [];
      return new Document({
        title: draft.documentType || draft.sourceTitle || 'Tradução',
        styles: { default: { document: { run: { font: FONT, size: SIZE.body }, paragraph: { spacing: { after: 0, line: LINE } } } } },
        sections: [
          {
            properties: {
              page: {
                size: { width: PAGE.width, height: PAGE.height },
                margin: {
                  top: PAGE.top,
                  right: PAGE.right,
                  bottom: PAGE.bottom,
                  left: PAGE.left,
                  header: PAGE.header,
                  footer: PAGE.footer,
                },
              },
            },
            headers: { default: new Header({ children: header }) },
            footers: { default: new Footer({ children: [footer] }) },
            children: [...draft.blocks.flatMap((block) => renderBlock(block, frame)), ...closing],
          },
        ],
      });
    }),
  );
}

function renderBlock(block: DraftBlock, frame: ReturnType<typeof swornFrame>): Array<Paragraph | Table> {
  switch (block.kind) {
    case 'heading':
      return [
        paragraph(block.text, {
          align: block.align,
          bold: true,
          size: block.level === 'title' ? SIZE.large : SIZE.body,
          after: 0,
          keepNext: true,
        }),
      ];
    case 'paragraph':
      return [
        paragraph(block.text, {
          align: block.align,
          bold: block.bold,
          size: block.size === 'small' ? SIZE.small : block.size === 'tiny' ? SIZE.tiny : SIZE.body,
          after: block.align === 'center' ? 0 : 200,
        }),
      ];
    case 'section':
      return [paragraph(block.text, { bold: true, after: 60, keepNext: true })];
    case 'translator_note':
      return [paragraph(frame.translatorNote(block.text), { align: 'justify', italics: true })];
    case 'signature':
      return [
        paragraph(frame.signatureMark(block.illegible), { after: 0, keepNext: true }),
        paragraph([block.name, block.role].filter(Boolean).join(' – ')),
      ];
    case 'table':
      return [renderTable(block), paragraph('', { after: 120 })];
  }
}

/**
 * Tamanho da letra da tabela: o padrão (9 pt) ou menor, até 5 pt (como nas planilhas originais), para que a palavra mais longa de cada coluna caiba
 * sem ser partida no meio (planilhas técnicas com muitas colunas estreitas e códigos longos).
 */
function tableFontSize(block: Extract<DraftBlock, { kind: 'table' }>, widths: number[], margin: number) {
  const position = columnOf(block);
  let points = SIZE.tiny / 2;
  for (const row of block.rows)
    for (const cell of row.cells) {
      const column = position.get(cell);
      if (column === undefined) continue;
      const width = widths.slice(column, column + cell.colSpan).reduce((sum, value) => sum + value, 0) - 2 * margin;
      const longest = Math.max(
        0,
        ...stripEmphasis(cell.text)
          .split(/\s+/)
          .map((word) => word.length),
      );
      // Largura média de maiúsculas e dígitos em Times: ~0,62 em (twips = pt × 20).
      if (longest) points = Math.min(points, width / (longest * 0.62 * 20));
    }
  return Math.round(Math.max(5, points) * 2);
}

function renderTable(block: Extract<DraftBlock, { kind: 'table' }>) {
  const total = block.columns.reduce((sum, width) => sum + width, 0) || 1;
  const widths = block.columns.map((width) => Math.round((width / total) * CONTENT_WIDTH));
  const dense = block.columns.length >= 7;
  const margin = dense ? 40 : 80;
  const size = tableFontSize(block, widths, margin);
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: { top: GRID, bottom: GRID, left: GRID, right: GRID, insideHorizontal: GRID, insideVertical: GRID },
    rows: block.rows.map(
      (row) =>
        new TableRow({
          children: row.cells.map(
            (cell) =>
              new TableCell({
                columnSpan: cell.colSpan,
                rowSpan: cell.rowSpan,
                verticalAlign: VerticalAlignTable.CENTER,
                margins: { top: dense ? 10 : 20, bottom: dense ? 10 : 20, left: margin, right: margin },
                ...(row.style === 'normal' ? {} : { shading: { type: ShadingType.CLEAR, color: 'auto', fill: SHADES[row.style] } }),
                children: [paragraph(cell.text, { align: cell.align, bold: cell.bold || row.style !== 'normal', size, after: 0 })],
              }),
          ),
        }),
    ),
  });
}
