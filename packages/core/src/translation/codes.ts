import type { DraftBlock, TableCell } from './draft.js';

type Table = Extract<DraftBlock, { kind: 'table' }>;

/**
 * Códigos e identificadores não se traduzem (ADR-013): referências de peça, números de série, medidas, siglas com
 * símbolos. O provedor de tradução pode estragá-los (trocar "Ver7.21" por "Ver7,21", traduzir uma sigla).
 */

const plain = (text: string) => text.replace(/\*\*/g, '').trim();

/**
 * Palavra que é código: tem dígito, ou símbolo no meio sem minúsculas ("A-DATA", "N/A", "G.SKILL"), ou é só
 * pontuação, ou o "x" de multiplicação ("2 x 2GB"). "Single-channel" e "Heat-Sink" são palavras, não códigos.
 */
const codeToken = (token: string) =>
  /\d/.test(token) ||
  (/^\(?[\p{L}\d]+([./_+*-][\p{L}\d]*)+\)?[:;,]?$/u.test(token) && !/\p{Ll}/u.test(token)) ||
  !/\p{L}/u.test(token) ||
  /^[xX×]$/.test(token);

/** Trecho inteiro feito de códigos (ou sem letras): fica como no original. */
export function isCodeLike(text: string) {
  const clean = plain(text);
  if (!clean) return false;
  if (!/\p{L}{2}/u.test(clean)) return true;
  return clean.split(/\s+/).every(codeToken);
}

/** Texto corrido (duas ou mais palavras comuns, como "Heat-Sink Package"): traduz mesmo numa coluna de códigos. */
const isProse = (text: string) =>
  plain(text)
    .split(/\s+/)
    .filter((word) => /^\p{Lu}?\p{Ll}{2,}/u.test(word)).length >= 2;

/** Medida ou número simples ("1.5V", "8.5", "4 GB"): mantém o valor, mas converte o separador decimal. */
export const isMeasurement = (text: string) => /^[<>~±]?\d+(?:[.,]\d+)?\s?[\p{L}%µ°]{0,4}$/u.test(plain(text));

/**
 * Colunas de dados que são identificadores (planilhas técnicas): a maioria das células é código, ou são nomes de uma
 * palavra só que se repetem muito ou vêm em maiúsculas (marcas, "SS"/"DS"). Linhas de cabeçalho e de total não entram na conta e são
 * sempre traduzidas.
 */
export function fixedColumns(tables: Table[], text: (cell: TableCell) => string) {
  const width = tables[0]!.columns.length;
  const values: string[][] = Array.from({ length: width }, () => []);
  for (const block of tables) {
    const position = columnOf(block);
    for (const row of block.rows) {
      if (row.style !== 'normal') continue;
      for (const cell of row.cells) {
        const value = plain(text(cell));
        if (value && cell.colSpan === 1) values[position.get(cell)!]?.push(value);
      }
    }
  }
  const fixed = new Set<number>();
  values.forEach((list, index) => {
    if (list.length < 6) return;
    const codes = list.filter(isCodeLike).length / list.length;
    const single = list.filter((value) => !/\s/.test(value)).length / list.length;
    const distinct = new Set(list.map((value) => value.toLowerCase())).size / list.length;
    // Marcas costumam vir numa palavra só em maiúsculas; disciplinas e frases, não.
    const capitals = list.filter((value) => !/\s/.test(value) && !/\p{Ll}/u.test(value)).length / list.length;
    if (codes >= 0.6 || (single >= 0.9 && (distinct <= 0.6 || capitals >= 0.6))) fixed.add(index);
  });
  return fixed;
}

/** Coluna de cada célula, contando as mesclagens horizontais e as verticais vindas das linhas de cima. */
export function columnOf(block: Table) {
  const position = new Map<TableCell, number>();
  const busy: number[] = new Array<number>(block.columns.length).fill(0);
  for (const row of block.rows) {
    let column = 0;
    for (const cell of row.cells) {
      while (column < busy.length && busy[column]! > 0) column += 1;
      position.set(cell, column);
      for (let span = 0; span < cell.colSpan && column + span < busy.length; span += 1) busy[column + span] = cell.rowSpan;
      column += cell.colSpan;
    }
    for (let index = 0; index < busy.length; index += 1) if (busy[index]! > 0) busy[index]! -= 1;
  }
  return position;
}

/**
 * Células de tabela que ficam como no original: códigos e as de colunas de identificadores (só linhas normais).
 * Tabelas do mesmo documento com as mesmas colunas (seções de uma planilha) decidem juntas: uma seção curta segue o
 * padrão das longas.
 */
export function keptCells(blocks: DraftBlock[], text: (cell: TableCell) => string) {
  const families = new Map<string, Table[]>();
  for (const block of blocks)
    if (block.kind === 'table') families.set(block.columns.join(','), [...(families.get(block.columns.join(',')) ?? []), block]);
  const kept = new Set<TableCell>();
  for (const tables of families.values()) {
    const fixed = fixedColumns(tables, text);
    for (const block of tables) {
      const position = columnOf(block);
      for (const row of block.rows)
        for (const cell of row.cells) {
          const value = text(cell);
          if (!value.trim()) continue;
          const inFixedColumn = row.style === 'normal' && cell.colSpan === 1 && fixed.has(position.get(cell)!);
          if ((inFixedColumn && !isProse(value)) || isCodeLike(value)) kept.add(cell);
        }
    }
  }
  return kept;
}
