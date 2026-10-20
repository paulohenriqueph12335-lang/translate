import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import type { DraftBlock } from '../draft.js';
import { analyzeDocxLayout } from './docx-layout.js';
import { analyzePdfLayout } from './pdf-layout.js';

const fixture = async (name: string) =>
  new Uint8Array(await readFile(new URL(`../../../fixtures/historico-escolar/${name}`, import.meta.url)));

type Table = Extract<DraftBlock, { kind: 'table' }>;
const tables = (blocks: DraftBlock[]) => blocks.filter((block): block is Table => block.kind === 'table');
const spans = (table: Table) => ({
  colSpan: table.rows.some((row) => row.cells.some((cell) => cell.colSpan > 1)),
  rowSpan: table.rows.some((row) => row.cells.some((cell) => cell.rowSpan > 1)),
});

describe('leitura do layout do original (ADR-009)', () => {
  it('PDF: cabeçalho centrado, tabelas com mesclagens, seções, assinaturas e notas', async () => {
    const layout = await analyzePdfLayout(await fixture('original.pdf'));
    assert.equal(layout.title, 'HISTÓRICO ESCOLAR');
    const title = layout.blocks.find((block) => block.kind === 'heading' && block.level === 'title');
    assert.equal(title?.kind === 'heading' && title.align, 'center');

    const [student, grades, studies] = tables(layout.blocks);
    assert.equal(tables(layout.blocks).length, 3);
    assert.deepEqual(spans(student!), { colSpan: true, rowSpan: false });
    assert.match(student!.rows[0]!.cells[0]!.text, /^NOME DO\(A\) ALUNO\(A\): MARIANA/);
    assert.equal(grades!.rows.length, 17);
    assert.deepEqual(spans(grades!), { colSpan: true, rowSpan: true });
    assert.deepEqual([grades!.rows[0]!.style, grades!.rows.at(-1)!.style], ['header', 'summary']);
    assert.deepEqual(
      studies!.rows[0]!.cells.map((cell) => cell.text),
      ['SÉRIE', 'ANO', 'ESTABELECIMENTO'],
    );

    const sections = layout.blocks.filter((block) => block.kind === 'section').map((block) => block.kind === 'section' && block.text);
    assert.deepEqual(sections, ['ESTUDOS REALIZADOS', 'CERTIFICADO DE CONCLUSÃO']);
    const date = layout.blocks.find((block) => block.kind === 'paragraph' && block.text.startsWith('Vila Esperança, 15'));
    assert.equal(date?.kind === 'paragraph' && date.align, 'right');
    assert.deepEqual(
      layout.blocks.filter((block) => block.kind === 'signature').map((block) => block.kind === 'signature' && block.name),
      ['Juliana Ferreira Costa', 'Ricardo Mendes Duarte'],
    );
    assert.deepEqual(
      layout.notes.map((note) => note.kind),
      ['emblem', 'stamp', 'watermark', 'footer'],
    );
  });

  it('PDF de outro modelo: cabeçalho deslocado pelo brasão e carimbo de linhas desiguais', async () => {
    const layout = await analyzePdfLayout(await fixture('variante-fundamental.pdf'));
    const school = layout.blocks.find((block) => block.kind === 'heading' && block.text.startsWith('ESCOLA ESTADUAL'));
    assert.equal(school?.kind === 'heading' && school.align, 'center');
    const stamps = layout.notes.filter((note) => note.kind === 'stamp');
    assert.equal(stamps.length, 1);
    assert.match(stamps[0]!.kind === 'stamp' ? stamps[0]!.quote : '', /SECRETARIA – STA\. CLARA DO NORTE – MG$/);
    assert.equal(tables(layout.blocks).length, 3);
  });

  it('planilha exportada: tabela do tamanho da página, verticais só no cabeçalho e continuação sem bordas (ADR-013)', async () => {
    const data = new Uint8Array(await readFile(new URL('../../../fixtures/planilha-tecnica/planilha-ficticia.pdf', import.meta.url)));
    const layout = await analyzePdfLayout(data);
    assert.deepEqual(
      layout.blocks.filter((block) => block.kind === 'section').map((block) => block.kind === 'section' && block.text),
      ['DDR3 1333 Qualified Vendors List (QVL)', 'DDR3 1600 Qualified Vendors List (QVL)'],
    );
    assert.equal(layout.title, 'DDR3 1333 Qualified Vendors List (QVL)');
    const [first, second] = tables(layout.blocks);
    assert.equal(tables(layout.blocks).length, 2);
    // Duas linhas de cabeçalho, com "DIMM socket support" sobre "1 DIMM" e "2 DIMM".
    assert.deepEqual(
      first!.rows.slice(0, 2).map((row) => row.style),
      ['header', 'header'],
    );
    assert.deepEqual(first!.rows[0]!.cells.map((cell) => [cell.text, cell.colSpan, cell.rowSpan]).at(-1), [
      'DIMM socket support (Optional)',
      2,
      1,
    ]);
    // As 6 linhas da página 1 e as 4 da página 2 formam uma tabela só, dividida nas 10 colunas.
    const data1 = first!.rows.filter((row) => row.style === 'normal');
    assert.equal(data1.length, 10);
    assert.ok(data1.every((row) => row.cells.length === 10));
    assert.deepEqual(
      data1[3]!.cells.map((cell) => cell.text),
      ['CORVO', 'CMX16GX3M2A1333C9(Ver7.21)', '8GB', 'DS', 'N/A', 'N/A', '9-9-9-24', '1.50V', '•', '•'],
    );
    assert.equal(data1[8]!.cells[6]!.text, '');
    assert.equal(second!.rows.filter((row) => row.style === 'normal').length, 2);
    // Itens de lista viram parágrafos separados.
    assert.equal(layout.blocks.filter((block) => block.kind === 'paragraph' && block.text.startsWith('•')).length, 2);
  });

  it('DOCX: alinhamento, negrito, mesclagens e rodapé', async () => {
    const layout = await analyzeDocxLayout(await fixture('esperado.docx'));
    const grades = tables(layout.blocks).find((table) => table.rows.length === 17);
    assert.ok(grades);
    assert.deepEqual(spans(grades), { colSpan: true, rowSpan: true });
    assert.equal(grades.rows[0]!.style, 'header');
    assert.ok(layout.blocks.some((block) => block.kind === 'paragraph' && block.text.startsWith('**DOCUMENT TYPE:**')));
    assert.ok(layout.blocks.some((block) => block.kind === 'paragraph' && block.align === 'right'));
    assert.deepEqual(
      layout.notes.map((note) => note.kind),
      ['footer'],
    );
  });
});
