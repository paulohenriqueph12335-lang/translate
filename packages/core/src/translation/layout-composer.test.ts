import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Draft, DraftBlock } from './draft.js';
import { composeLayout, learnLayout, rolesOf } from './layout-composer.js';

const p = (text: string, extra: Partial<Extract<DraftBlock, { kind: 'paragraph' }>> = {}): DraftBlock => ({
  kind: 'paragraph',
  text,
  align: 'left',
  bold: false,
  size: 'normal',
  sourceText: text,
  origin: 'machine',
  ...extra,
});
const h = (text: string, level: 'title' | 'normal' = 'normal'): DraftBlock => ({ kind: 'heading', text, align: 'center', level, sourceText: text, origin: 'machine' });
const fields = (rows: Array<[string, string]>, label = 30): DraftBlock => ({
  kind: 'table',
  columns: [label, 100 - label],
  rows: rows.map(([a, b]) => ({
    style: 'normal' as const,
    cells: [
      { text: a, sourceText: a, colSpan: 1, rowSpan: 1, bold: true, align: 'left' as const },
      { text: b, sourceText: b, colSpan: 1, rowSpan: 1, bold: false, align: 'left' as const },
    ],
  })),
  sourceText: null,
  origin: 'machine',
});
const draft = (blocks: DraftBlock[], sourceTitle = ''): Draft => ({ sourceLanguage: 'pt', targetLanguage: 'en', documentType: '', sourceTitle, blocks });

/** Dois documentos já concluídos, de tipos diferentes, com a mesma "gramática" de diagramação. */
const known = [
  draft(
    [
      h('FICTITIOUS REPUBLIC OF BRAZIL'),
      h('BIRTH CERTIFICATE', 'title'),
      fields([
        ['Name', 'MARIANA'],
        ['Date of birth', 'March 14, 2006'],
        ['Sex', 'Female'],
      ]),
      p('I certify that this certificate faithfully reproduces the data.', { align: 'justify' }),
      p('Vila Esperança, December 10, 2025.', { align: 'center' }),
      p('_______________________', { align: 'center' }),
      p('ANA PAULA REGO', { align: 'center' }),
    ],
    'CERTIDÃO DE NASCIMENTO',
  ),
  draft(
    [
      h('FICTITIOUS STATE COUNCIL'),
      h('CERTIFICATE OF REGISTRATION', 'title'),
      fields([
        ['Registration', 'CRM 000123'],
        ['Status', 'Active'],
      ]),
      p('This certificate is valid for 90 days from the date of issue.', { align: 'justify' }),
      p('Porto Aurora, September 5, 2025.', { align: 'center' }),
      p('_______________________', { align: 'center' }),
      p('PRESIDENT OF THE COUNCIL', { align: 'center' }),
    ],
    'CERTIDÃO DE INSCRIÇÃO',
  ),
];
const knowledge = known.map(learnLayout);

/** Documento de um tipo que o sistema nunca viu, lido por OCR: tudo à esquerda e nada em negrito. */
const unknown = () =>
  draft([
    p('FICTITIOUS MUNICIPALITY OF SERRA CLARA'),
    p('RESIDENCE DECLARATION'),
    p('Name: LUCAS FERREIRA'),
    p('Address: Rua das Flores, 10'),
    p('Neighbourhood: Centro'),
    p('I declare, under the penalties of the law, that the above information is true.'),
    p('Serra Clara, October 21, 2026.'),
    p('_______________________'),
    p('LUCAS FERREIRA'),
  ]);

describe('diagramação construída para documentos desconhecidos', () => {
  it('reconhece o papel de cada parte do documento', () => {
    assert.deepEqual(rolesOf(known[0]!), ['authority', 'title', 'field_table', 'line', 'place_date', 'signature_line', 'signatory']);
    assert.deepEqual(rolesOf(unknown()), ['authority', 'title', 'field', 'field', 'field', 'prose', 'place_date', 'signature_line', 'signatory']);
  });

  it('combina os documentos conhecidos parecidos: campos em tabela, centralização e tipo, sem mudar texto', () => {
    const before = unknown();
    const result = composeLayout(before, knowledge);
    assert.ok(result.borrowedFrom.length >= 1);
    const texts = (d: Draft) =>
      d.blocks.flatMap((block) => (block.kind === 'table' ? block.rows.flatMap((row) => row.cells.map((cell) => cell.text)) : [block.kind === 'signature' ? block.name : block.text]));
    // Nenhuma palavra muda: "Name: LUCAS FERREIRA" vira rótulo e valor.
    assert.deepEqual(texts(result.draft).join(' ').replace(/\s+/g, ' '), texts(before).join(' ').replace(/:\s*/g, ' ').replace(/\s+/g, ' '));
    const table = result.draft.blocks.find((block) => block.kind === 'table') as Extract<DraftBlock, { kind: 'table' }>;
    assert.deepEqual(table.columns, [30, 70]);
    assert.deepEqual(table.rows.map((row) => row.cells[0]!.text), ['Name', 'Address', 'Neighbourhood']);
    const byText = (text: string) => result.draft.blocks.find((block) => block.kind !== 'table' && block.kind !== 'signature' && block.text === text) as Extract<DraftBlock, { kind: 'paragraph' | 'heading' }>;
    assert.equal(byText('Serra Clara, October 21, 2026.').align, 'center');
    assert.equal(byText('LUCAS FERREIRA').align, 'center');
    assert.equal(byText('FICTITIOUS MUNICIPALITY OF SERRA CLARA').kind, 'heading');
    // O título é a última linha em maiúsculas do topo, não o nome do órgão.
    assert.equal(result.draft.documentType, 'RESIDENCE DECLARATION');
    assert.ok(result.changes.some((change) => /documentos parecidos/.test(change.message)));
  });

  it('OCR: junta linhas quebradas, texto corrido justificado, campo com rótulo alongado pela tradução continua na tabela', () => {
    const ocr = draft([
      p('FICTITIOUS CLINIC'),
      p('MEDICAL CERTIFICATE'),
      p('Patient: BEATRIZ SOUZA'),
      p('CPF (Brazilian Individual Taxpayer Registry): 000.555.222-00', { sourceText: 'CPF: 000.555.222-00' }),
      p('I certify that the patient above was seen today and needs'),
      p('to be away from school activities for three days.'),
      p('Porto Aurora, October 20, 2026.'),
    ]);
    const result = composeLayout(ocr, knowledge);
    const table = result.draft.blocks.find((block) => block.kind === 'table') as Extract<DraftBlock, { kind: 'table' }>;
    assert.equal(table.rows.length, 2);
    const prose = result.draft.blocks.find((block) => block.kind === 'paragraph' && block.text.startsWith('I certify')) as Extract<DraftBlock, { kind: 'paragraph' }>;
    assert.equal(prose.text, 'I certify that the patient above was seen today and needs to be away from school activities for three days.');
    assert.equal(prose.align, 'justify');
    assert.equal(result.draft.documentType, 'MEDICAL CERTIFICATE');
  });

  it('formatação conhecida do original prevalece', () => {
    const shaped = unknown();
    shaped.blocks[0] = { ...(shaped.blocks[0] as Extract<DraftBlock, { kind: 'paragraph' }>), align: 'right', bold: true };
    const result = composeLayout(shaped, knowledge);
    const first = result.draft.blocks[0] as Extract<DraftBlock, { kind: 'paragraph' }>;
    assert.equal(first.kind, 'paragraph');
    assert.equal(first.align, 'right');
    assert.ok(!result.changes.some((change) => /Alinhamento/.test(change.message)));
  });

  it('sem conhecimento, nada muda', () => {
    const before = unknown();
    const result = composeLayout(before, []);
    assert.deepEqual(result.draft, before);
    assert.deepEqual(result.changes, []);
  });
});
