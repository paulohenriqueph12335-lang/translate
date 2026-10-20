import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DraftBlock, TableCell, TableRow } from '../draft.js';
import type { LayoutNote, NotePosition, SourceLayout } from './source-layout.js';

/**
 * Reconstrói a estrutura de um PDF digital (ADR-009) a partir de texto posicionado, fontes e desenhos vetoriais:
 * tabelas pelas bordas desenhadas (com mesclagens), títulos e alinhamento pela posição e pela fonte, parágrafos
 * unindo linhas quebradas, assinaturas pela linha de assinatura, e brasão, carimbo, marca d'água e rodapé como notas.
 */

interface Item {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
}

interface Line {
  items: Item[];
  x1: number;
  x2: number;
  y: number;
  size: number;
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Rotated {
  text: string;
  x: number;
  y: number;
  size: number;
  angle: number;
}

const TOL = 2;
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

type Matrix = [number, number, number, number, number, number];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol;
const inside = (box: Box, x: number, y: number, pad = 0) =>
  x >= box.x1 - pad && x <= box.x2 + pad && y >= box.y1 - pad && y <= box.y2 + pad;
const sizeOf = (size: number) => (size <= 7.5 ? 'tiny' : size <= 9 ? 'small' : 'normal');

/** Junta os trechos de uma linha, marcando com ** as partes em negrito quando a linha mistura pesos. */
function lineText(items: Item[], wholeBold: boolean) {
  const parts: string[] = [];
  let previous: Item | undefined;
  for (const item of items) {
    const gap = previous ? item.x - (previous.x + previous.width) : 0;
    const separator = previous && gap > item.size * 0.15 && !/\s$/.test(previous.text) && !/^\s/.test(item.text) ? ' ' : '';
    const text = item.text.trim() ? item.text : item.text;
    parts.push(separator + (item.bold && !wholeBold && text.trim() ? `**${text.trim()}**` : text));
    previous = item;
  }
  return parts
    .join('')
    .replace(/\*\*\s*\*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupLines(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => near(candidate.y, item.y, Math.max(2, Math.min(candidate.size, item.size) * 0.4)));
    if (line) {
      line.items.push(item);
      line.x1 = Math.min(line.x1, item.x);
      line.x2 = Math.max(line.x2, item.x + item.width);
      line.size = Math.max(line.size, item.size);
    } else lines.push({ items: [item], x1: item.x, x2: item.x + item.width, y: item.y, size: item.size });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

/**
 * Une segmentos colineares que se sobrepõem ou encostam. Primeiro agrupa pela coordenada fixa (bordas de células
 * vizinhas chegam como 461,6999 e 461,7001), depois junta os intervalos de cada grupo.
 */
function mergeSegments(segments: Segment[], horizontal: boolean) {
  const key = (s: Segment) => (horizontal ? s.y1 : s.x1);
  const start = (s: Segment) => (horizontal ? Math.min(s.x1, s.x2) : Math.min(s.y1, s.y2));
  const end = (s: Segment) => (horizontal ? Math.max(s.x1, s.x2) : Math.max(s.y1, s.y2));
  const groups: Segment[][] = [];
  for (const segment of [...segments].sort((a, b) => key(a) - key(b))) {
    const group = groups.at(-1);
    if (group && near(key(group[0]!), key(segment))) group.push(segment);
    else groups.push([segment]);
  }
  const merged: Segment[] = [];
  for (const group of groups) {
    const fixed = group.reduce((sum, segment) => sum + key(segment), 0) / group.length;
    let from = Number.NaN;
    let to = Number.NaN;
    const emit = () => merged.push(horizontal ? { x1: from, x2: to, y1: fixed, y2: fixed } : { x1: fixed, x2: fixed, y1: from, y2: to });
    for (const segment of group.sort((a, b) => start(a) - start(b))) {
      if (!Number.isNaN(to) && start(segment) <= to + TOL) to = Math.max(to, end(segment));
      else {
        if (!Number.isNaN(to)) emit();
        from = start(segment);
        to = end(segment);
      }
    }
    emit();
  }
  return merged;
}

const cluster = (values: number[]) =>
  [...values]
    .sort((a, b) => a - b)
    .reduce<number[]>((acc, value) => {
      if (!acc.length || !near(acc.at(-1)!, value, 2.5)) acc.push(value);
      return acc;
    }, []);

interface TableGrid {
  box: Box;
  xs: number[];
  ys: number[];
  horizontals: Segment[];
  verticals: Segment[];
}

/** Grades formadas por linhas horizontais e verticais que se cruzam (componentes conectados). */
function findGrids(horizontals: Segment[], verticals: Segment[]): TableGrid[] {
  const all = [...horizontals.map((s) => ({ s, h: true })), ...verticals.map((s) => ({ s, h: false }))];
  const parent = all.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  all.forEach((a, i) =>
    all.forEach((b, j) => {
      if (j <= i || a.h === b.h) return;
      const h = a.h ? a.s : b.s;
      const v = a.h ? b.s : a.s;
      if (v.x1 >= h.x1 - TOL && v.x1 <= h.x2 + TOL && h.y1 >= v.y1 - TOL && h.y1 <= v.y2 + TOL) parent[find(i)] = find(j);
    }),
  );
  const groups = new Map<number, typeof all>();
  all.forEach((entry, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), entry]));
  const grids: TableGrid[] = [];
  for (const group of groups.values()) {
    const hs = group.filter((entry) => entry.h).map((entry) => entry.s);
    const vs = group.filter((entry) => !entry.h).map((entry) => entry.s);
    if (hs.length < 2 || vs.length < 2) continue;
    const xs = cluster(vs.map((s) => s.x1));
    const ys = cluster(hs.map((s) => s.y1)).reverse();
    if (xs.length < 2 || ys.length < 2) continue;
    grids.push({ box: { x1: xs[0]!, x2: xs.at(-1)!, y1: ys.at(-1)!, y2: ys[0]! }, xs, ys, horizontals: hs, verticals: vs });
  }
  return grids;
}

const hasVertical = (grid: TableGrid, x: number, yTop: number, yBottom: number) =>
  grid.verticals.some((s) => near(s.x1, x, 2.5) && s.y1 <= Math.min(yTop, yBottom) + TOL + 1 && s.y2 >= Math.max(yTop, yBottom) - TOL - 1);
const hasHorizontal = (grid: TableGrid, y: number, xLeft: number, xRight: number) =>
  grid.horizontals.some(
    (s) => near(s.y1, y, 2.5) && s.x1 <= Math.min(xLeft, xRight) + TOL + 1 && s.x2 >= Math.max(xLeft, xRight) - TOL - 1,
  );

/**
 * Distribui os itens de texto pelas colunas `xs` (bordas): cada item precisa caber inteiro numa coluna.
 * Devolve os itens por coluna, ou `null` se algum atravessa uma borda ou se tudo cai numa coluna só.
 */
function fitColumns(items: Item[], xs: number[]): Item[][] | null {
  const columns: Item[][] = xs.slice(1).map(() => []);
  for (const item of items) {
    const index = columns.findIndex((_, c) => item.x >= xs[c]! - 3 && item.x + item.width <= xs[c + 1]! + 3);
    if (index < 0) return null;
    columns[index]!.push(item);
  }
  return columns.filter((column) => column.length).length >= 2 ? columns : null;
}

/** Trechos de uma linha separados por espaço largo (células de planilha sem bordas). */
function chunks(line: Line) {
  const result: Item[][] = [];
  for (const item of line.items) {
    const last = result.at(-1)?.at(-1);
    if (last && item.x - (last.x + last.width) <= Math.max(3, item.size * 0.8)) result.at(-1)!.push(item);
    else result.push([item]);
  }
  return result;
}

/**
 * Bordas de coluna pela projeção do texto: faixas verticais em que nenhuma linha tem texto separam as colunas,
 * como faria quem lê uma tabela sem linhas.
 */
function projectColumns(lines: Line[]): number[] | null {
  const x1 = Math.min(...lines.map((line) => line.x1));
  const x2 = Math.max(...lines.map((line) => line.x2));
  const width = Math.ceil(x2 - x1) + 1;
  const coverage = new Array<number>(width).fill(0);
  for (const line of lines)
    for (const chunk of chunks(line)) {
      const from = Math.floor(chunk[0]!.x - x1);
      const to = Math.ceil(chunk.at(-1)!.x + chunk.at(-1)!.width - x1);
      for (let x = Math.max(0, from); x < Math.min(width, to); x += 1) coverage[x]! += 1;
    }
  // Um texto longo isolado pode invadir o vão; em tabelas grandes, uma linha fora do padrão é tolerada.
  const allowed = lines.length >= 12 ? 1 : 0;
  const xs = [x1 - 2];
  let gapStart = -1;
  for (let x = 0; x <= width; x += 1) {
    const free = x < width && coverage[x]! <= allowed;
    if (free && gapStart < 0) gapStart = x;
    else if (!free && gapStart >= 0) {
      if (x - gapStart >= 3 && gapStart > 0 && x < width) xs.push(x1 + (gapStart + x) / 2);
      gapStart = -1;
    }
  }
  xs.push(x2 + 2);
  return xs.length >= 4 ? xs : null;
}

/** Itens pela coluna onde fica o centro de cada um (linha fora do padrão numa tabela sem bordas). */
function byCenter(items: Item[], xs: number[]): Item[][] {
  const columns: Item[][] = xs.slice(1).map(() => []);
  for (const item of items) {
    const center = item.x + item.width / 2;
    const index = Math.max(0, Math.min(columns.length - 1, xs.findIndex((x) => x > center) - 1));
    columns[index < 0 ? columns.length - 1 : index]!.push(item);
  }
  return columns;
}

/** Texto de uma célula: rótulo pequeno sobre valor maior vira "Rótulo: valor", como no modelo juramentado. */
function cellContent(items: Item[]) {
  if (!items.length) return { text: '', bold: false, center: false };
  const lines = groupLines(items);
  const bold = items.every((item) => item.bold);
  if (lines.length >= 2 && lines[0]!.size < lines[1]!.size - 1.5) {
    const label = lineText(lines[0]!.items, bold);
    const value = lines
      .slice(1)
      .map((line) => lineText(line.items, bold))
      .join(' ');
    return { text: `${label}: ${value}`, bold, center: false };
  }
  return { text: lines.map((line) => lineText(line.items, bold)).join(' '), bold, center: true };
}

function buildTable(grid: TableGrid, items: Item[], used: Set<Item>): DraftBlock[] | null {
  const rows = grid.ys.length - 1;
  const cols = grid.xs.length - 1;
  const owner: Array<Array<boolean>> = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const tableRows: TableRow[] = [];
  let filled = 0;
  for (let r = 0; r < rows; r += 1) {
    const cells: TableCell[] = [];
    for (let c = 0; c < cols; c += 1) {
      if (owner[r]![c]) continue;
      const top = grid.ys[r]!;
      const bottom = grid.ys[r + 1]!;
      let colSpan = 1;
      while (c + colSpan < cols && !hasVertical(grid, grid.xs[c + colSpan]!, top - 1, bottom + 1)) colSpan += 1;
      let rowSpan = 1;
      while (r + rowSpan < rows && !hasHorizontal(grid, grid.ys[r + rowSpan]!, grid.xs[c]! + 1, grid.xs[c + colSpan]! - 1)) rowSpan += 1;
      for (let dr = 0; dr < rowSpan; dr += 1) for (let dc = 0; dc < colSpan; dc += 1) owner[r + dr]![c + dc] = true;
      const box: Box = { x1: grid.xs[c]!, x2: grid.xs[c + colSpan]!, y1: grid.ys[r + rowSpan]!, y2: top };
      const content = items.filter((item) => !used.has(item) && inside(box, item.x + item.width / 2, item.y + item.size * 0.3));
      content.forEach((item) => used.add(item));
      // Planilhas exportadas desenham as verticais só no cabeçalho: os dados vêm numa faixa única, alinhados às colunas.
      const split = colSpan > 1 && rowSpan === 1 ? fitColumns(content, grid.xs.slice(c, c + colSpan + 1)) : null;
      if (split) {
        for (const column of split) {
          const part = cellContent(column);
          if (part.text) filled += 1;
          cells.push({ text: part.text, sourceText: part.text || null, colSpan: 1, rowSpan: 1, bold: part.bold, align: 'center' });
        }
        continue;
      }
      const { text, bold, center } = cellContent(content);
      if (text) filled += 1;
      const narrow = box.x2 - box.x1 < 120;
      cells.push({ text, sourceText: text || null, colSpan, rowSpan, bold, align: center && narrow ? 'center' : 'left' });
    }
    tableRows.push({ style: 'normal', cells });
  }
  // Uma "tabela" de uma coluna é moldura (barra de seção, caixa de texto): o conteúdo segue como texto corrido.
  if (cols === 1 || filled === 0) {
    for (const item of items) if (inside(grid.box, item.x + item.width / 2, item.y + item.size * 0.3)) used.delete(item);
    return null;
  }
  const blocks: DraftBlock[] = [];
  // Primeira linha com uma só célula em negrito ocupando a largura toda: é o título da seção.
  const first = tableRows[0]!;
  const titled = first.cells.filter((cell) => cell.text);
  if (titled.length === 1 && titled[0]!.colSpan >= cols - 1 && titled[0]!.bold && tableRows.length > 1) {
    const text = titled[0]!.text;
    blocks.push({ kind: 'section', text, sourceText: text, origin: 'rules' });
    tableRows.shift();
  }
  // Todas as linhas com "Rótulo: valor" e os mesmos rótulos por coluna: os rótulos viram o cabeçalho, como no modelo.
  const split = (text: string) => {
    const match = /^([^:]{1,60}):\s(.+)$/.exec(text);
    return match ? { label: match[1]!, value: match[2]! } : null;
  };
  const labelled = tableRows.length > 1 && tableRows.every((row) => row.cells.every((cell) => split(cell.text)));
  const sameLabels =
    labelled &&
    tableRows.every(
      (row) =>
        row.cells.length === tableRows[0]!.cells.length &&
        row.cells.every((cell, index) => split(cell.text)!.label === split(tableRows[0]!.cells[index]!.text)!.label),
    );
  if (sameLabels) {
    const header: TableRow = {
      style: 'header',
      cells: tableRows[0]!.cells.map((cell) => {
        const label = split(cell.text)!.label;
        return { ...cell, text: label, sourceText: label, bold: true, align: 'left' as const };
      }),
    };
    for (const row of tableRows) {
      row.cells = row.cells.map((cell) => {
        const value = split(cell.text)!.value;
        return { ...cell, text: value, sourceText: value };
      });
    }
    tableRows.unshift(header);
  } else {
    tableRows.forEach((row, index) => {
      const texts = row.cells.filter((cell) => cell.text);
      if (texts.length && texts.every((cell) => cell.bold)) row.style = index < 2 ? 'header' : 'summary';
    });
  }
  blocks.push({
    kind: 'table',
    columns: grid.xs.slice(1).map((x, index) => Math.round(x - grid.xs[index]!)),
    rows: tableRows,
    sourceText: null,
    origin: 'rules',
  });
  return blocks;
}

/** Linhas giradas (marca d'água, carimbo) reconstruídas no eixo do próprio texto. */
function rotatedGroups(items: Rotated[]) {
  const groups: Rotated[][] = [];
  for (const item of items) {
    // Carimbos têm linhas de tamanhos diferentes: vale a proporção e a distância a qualquer linha do grupo.
    const group = groups.find(
      (candidate) =>
        near(candidate[0]!.angle, item.angle, 2) &&
        candidate.some((other) => {
          const ratio = Math.max(other.size, item.size) / Math.min(other.size, item.size);
          return ratio < 1.6 && Math.hypot(other.x - item.x, other.y - item.y) < Math.max(other.size, item.size) * 12;
        }),
    );
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    const angle = (group[0]!.angle * Math.PI) / 180;
    const along = (r: Rotated) => r.x * Math.cos(angle) + r.y * Math.sin(angle);
    const across = (r: Rotated) => -r.x * Math.sin(angle) + r.y * Math.cos(angle);
    const lines: Rotated[][] = [];
    for (const item of [...group].sort((a, b) => across(b) - across(a))) {
      const line = lines.find((candidate) => near(across(candidate[0]!), across(item), item.size * 0.5));
      if (line) line.push(item);
      else lines.push([item]);
    }
    const text = lines
      .map((line) =>
        line
          .sort((a, b) => along(a) - along(b))
          .map((r) => r.text)
          .join('')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter(Boolean)
      .join(' – ');
    return { text, size: group[0]!.size };
  });
}

const position = (x: number, width: number): NotePosition => (x < width / 3 ? 'left' : x > (2 * width) / 3 ? 'right' : 'center');

/** Lê o layout da primeira à última página; páginas seguem em sequência no mesmo corpo. */
export async function analyzePdfLayout(data: Uint8Array): Promise<SourceLayout> {
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  const blocks: DraftBlock[] = [];
  const notes: LayoutNote[] = [];
  let title: { text: string; size: number } | null = null;
  // Colunas da última tabela: a continuação na página seguinte costuma vir sem bordas, nas mesmas posições.
  let lastXs: number[] | null = null;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 });
      const operators = await page.getOperatorList();
      const content = await page.getTextContent();

      // Texto horizontal e texto girado.
      const items: Item[] = [];
      const rotated: Rotated[] = [];
      for (const raw of content.items) {
        if (!('str' in raw) || !raw.str.trim()) continue;
        const [a = 1, b = 0, , , x = 0, y = 0] = raw.transform as number[];
        const size = Math.hypot(a, b);
        const angle = (Math.atan2(b, a) * 180) / Math.PI;
        if (Math.abs(angle) > 1) {
          rotated.push({ text: raw.str, x, y, size, angle });
          continue;
        }
        const font = page.commonObjs.has(raw.fontName) ? (page.commonObjs.get(raw.fontName) as { bold?: boolean; name?: string }) : null;
        const bold = font?.bold === true || /bold|black|heavy/i.test(font?.name ?? '');
        items.push({ text: raw.str, x, y, width: raw.width, size, bold });
      }

      // Desenhos: segmentos retos (bordas) e áreas de curvas (brasão, rabiscos de assinatura).
      const horizontalsRaw: Segment[] = [];
      const verticalsRaw: Segment[] = [];
      const curves: Box[] = [];
      const stack: Matrix[] = [];
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      operators.fnArray.forEach((fn, index) => {
        const args = operators.argsArray[index] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix);
        // Caminho só de recorte (endPath, usado por planilhas exportadas em toda a página) não desenha nada.
        else if (fn === OPS.constructPath && args[0] !== OPS.endPath) {
          const path = args[1] as ArrayLike<number> | ArrayLike<number>[] | null;
          const data =
            path && typeof (path as ArrayLike<number>)[0] === 'number'
              ? (path as ArrayLike<number>)
              : ((path as ArrayLike<number>[] | null)?.[0] ?? []);
          let cursor: [number, number] = [0, 0];
          let start: [number, number] = [0, 0];
          let curveBox: Box | null = null;
          const line = (from: [number, number], to: [number, number]) => {
            if (near(from[1], to[1], 0.5) && Math.abs(from[0] - to[0]) > 3)
              horizontalsRaw.push({ x1: Math.min(from[0], to[0]), x2: Math.max(from[0], to[0]), y1: from[1], y2: from[1] });
            else if (near(from[0], to[0], 0.5) && Math.abs(from[1] - to[1]) > 3)
              verticalsRaw.push({ y1: Math.min(from[1], to[1]), y2: Math.max(from[1], to[1]), x1: from[0], x2: from[0] });
          };
          const grow = (x: number, y: number) => {
            curveBox = curveBox
              ? { x1: Math.min(curveBox.x1, x), x2: Math.max(curveBox.x2, x), y1: Math.min(curveBox.y1, y), y2: Math.max(curveBox.y2, y) }
              : { x1: x, x2: x, y1: y, y2: y };
          };
          for (let i = 0; i < data.length; ) {
            const op = data[i]!;
            if (op === DRAW.moveTo) {
              cursor = apply(ctm, data[i + 1]!, data[i + 2]!);
              start = cursor;
              i += 3;
            } else if (op === DRAW.lineTo) {
              const next = apply(ctm, data[i + 1]!, data[i + 2]!);
              line(cursor, next);
              if (!near(cursor[0], next[0], 0.5) && !near(cursor[1], next[1], 0.5)) {
                grow(...cursor);
                grow(...next);
              }
              cursor = next;
              i += 3;
            } else if (op === DRAW.curveTo) {
              grow(...cursor);
              cursor = apply(ctm, data[i + 5]!, data[i + 6]!);
              grow(...cursor);
              i += 7;
            } else if (op === DRAW.quadraticCurveTo) {
              grow(...cursor);
              cursor = apply(ctm, data[i + 3]!, data[i + 4]!);
              grow(...cursor);
              i += 5;
            } else if (op === DRAW.closePath) {
              line(cursor, start);
              cursor = start;
              i += 1;
            } else break;
          }
          if (curveBox) curves.push(curveBox);
        }
      });

      // A moldura que envolve quase a página inteira não é tabela: é um retângulo sem divisões internas.
      // Uma tabela grande (planilha exportada) ocupa a página também, mas tem linhas e colunas.
      const pageArea = pageWidth * pageHeight;
      let horizontals = mergeSegments(horizontalsRaw, true);
      let verticals = mergeSegments(verticalsRaw, false);
      const big = (grid: TableGrid) => (grid.box.x2 - grid.box.x1) * (grid.box.y2 - grid.box.y1) > pageArea * 0.55;
      const frame = findGrids(horizontals, verticals).find(
        (grid) => big(grid) && (grid.xs.length <= 3 || grid.ys.length <= 3) && !(grid.xs.length === 3 && grid.ys.length > 6),
      );
      if (frame) {
        const onFrame = (s: Segment) =>
          (near(s.y1, frame.box.y1, 2.5) || near(s.y1, frame.box.y2, 2.5)) && s.x2 - s.x1 > (frame.box.x2 - frame.box.x1) * 0.9;
        const onFrameV = (s: Segment) =>
          (near(s.x1, frame.box.x1, 2.5) || near(s.x1, frame.box.x2, 2.5)) && s.y2 - s.y1 > (frame.box.y2 - frame.box.y1) * 0.9;
        horizontals = horizontals.filter((s) => !onFrame(s));
        verticals = verticals.filter((s) => !onFrameV(s));
      }

      const used = new Set<Item>();
      type Placed = { y: number; block: DraftBlock };
      const placed: Placed[] = [];
      const grids = findGrids(horizontals, verticals).filter((grid) => !big(grid) || (grid.xs.length > 2 && grid.ys.length > 2));
      for (const grid of grids) {
        const tableBlocks = buildTable(grid, items, used);
        tableBlocks?.forEach((block, index) => placed.push({ y: grid.box.y2 - index * 0.001, block }));
        if (tableBlocks) lastXs = grid.xs;
      }

      // Assinaturas: linha horizontal curta e solta, com nome e cargo logo abaixo.
      const looseLines = horizontals.filter(
        (s) => s.x2 - s.x1 < pageWidth * 0.45 && !grids.some((grid) => inside(grid.box, (s.x1 + s.x2) / 2, s.y1, 1)),
      );
      const signatures: Array<{ x: number; y: number; block: DraftBlock }> = [];
      for (const rule of looseLines) {
        const below = groupLines(
          items.filter(
            (item) =>
              !used.has(item) && item.y < rule.y1 && item.y > rule.y1 - 26 && item.x + item.width > rule.x1 - 10 && item.x < rule.x2 + 10,
          ),
        );
        if (!below.length) continue;
        below.flatMap((line) => line.items).forEach((item) => used.add(item));
        const scribble = curves.some((box) => box.y1 > rule.y1 - 3 && box.y1 < rule.y1 + 45 && box.x2 > rule.x1 && box.x1 < rule.x2);
        signatures.push({
          x: rule.x1,
          y: rule.y1,
          block: {
            kind: 'signature',
            illegible: scribble,
            name: lineText(below[0]!.items, false),
            role: below
              .slice(1)
              .map((line) => lineText(line.items, false))
              .join(' – '),
            sourceText: null,
            origin: 'rules',
          },
        });
      }
      signatures
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .forEach((signature) => placed.push({ y: signature.y - 0.01, block: signature.block }));

      // Tabelas sem bordas: linhas seguidas com três ou mais trechos separados por espaço largo. As colunas vêm da
      // tabela anterior quando o texto se encaixa nelas (continuação em outra página); senão, dos vãos do texto.
      let run: Line[] = [];
      const flushRun = () => {
        const lines = run;
        run = [];
        if (lines.length < 3) return;
        const previous = lastXs;
        const inherited =
          previous && lines.filter((line) => fitColumns(line.items, previous)).length >= lines.length * 0.9 ? previous : null;
        const xs = inherited ?? projectColumns(lines);
        if (!xs) return;
        const rows: TableRow[] = lines.map((line) => ({
          style: 'normal',
          cells: (fitColumns(line.items, xs) ?? byCenter(line.items, xs)).map((column) => {
            const part = cellContent(column);
            return { text: part.text, sourceText: part.text || null, colSpan: 1, rowSpan: 1, bold: part.bold, align: 'center' as const };
          }),
        }));
        // Primeira linha toda em negrito: cabeçalho.
        if (rows[0]!.cells.every((cell) => !cell.text || cell.bold)) rows[0]!.style = 'header';
        lines.forEach((line) => line.items.forEach((item) => used.add(item)));
        placed.push({
          y: lines[0]!.y,
          block: {
            kind: 'table',
            columns: xs.slice(1).map((x, index) => Math.round(x - xs[index]!)),
            rows,
            sourceText: null,
            origin: 'rules',
          },
        });
        lastXs = xs;
      };
      for (const line of groupLines(items.filter((item) => !used.has(item)))) {
        const tabular = chunks(line).length >= 3;
        const previous = run.at(-1);
        if (tabular && previous && previous.y - line.y < Math.max(line.size * 3.2, 16)) run.push(line);
        else {
          flushRun();
          if (tabular) run.push(line);
        }
      }
      flushRun();

      // Texto corrido: linhas → parágrafos, com alinhamento, tamanho e negrito.
      const free = groupLines(items.filter((item) => !used.has(item)));
      const left = Math.min(...items.map((item) => item.x));
      const right = Math.max(...items.map((item) => item.x + item.width));
      const middle = (left + right) / 2;
      const alignOf = (line: Line) => {
        if (Math.abs((line.x1 + line.x2) / 2 - middle) < 14 && line.x1 > left + 25) return 'center' as const;
        // Cabeçalho centrado ao lado do brasão: o centro se desloca, mas a linha não encosta em nenhuma margem.
        if (line.x1 > left + 60 && line.x2 < right - 15) return 'center' as const;
        if (line.x2 > right - 15 && line.x1 > left + (right - left) * 0.4) return 'right' as const;
        return 'left' as const;
      };
      const maxSize = Math.max(...free.map((line) => line.size), 0);
      let current: { lines: Line[]; align: ReturnType<typeof alignOf>; bold: boolean; size: number } | null = null;
      const flush = () => {
        if (!current) return;
        const { lines, align, bold, size } = current;
        const text = lines
          .map((line) => lineText(line.items, bold))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        const y = lines[0]!.y;
        current = null;
        if (!text) return;
        // Rodapé: texto pequeno no pé da página, depois de todo o conteúdo.
        if (size <= 7.5 && y < pageHeight * 0.08) {
          notes.push({ kind: 'footer', at: 'end', quote: text.replace(/\*\*/g, '') });
          return;
        }
        const multiline = lines.length > 1;
        if (bold && size >= 11) {
          placed.push({
            y,
            block: {
              kind: 'heading',
              text,
              align: align === 'right' ? 'right' : align,
              level: size >= maxSize - 0.5 ? 'title' : 'normal',
              sourceText: text,
              origin: 'rules',
            },
          });
          if (!title || size > title.size) title = { text, size };
          return;
        }
        if (bold && !multiline && align === 'left' && text === text.toUpperCase() && text.length < 60) {
          placed.push({ y, block: { kind: 'section', text, sourceText: text, origin: 'rules' } });
          return;
        }
        placed.push({
          y,
          block: {
            kind: 'paragraph',
            text,
            align: multiline && align === 'left' ? 'justify' : align,
            bold,
            size: sizeOf(size),
            sourceText: text,
            origin: 'rules',
          },
        });
      };
      for (const line of free) {
        const align = alignOf(line);
        const bold = line.items.every((item) => item.bold);
        const previous = current?.lines.at(-1);
        const continues =
          current &&
          previous &&
          align === current.align &&
          align !== 'center' &&
          bold === current.bold &&
          near(line.size, current.size, 0.6) &&
          previous.y - line.y < line.size * 1.7 &&
          // Uma linha que termina bem antes da margem direita encerra o parágrafo.
          previous.x2 > right - 40 &&
          // Linha que começa com marcador de lista ("•", "-", "*") é um item novo.
          !/^\s*[•\-–*·▪]/.test(line.items[0]?.text ?? '');
        if (continues) current!.lines.push(line);
        else {
          flush();
          current = { lines: [line], align, bold, size: line.size };
        }
      }
      flush();

      placed.sort((a, b) => b.y - a.y);
      // Brasão: desenho de curvas no alto da página, fora de tabelas e assinaturas.
      const emblem = curves.find(
        (box) =>
          box.y2 > pageHeight * 0.8 &&
          box.x2 - box.x1 > 15 &&
          box.y2 - box.y1 > 15 &&
          !grids.some((grid) => inside(grid.box, box.x1, box.y1, 2)),
      );
      if (emblem && pageNumber === 1)
        notes.push({ kind: 'emblem', at: 'start', position: position((emblem.x1 + emblem.x2) / 2, pageWidth) });
      for (const group of rotatedGroups(rotated)) {
        if (!group.text) continue;
        notes.push(
          group.size >= 24 ? { kind: 'watermark', at: 'end', quote: group.text } : { kind: 'stamp', at: 'end', quote: group.text },
        );
      }
      blocks.push(...placed.map((entry) => entry.block));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  // Tabela que continua na página seguinte (mesmas colunas, sem novo cabeçalho) vira uma tabela só.
  const joined: DraftBlock[] = [];
  for (const block of blocks) {
    const previous = joined.at(-1);
    if (
      block.kind === 'table' &&
      previous?.kind === 'table' &&
      block.rows[0]?.style === 'normal' &&
      block.columns.length === previous.columns.length &&
      block.columns.every((width, index) => Math.abs(width - previous.columns[index]!) <= 3)
    ) {
      previous.rows.push(...block.rows);
      continue;
    }
    joined.push(block);
  }
  // Ordem das notas finais como no modelo: carimbo, marca d'água, rodapé.
  const order = { emblem: 0, stamp: 1, watermark: 2, footer: 3 } as const;
  notes.sort((a, b) => order[a.kind] - order[b.kind]);
  const found = title as { text: string; size: number } | null;
  // Sem título grande (planilhas exportadas), o primeiro título de seção identifica o documento.
  const section = joined.find((block) => block.kind === 'section');
  return { blocks: joined, notes, title: found ? found.text : section?.kind === 'section' ? section.text : null };
}
