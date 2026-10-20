import JSZip from 'jszip';
import { LANGUAGE_NAMES, longDate } from '../conventions.js';
import type { Draft, DraftBlock, Language } from '../draft.js';
import { renderSwornDocx } from '../render-docx.js';
import { swornFrame } from '../sworn-template.js';

/**
 * Máscara do tradutor juramentado (ADR-012): um Word com o timbre, a abertura, o encerramento e a diagramação do
 * tradutor, com marcadores no lugar do que muda a cada tradução. O sistema troca só os marcadores; o resto do
 * arquivo (cabeçalho, rodapé, estilos, espaços, campos de página) não é tocado. O texto traduzido entra no lugar de
 * {{texto}} com a formatação daquele parágrafo.
 */
export const MASK_MARKERS = {
  texto: 'O documento traduzido (tabelas, parágrafos e notas). Obrigatório, sozinho num parágrafo do corpo.',
  numero: 'Número da tradução, como digitado na conclusão.',
  livro: 'Livro, como digitado na conclusão.',
  folha: 'Folha, como digitada na conclusão.',
  data: 'Data da conclusão por extenso, no idioma de destino (ex.: October 18, 2026).',
  data_curta: 'Data da conclusão em números (ex.: 18/10/2026).',
  ano: 'Ano da conclusão.',
  tipo: 'Tipo do documento (ex.: SCHOOL TRANSCRIPT).',
  titulo_original: 'Título do documento original (ex.: HISTÓRICO ESCOLAR).',
  idioma_origem: 'Idioma do original, no idioma de destino (ex.: Portuguese).',
  idioma_destino: 'Idioma da tradução, no idioma de destino (ex.: English).',
  tradutor: 'Nome do tradutor, como cadastrado ({{TRADUTOR}} em maiúsculas sai em maiúsculas; vale para todos).',
} as const;
export type MaskMarker = keyof typeof MASK_MARKERS;

export interface MaskInspection {
  /** É um Word (.docx) que o sistema consegue abrir: pode ser guardado como máscara. */
  isWord: boolean;
  /** Pronta para gerar traduções: {{texto}} uma única vez, no corpo. Sem isso, fica aguardando configuração. */
  ok: boolean;
  /** Marcadores reconhecidos e onde estão. */
  markers: Array<{ name: string; part: string }>;
  errors: string[];
  warnings: string[];
}

export interface MaskValues {
  numero: string;
  livro: string;
  folha: string;
  data: Date;
  tradutor: string;
}

const MARKER = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? match;
  });
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Partes do Word onde marcadores são procurados: corpo, cabeçalhos, rodapés e notas. */
const TEXT_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

interface TextNode {
  start: number;
  end: number;
  open: string;
  text: string;
}

/** `<w:t>` de uma parte, agrupados por parágrafo (um `</w:p>` entre dois textos separa os grupos). */
function textGroups(xml: string) {
  const nodes: TextNode[] = [];
  for (const match of xml.matchAll(/(<w:t(?:\s[^>]*)?>)([^<]*)<\/w:t>/g)) {
    nodes.push({ start: match.index!, end: match.index! + match[0].length, open: match[1]!, text: decode(match[2]!) });
  }
  const groups: TextNode[][] = [];
  let current: TextNode[] = [];
  nodes.forEach((node, index) => {
    const previous = nodes[index - 1];
    if (previous && xml.slice(previous.end, node.start).includes('</w:p>')) {
      groups.push(current);
      current = [];
    }
    current.push(node);
  });
  if (current.length) groups.push(current);
  return groups;
}

/** Marcadores de um grupo, com a posição no texto concatenado. */
function groupMarkers(group: TextNode[]) {
  const text = group.map((node) => node.text).join('');
  return [...text.matchAll(MARKER)].map((match) => ({
    name: match[1]!.toLowerCase(),
    /** {{TRADUTOR}} em maiúsculas: o valor sai em maiúsculas. */
    upper: match[1] === match[1]!.toUpperCase(),
    from: match.index!,
    to: match.index! + match[0].length,
  }));
}

/**
 * Troca marcadores mesmo quando o Word os partiu em vários trechos (`{{nu` + `mero}}`): o primeiro trecho recebe o
 * valor e os demais perdem só os caracteres do marcador. A formatação de cada trecho fica como estava.
 */
function replaceMarkers(xml: string, value: (name: string) => string | null) {
  const edits: Array<{ node: TextNode; text: string }> = [];
  for (const group of textGroups(xml)) {
    const markers = groupMarkers(group).filter((marker) => value(marker.name) !== null);
    if (!markers.length) continue;
    const texts = group.map((node) => node.text);
    const offsets = group.map((_, index) => texts.slice(0, index).reduce((sum, text) => sum + text.length, 0));
    const locate = (position: number) => {
      let index = offsets.findIndex((offset, i) => position >= offset && position < offset + texts[i]!.length);
      if (index < 0) index = texts.length - 1;
      return { index, at: position - offsets[index]! };
    };
    for (const marker of [...markers].reverse()) {
      const first = locate(marker.from);
      const last = locate(marker.to - 1);
      const replacement = marker.upper ? value(marker.name)!.toLocaleUpperCase('pt-BR') : value(marker.name)!;
      if (first.index === last.index) {
        const text = texts[first.index]!;
        texts[first.index] = text.slice(0, first.at) + replacement + text.slice(last.at + 1);
      } else {
        texts[first.index] = texts[first.index]!.slice(0, first.at) + replacement;
        for (let i = first.index + 1; i < last.index; i++) texts[i] = '';
        texts[last.index] = texts[last.index]!.slice(last.at + 1);
      }
    }
    group.forEach((node, index) => {
      if (texts[index] !== node.text) edits.push({ node, text: texts[index]! });
    });
  }
  let result = xml;
  for (const { node, text } of edits.sort((a, b) => b.node.start - a.node.start)) {
    const open = node.open.includes('xml:space') ? node.open : node.open.replace('<w:t', '<w:t xml:space="preserve"');
    result = result.slice(0, node.start) + `${open}${escape(text)}</w:t>` + result.slice(node.end);
  }
  return result;
}

/** Confere se o arquivo serve de máscara: Word válido, {{texto}} uma única vez no corpo, marcadores conhecidos. */
export async function inspectMask(data: Uint8Array): Promise<MaskInspection> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const markers: MaskInspection['markers'] = [];
  const notWord = (message: string): MaskInspection => ({ isWord: false, ok: false, markers, errors: [message], warnings });
  const head = Buffer.from(data.subarray(0, 8));
  if (head.subarray(0, 5).toString('latin1') === '%PDF-')
    return notWord('A máscara precisa ser um arquivo Word (.docx); PDF não é aceito.');
  // Word 97-2003 (.doc) é um arquivo OLE, que o sistema não edita.
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return notWord('Arquivo .doc (Word antigo): abra no Word e use "Salvar como" → Documento do Word (.docx).');
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return notWord('O arquivo não é um Word (.docx) válido.');
  }
  if (!zip.file('word/document.xml')) return notWord('O arquivo não é um Word (.docx) válido.');
  for (const name of Object.keys(zip.files)
    .filter((file) => TEXT_PART.test(file))
    .sort()) {
    const xml = await zip.file(name)!.async('string');
    const part = name.replace(/^word\//, '').replace(/\.xml$/, '');
    for (const group of textGroups(xml)) {
      const found = groupMarkers(group);
      for (const marker of found) {
        markers.push({ name: marker.name, part });
        if (!(marker.name in MASK_MARKERS)) warnings.push(`Marcador desconhecido {{${marker.name}}} em ${part}: ficará como está.`);
        if (marker.name === 'texto') {
          if (part !== 'document') errors.push('{{texto}} precisa estar no corpo do documento, não em cabeçalho ou rodapé.');
          const rest = group
            .map((node) => node.text)
            .join('')
            .replace(MARKER, '')
            .trim();
          if (rest) warnings.push('O parágrafo de {{texto}} tem outro texto; ele fica antes do documento traduzido.');
        }
      }
    }
  }
  const texts = markers.filter((marker) => marker.name === 'texto').length;
  if (texts === 0) errors.push('A máscara não tem o marcador {{texto}}, que indica onde entra o documento traduzido.');
  if (texts > 1) errors.push('O marcador {{texto}} aparece mais de uma vez; deixe apenas um.');
  if (!markers.some((marker) => marker.name === 'numero'))
    warnings.push('A máscara não tem {{numero}}: o número da tradução não aparecerá no documento.');
  if (!markers.some((marker) => marker.name === 'data'))
    warnings.push('A máscara não tem {{data}}: a data da tradução não aparecerá no documento.');
  return { isWord: true, ok: errors.length === 0, markers, errors, warnings };
}

// ---------- Geração do conteúdo no formato do parágrafo {{texto}} ----------

const RPR_ORDER = [
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'noProof',
  'snapToGrid',
  'vanish',
  'webHidden',
  'color',
  'spacing',
  'w',
  'kern',
  'position',
  'sz',
  'szCs',
  'highlight',
  'u',
  'effect',
  'bdr',
  'shd',
  'fitText',
  'vertAlign',
  'rtl',
  'cs',
  'em',
  'lang',
  'eastAsianLayout',
  'specVanish',
  'oMath',
];
const PPR_ORDER = [
  'pStyle',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'framePr',
  'widowControl',
  'numPr',
  'suppressLineNumbers',
  'pBdr',
  'shd',
  'tabs',
  'suppressAutoHyphens',
  'kinsoku',
  'wordWrap',
  'overflowPunct',
  'topLinePunct',
  'autoSpaceDE',
  'autoSpaceDN',
  'bidi',
  'adjustRightInd',
  'snapToGrid',
  'spacing',
  'ind',
  'contextualSpacing',
  'mirrorIndents',
  'suppressOverlap',
  'jc',
  'textDirection',
  'textAlignment',
  'textboxTightWrap',
  'outlineLvl',
  'divId',
  'cnfStyle',
  'rPr',
  'sectPr',
  'pPrChange',
];

/** Filhos diretos de um elemento (`<w:rPr>…</w:rPr>` sem as tags externas). */
function children(inner: string) {
  const list: Array<{ name: string; xml: string }> = [];
  let index = 0;
  while (index < inner.length) {
    const open = inner.indexOf('<w:', index);
    if (open < 0) break;
    const name = /^<w:([A-Za-z]+)/.exec(inner.slice(open))![1]!;
    const tagEnd = inner.indexOf('>', open);
    let end: number;
    if (inner[tagEnd - 1] === '/') end = tagEnd + 1;
    else {
      const close = `</w:${name}>`;
      const found = inner.indexOf(close, tagEnd);
      end = found < 0 ? tagEnd + 1 : found + close.length;
    }
    list.push({ name, xml: inner.slice(open, end) });
    index = end;
  }
  return list;
}

/** Troca (ou inclui) filhos respeitando a ordem do esquema do Word; `null` remove. */
function setChildren(inner: string, order: string[], changes: Record<string, string | null>) {
  const kept = children(inner).filter((child) => !(child.name in changes));
  for (const [name, xml] of Object.entries(changes)) if (xml) kept.push({ name, xml });
  const rank = (name: string) => {
    const position = order.indexOf(name);
    return position < 0 ? order.length : position;
  };
  return kept
    .map((child, index) => ({ child, index }))
    .sort((a, b) => rank(a.child.name) - rank(b.child.name) || a.index - b.index)
    .map(({ child }) => child.xml)
    .join('');
}

const innerOf = (xml: string | undefined, tag: string) => {
  if (!xml) return '';
  const match = new RegExp(`<w:${tag}(?:\\s[^>]*)?>([\\s\\S]*)</w:${tag}>`).exec(xml);
  return match ? match[1]! : '';
};

interface BaseFormat {
  /** Propriedades do parágrafo de {{texto}}, sem numeração de lista e sem quebra de seção. */
  pPr: string;
  /** Propriedades do trecho onde está {{texto}}. */
  rPr: string;
  /** Tamanho da fonte em meios-pontos (padrão 22 = 11 pt). */
  size: number;
  /** Largura útil da página em twips, para as tabelas. */
  width: number;
}

type Style = { align?: string; bold?: boolean; italic?: boolean; size?: number };

function runProps(base: BaseFormat, style: Style) {
  const changes: Record<string, string | null> = {};
  if (style.bold) Object.assign(changes, { b: '<w:b/>', bCs: '<w:bCs/>' });
  if (style.italic) Object.assign(changes, { i: '<w:i/>', iCs: '<w:iCs/>' });
  if (style.size && style.size !== base.size) {
    Object.assign(changes, { sz: `<w:sz w:val="${style.size}"/>`, szCs: `<w:szCs w:val="${style.size}"/>` });
  }
  const inner = setChildren(base.rPr, RPR_ORDER, changes);
  return inner ? `<w:rPr>${inner}</w:rPr>` : '';
}

/** Trechos de "texto **negrito** texto", com quebras de linha. */
function runs(text: string, base: BaseFormat, style: Style) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => {
      const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
      const content = bold ? part.slice(2, -2) : part;
      const body = content
        .split('\n')
        .map((line) => `<w:t xml:space="preserve">${escape(line)}</w:t>`)
        .join('<w:br/>');
      return `<w:r>${runProps(base, { ...style, bold: style.bold || bold })}${body}</w:r>`;
    })
    .join('');
}

const JC: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'both' };

function paragraph(text: string, base: BaseFormat, style: Style, pPr = base.pPr) {
  const props = setChildren(pPr, PPR_ORDER, style.align ? { jc: `<w:jc w:val="${JC[style.align] ?? 'left'}"/>` } : {});
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs(text, base, style)}</w:p>`;
}

const GRID =
  '<w:top w:val="single" w:sz="4" w:space="0" w:color="555555"/><w:left w:val="single" w:sz="4" w:space="0" w:color="555555"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="555555"/><w:right w:val="single" w:sz="4" w:space="0" w:color="555555"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="555555"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="555555"/>';
const SHADE = { header: 'DFE6F1', summary: 'F1F4F9' } as const;

/** Tabela no formato da máscara: largura útil da página, grade fina, mesclagens e sombreamento de cabeçalho/total. */
function table(block: Extract<DraftBlock, { kind: 'table' }>, base: BaseFormat) {
  const total = block.columns.reduce((sum, width) => sum + width, 0) || 1;
  const widths = block.columns.map((width) => Math.round((width / total) * base.width));
  const size = Math.max(14, base.size - 4);
  const cellPPr = '<w:spacing w:before="0" w:after="0"/>';
  // Ocupação da grade: células cobertas por mesclagem vertical viram continuação (vMerge) na linha de baixo.
  const covered = new Map<string, number>();
  const rows = block.rows.map((row, r) => {
    const cells: string[] = [];
    let column = 0;
    const continuation = () => {
      while (covered.has(`${r}:${column}`)) {
        const span = covered.get(`${r}:${column}`)!;
        const width = widths.slice(column, column + span).reduce((sum, value) => sum + value, 0);
        cells.push(
          `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vMerge/></w:tcPr><w:p><w:pPr>${cellPPr}</w:pPr></w:p></w:tc>`,
        );
        column += span;
      }
    };
    for (const cell of row.cells) {
      continuation();
      const span = Math.max(1, cell.colSpan);
      const width = widths.slice(column, column + span).reduce((sum, value) => sum + value, 0);
      for (let below = 1; below < cell.rowSpan; below++) covered.set(`${r + below}:${column}`, span);
      const shade = row.style === 'normal' ? '' : `<w:shd w:val="clear" w:color="auto" w:fill="${SHADE[row.style]}"/>`;
      cells.push(
        `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${
          cell.rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : ''
        }${shade}<w:vAlign w:val="center"/></w:tcPr>${paragraph(
          cell.text,
          base,
          { align: cell.align, bold: cell.bold || row.style !== 'normal', size },
          cellPPr,
        )}</w:tc>`,
      );
      column += span;
    }
    continuation();
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr>`;
  });
  return `<w:tbl><w:tblPr><w:tblW w:w="${base.width}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${GRID}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths
    .map((width) => `<w:gridCol w:w="${width}"/>`)
    .join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

/** Blocos do rascunho em XML do Word, com a formatação do parágrafo {{texto}}. */
function blocksXml(draft: Draft, base: BaseFormat, banner: string | null) {
  const frame = swornFrame(
    {
      name: '',
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
    new Date(),
    null,
  );
  const out: string[] = [];
  if (banner) out.push(paragraph(banner, base, { align: 'center', bold: true }));
  for (const block of draft.blocks) {
    switch (block.kind) {
      case 'heading':
        out.push(
          paragraph(block.text, base, { align: block.align, bold: true, size: block.level === 'title' ? base.size + 2 : base.size }),
        );
        break;
      case 'paragraph':
        out.push(
          paragraph(block.text, base, {
            align: block.align,
            bold: block.bold,
            size: block.size === 'small' ? base.size - 2 : block.size === 'tiny' ? base.size - 4 : base.size,
          }),
        );
        break;
      case 'section':
        out.push(paragraph(block.text, base, { align: 'left', bold: true }));
        break;
      case 'translator_note':
        out.push(paragraph(frame.translatorNote(block.text), base, { align: 'justify', italic: true }));
        break;
      case 'signature':
        out.push(paragraph(frame.signatureMark(block.illegible), base, { align: 'left' }));
        out.push(paragraph([block.name, block.role].filter(Boolean).join(' – '), base, { align: 'left' }));
        break;
      case 'table':
        out.push(table(block, base), paragraph('', base, {}));
        break;
    }
  }
  return out.join('');
}

/** Largura útil da página da seção principal (twips). */
function contentWidth(documentXml: string) {
  const sections = [...documentXml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].map((match) => match[0]);
  const section = sections.at(-1) ?? '';
  const size = Number(/<w:pgSz\b[^>]*\bw:w="(\d+)"/.exec(section)?.[1] ?? 11906);
  const left = Number(/<w:pgMar\b[^>]*\bw:left="(\d+)"/.exec(section)?.[1] ?? 1134);
  const right = Number(/<w:pgMar\b[^>]*\bw:right="(\d+)"/.exec(section)?.[1] ?? 1134);
  return Math.max(2000, size - left - right);
}

/** Troca o parágrafo de {{texto}} pelo documento traduzido. */
function insertContent(xml: string, draft: Draft, banner: string | null) {
  const group = textGroups(xml).find((nodes) => groupMarkers(nodes).some((marker) => marker.name === 'texto'));
  if (!group) throw new Error('A máscara não tem o marcador {{texto}}');
  const first = group[0]!;
  // Início do parágrafo: o último <w:p> (não <w:pPr>) antes do texto.
  const before = xml.slice(0, first.start);
  const pStart = Math.max(before.lastIndexOf('<w:p>'), before.lastIndexOf('<w:p '));
  const pEnd = xml.indexOf('</w:p>', group.at(-1)!.end) + '</w:p>'.length;
  const paragraphXml = xml.slice(pStart, pEnd);
  const pPr = innerOf(/^<w:p(?:\s[^>]*)?>\s*(<w:pPr>[\s\S]*?<\/w:pPr>)?/.exec(paragraphXml)?.[1], 'pPr');
  const markerNode = group.find((node) => node.text.includes('{{') || node.text.includes('texto')) ?? first;
  const runStart = Math.max(xml.lastIndexOf('<w:r>', markerNode.start), xml.lastIndexOf('<w:r ', markerNode.start));
  const rPr = runStart > pStart ? innerOf(/^<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)?/.exec(xml.slice(runStart))?.[1], 'rPr') : '';
  const section = /<w:sectPr\b[\s\S]*?<\/w:sectPr>/.exec(pPr)?.[0] ?? null;
  const base: BaseFormat = {
    pPr: setChildren(pPr, PPR_ORDER, { numPr: null, sectPr: null }),
    rPr,
    size: Number(/<w:sz w:val="(\d+)"/.exec(rPr)?.[1] ?? 22),
    width: contentWidth(xml),
  };
  // Texto que dividia o parágrafo com {{texto}} fica antes do documento.
  const rest = group
    .map((node) => node.text)
    .join('')
    .replace(MARKER, '')
    .trim();
  const leading = rest ? paragraph(rest, base, {}) : '';
  // Quebra de seção que estava no parágrafo de {{texto}} continua no fim.
  const trailing = section ? `<w:p><w:pPr>${setChildren(base.pPr, PPR_ORDER, { sectPr: section })}</w:pPr></w:p>` : '';
  return xml.slice(0, pStart) + leading + blocksXml(draft, base, banner) + trailing + xml.slice(pEnd);
}

const shortDate = (date: Date, language: Language) =>
  language === 'en'
    ? `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`
    : `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;

/**
 * Preenche a máscara com o rascunho e os dados da conclusão. `values: null` gera a prévia: número, livro e folha
 * ficam em branco ("____") e o documento ganha uma linha de aviso de rascunho antes do texto.
 */
export async function fillMask(mask: Uint8Array, draft: Draft, values: MaskValues | null, tradutor: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(mask);
  const target = draft.targetLanguage;
  const date = values?.data ?? new Date();
  const value = (name: string): string | null => {
    switch (name as MaskMarker) {
      case 'numero':
        return values?.numero ?? '____';
      case 'livro':
        return values?.livro ?? '___';
      case 'folha':
        return values?.folha ?? '___';
      case 'data':
        return longDate(date, target);
      case 'data_curta':
        return shortDate(date, target);
      case 'ano':
        return String(date.getUTCFullYear());
      case 'tipo':
        return draft.documentType;
      case 'titulo_original':
        return draft.sourceTitle;
      case 'idioma_origem':
        return LANGUAGE_NAMES[target][draft.sourceLanguage];
      case 'idioma_destino':
        return LANGUAGE_NAMES[target][target];
      case 'tradutor':
        return values?.tradutor ?? tradutor;
      default:
        return null;
    }
  };
  const banner =
    values === null
      ? target === 'en'
        ? 'DRAFT – NOT APPROVED – NOT VALID AS A TRANSLATION'
        : 'RASCUNHO – NÃO APROVADO – SEM VALOR COMO TRADUÇÃO'
      : null;
  for (const name of Object.keys(zip.files).filter((file) => TEXT_PART.test(file))) {
    let xml = await zip.file(name)!.async('string');
    if (name === 'word/document.xml') xml = insertContent(xml, draft, banner);
    xml = replaceMarkers(xml, (marker) => (marker === 'texto' ? null : value(marker)));
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Modelo de máscara para o tradutor ajustar no Word: o formato juramentado padrão do sistema com os marcadores no
 * lugar certo. O tradutor troca o timbre e os textos pelos dele e mantém os marcadores.
 */
export function renderMaskTemplate(target: Language = 'en', source: Language = target === 'en' ? 'pt' : 'en') {
  return renderSwornDocx(
    {
      sourceLanguage: source,
      targetLanguage: target,
      documentType: '{{tipo}}',
      sourceTitle: '',
      blocks: [{ kind: 'paragraph', text: '{{texto}}', align: 'justify', bold: false, size: 'normal', sourceText: null, origin: 'rules' }],
    },
    {
      profile: {
        name: '{{tradutor}}',
        titlePt: 'Tradutor(a) Público(a) e Intérprete Comercial',
        languagePt: LANGUAGE_NAMES.pt[target === 'pt' ? source : target].replace(/^./, (c) => c.toUpperCase()),
        registration: 'Matrícula nº 0000',
        registrationEn: 'the Commercial Registry under No. 0000',
        registrationPt: 'na Junta Comercial sob o nº 0000',
        city: 'Cidade',
        statePt: 'Estado',
        stateEn: 'State',
        letterheadNote: null,
        feeNote: null,
      },
      issuedAt: new Date(),
      numbering: null,
      placeholders: true,
    },
  );
}
