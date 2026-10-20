import JSZip from 'jszip';
import type { DraftBlock, TableCell, TableRow } from '../draft.js';
import type { LayoutNote, SourceLayout } from './source-layout.js';

/**
 * Estrutura de um DOCX (ADR-009) lida direto do XML: alinhamento, negrito, tamanho, tabelas com colunas e linhas
 * mescladas e sombreamento. Cabeçalho entra no início do corpo; rodapé vira nota do tradutor; imagens, nota de brasão.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? match;
  });

const attr = (xml: string, tag: string, name = 'w:val') => new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`).exec(xml)?.[1];
/** `<w:b/>` liga o negrito; `<w:b w:val="false"/>` ou `"0"` desliga. */
const flag = (xml: string, tag: string) => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?/?>`).exec(xml);
  if (!match) return false;
  const value = /w:val="([^"]*)"/.exec(match[0])?.[1];
  return value === undefined || !['false', '0', 'off'].includes(value);
};

interface Paragraph {
  text: string;
  align: 'left' | 'center' | 'right' | 'justify';
  bold: boolean;
  /** Maior tamanho de fonte da linha, em meio-pontos (padrão do Word: 22). */
  size: number;
  hasImage: boolean;
}

function readParagraph(xml: string, defaultSize: number): Paragraph {
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(xml)?.[0] ?? '';
  const jc = attr(pPr, 'w:jc');
  const align =
    jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : 'left';
  const runs = [...xml.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((match) => {
    const run = match[0];
    const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(run)?.[0] ?? '';
    const text = decode(
      [...run.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
        .map((m) => (m[0] === '<w:tab/>' ? '\t' : m[0] === '<w:br/>' ? ' ' : m[1]!))
        .join(''),
    );
    return { text, bold: flag(rPr, 'w:b'), size: Number(attr(rPr, 'w:sz') ?? defaultSize) };
  });
  const visible = runs.filter((run) => run.text.trim());
  const bold = visible.length > 0 && visible.every((run) => run.bold);
  const text = runs
    .map((run) => (run.bold && !bold && run.text.trim() ? run.text.replace(/^(\s*)(.*?)(\s*)$/, '$1**$2**$3') : run.text))
    .join('')
    .replace(/\*\*\s*\*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, align, bold, size: Math.max(defaultSize, ...visible.map((run) => run.size)), hasImage: /<w:drawing>|<w:pict>/.test(xml) };
}

const sizeOf = (size: number) => (size <= 16 ? 'tiny' : size <= 19 ? 'small' : 'normal');

function paragraphBlock(paragraph: Paragraph, maxSize: number): DraftBlock {
  const { text, align, bold, size } = paragraph;
  if (bold && (size >= 24 || align === 'center')) {
    return { kind: 'heading', text, align, level: size >= maxSize && size >= 24 ? 'title' : 'normal', sourceText: text, origin: 'rules' };
  }
  if (bold && align === 'left' && text === text.toUpperCase() && text.length < 60)
    return { kind: 'section', text, sourceText: text, origin: 'rules' };
  return { kind: 'paragraph', text, align, bold, size: sizeOf(size), sourceText: text, origin: 'rules' };
}

function readTable(xml: string, defaultSize: number): DraftBlock | null {
  const columns = [...xml.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"/g)].map((match) => Number(match[1]));
  const rows = [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((row) =>
    [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) => {
      const tcPr = /<w:tcPr>[\s\S]*?<\/w:tcPr>/.exec(cell[0])?.[0] ?? '';
      const vMergeTag = /<w:vMerge\b[^>]*\/?>/.exec(tcPr)?.[0];
      const paragraphs = [...cell[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
        .map((p) => readParagraph(p[0], defaultSize))
        .filter((p) => p.text);
      return {
        colSpan: Number(attr(tcPr, 'w:gridSpan') ?? 1),
        vMerge: vMergeTag ? (/w:val="restart"/.test(vMergeTag) ? 'restart' : 'continue') : null,
        shaded:
          (attr(tcPr, 'w:shd', 'w:fill') ?? 'auto').toLowerCase() !== 'auto' &&
          (attr(tcPr, 'w:shd', 'w:fill') ?? 'ffffff').toLowerCase() !== 'ffffff',
        text: paragraphs.map((p) => p.text).join(' '),
        bold: paragraphs.length > 0 && paragraphs.every((p) => p.bold),
        align: paragraphs[0]?.align === 'center' ? ('center' as const) : ('left' as const),
      };
    }),
  );
  if (!rows.length) return null;

  // Posição de cada célula na grade, para contar as continuações de mesclagem vertical abaixo dela.
  const positioned = rows.map((cells) => {
    let column = 0;
    return cells.map((cell) => {
      const at = column;
      column += cell.colSpan;
      return { ...cell, at };
    });
  });
  const tableRows: TableRow[] = positioned.map((cells, rowIndex) => {
    const kept = cells.filter((cell) => cell.vMerge !== 'continue');
    const shaded = kept.length > 0 && kept.every((cell) => cell.shaded);
    return {
      style: shaded ? (rowIndex < 2 ? 'header' : 'summary') : 'normal',
      cells: kept.map((cell): TableCell => {
        let rowSpan = 1;
        if (cell.vMerge === 'restart') {
          while (positioned[rowIndex + rowSpan]?.some((below) => below.at === cell.at && below.vMerge === 'continue')) rowSpan += 1;
        }
        return { text: cell.text, sourceText: cell.text || null, colSpan: cell.colSpan, rowSpan, bold: cell.bold, align: cell.align };
      }),
    };
  });
  const width = columns.length || Math.max(...positioned.map((cells) => cells.reduce((sum, cell) => sum + cell.colSpan, 0)));
  return {
    kind: 'table',
    columns: columns.length ? columns : new Array<number>(width).fill(1),
    rows: tableRows,
    sourceText: null,
    origin: 'rules',
  };
}

/** Elementos de primeiro nível do corpo, em ordem: parágrafos e tabelas. */
const bodyElements = (xml: string) => [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) => match[0]);

export async function analyzeDocxLayout(data: Uint8Array): Promise<SourceLayout> {
  const zip = await JSZip.loadAsync(data);
  const read = (name: string) => zip.file(name)?.async('string') ?? Promise.resolve('');
  const styles = await read('word/styles.xml');
  const defaultSize = Number(/<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/.exec(styles)?.[1] ?? 22);
  const names = Object.keys(zip.files);
  const partNumber = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

  const notes: LayoutNote[] = [];
  const elements: string[] = [];
  for (const name of names.filter((item) => /^word\/header\d*\.xml$/.test(item)).sort((a, b) => partNumber(a) - partNumber(b))) {
    elements.push(...bodyElements(await read(name)));
  }
  const body = await read('word/document.xml');
  elements.push(...bodyElements(body.slice(body.indexOf('<w:body>'))));

  const paragraphs = elements.filter((element) => !element.startsWith('<w:tbl>')).map((element) => readParagraph(element, defaultSize));
  const maxSize = Math.max(defaultSize, ...paragraphs.filter((p) => p.bold).map((p) => p.size));
  const blocks: DraftBlock[] = [];
  let title: { text: string; size: number } | null = null;
  for (const element of elements) {
    if (element.startsWith('<w:tbl>')) {
      const table = readTable(element, defaultSize);
      if (table) blocks.push(table);
      continue;
    }
    const paragraph = readParagraph(element, defaultSize);
    if (paragraph.hasImage && !notes.some((note) => note.kind === 'emblem')) {
      notes.push({
        kind: 'emblem',
        at: 'start',
        position: paragraph.align === 'center' ? 'center' : paragraph.align === 'right' ? 'right' : 'left',
      });
    }
    if (!paragraph.text) continue;
    const block = paragraphBlock(paragraph, maxSize);
    if (block.kind === 'heading' && (!title || paragraph.size > title.size)) title = { text: paragraph.text, size: paragraph.size };
    blocks.push(block);
  }
  for (const name of names.filter((item) => /^word\/footer\d*\.xml$/.test(item)).sort((a, b) => partNumber(a) - partNumber(b))) {
    const footer = bodyElements(await read(name))
      .map((element) => readParagraph(element, defaultSize).text)
      .filter(Boolean)
      .join(' ');
    if (footer) notes.push({ kind: 'footer', at: 'end', quote: footer.replace(/\*\*/g, '') });
  }
  const found = title as { text: string; size: number } | null;
  return { blocks, notes, title: found ? found.text : null };
}
