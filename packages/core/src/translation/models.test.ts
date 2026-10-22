import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import JSZip from 'jszip';
import { applyBodyModel, classifyDocument, repairTable } from './body-models.js';
import { structuralProblems, type Draft, type DraftBlock } from './draft.js';
import { approvedTranscriptDraft } from './fixtures.js';
import { fillMask, inspectMask } from './mask/fill-mask.js';
import { FRAME_MODELS, renderFrameModel } from './mask/frame-models.js';

const cell = (text: string, colSpan = 1, rowSpan = 1) => ({
  text,
  sourceText: text,
  colSpan,
  rowSpan,
  bold: false,
  align: 'left' as const,
});
const para = (text: string, sourceText: string | null = text) =>
  ({ kind: 'paragraph', text, align: 'left', bold: false, size: 'normal', sourceText, origin: 'machine' }) as const;
const draftOf = (blocks: DraftBlock[], extra: Partial<Draft> = {}): Draft => ({
  sourceLanguage: 'pt',
  targetLanguage: 'en',
  documentType: '',
  sourceTitle: '',
  blocks,
  ...extra,
});

describe('modelos de corpo (diagramação por tipo de documento)', () => {
  it('reconhece o tipo pelo título e pelo começo do texto', () => {
    const empty = draftOf([]);
    assert.equal(classifyDocument(empty, 'REPÚBLICA\nCERTIDÃO DE NASCIMENTO\nNome'), 'birth_certificate');
    assert.equal(classifyDocument(empty, 'CARTEIRA NACIONAL DE HABILITAÇÃO'), 'driver_license');
    assert.equal(classifyDocument(empty, 'APOSTILA\nCertidão de Nascimento apostilada'), 'apostille');
    assert.equal(classifyDocument(empty, 'Ata da reunião do conselho'), 'generic');
  });

  it('tabela que não fecha a grade é reorganizada sem perder texto', () => {
    const table: Extract<DraftBlock, { kind: 'table' }> = {
      kind: 'table',
      columns: new Array(22).fill(1),
      rows: [
        { style: 'normal', cells: [cell('Nome', 4), cell('MARIANA', 30)] },
        { style: 'normal', cells: [cell('CPF', 10), cell('000', 5)] },
        { style: 'normal', cells: [cell('A', 2, 9), cell('B', 20)] },
      ],
      sourceText: null,
      origin: 'machine',
    };
    assert.ok(structuralProblems(draftOf([table])).length > 0);
    const fixed = repairTable(table)!;
    assert.deepEqual(structuralProblems(draftOf([fixed])), []);
    assert.deepEqual(
      fixed.rows.flatMap((row) => row.cells.map((item) => item.text)),
      ['Nome', 'MARIANA', 'CPF', '000', 'A', 'B'],
    );
  });

  it('certidão: rótulo e valor em tabela, sem parágrafos vazios, tipo preenchido pelo modelo', () => {
    const draft = draftOf([
      {
        kind: 'heading',
        text: 'BIRTH CERTIFICATE',
        align: 'center',
        level: 'title',
        sourceText: 'CERTIDÃO DE NASCIMENTO',
        origin: 'machine',
      },
      para(''),
      para('Name: MARIANA ALVES TEIXEIRA', 'Nome: MARIANA ALVES TEIXEIRA'),
      para('Date of birth: March 14, 2006', 'Data de nascimento: 14/03/2006'),
      para('Sex: Female', 'Sexo: Feminino'),
      para('I certify that this certificate faithfully reproduces the data.'),
    ]);
    const result = applyBodyModel(draft, 'CERTIDÃO DE NASCIMENTO');
    assert.equal(result.model, 'birth_certificate');
    assert.equal(result.draft.documentType, 'BIRTH CERTIFICATE');
    assert.deepEqual(
      result.draft.blocks.map((block) => block.kind),
      ['heading', 'table', 'paragraph'],
    );
    const table = result.draft.blocks[1] as Extract<DraftBlock, { kind: 'table' }>;
    assert.deepEqual(table.columns, [35, 65]);
    assert.deepEqual(
      table.rows[1]!.cells.map((item) => [item.text, item.sourceText]),
      [
        ['Date of birth', 'Data de nascimento'],
        ['March 14, 2006', '14/03/2006'],
      ],
    );
    assert.ok(result.changes.length >= 3);
  });

  it('documento sem tipo conhecido usa o primeiro título', () => {
    const draft = draftOf([
      { kind: 'heading', text: 'Meeting minutes', align: 'center', level: 'title', sourceText: 'Ata de reunião', origin: 'machine' },
    ]);
    const result = applyBodyModel(draft, 'Ata de reunião');
    assert.equal(result.draft.documentType, 'MEETING MINUTES');
    assert.equal(result.draft.sourceTitle, 'Ata de reunião');
  });
});

const profile = {
  name: 'Helena Duarte Fictícia',
  registration: 'Matrícula JUCEFIC nº 0000',
  city: 'Vila Esperança',
  state: 'EF',
  contact: 'tradutora@exemplo.test',
};
const text = async (docx: Buffer) => {
  const zip = await JSZip.loadAsync(docx);
  const parts = await Promise.all(
    Object.keys(zip.files)
      .filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name))
      .map((name) => zip.file(name)!.async('string')),
  );
  return parts.join('\n').replace(/<[^>]+>/g, '');
};

describe('modelos de moldura do tradutor', () => {
  for (const model of FRAME_MODELS) {
    it(`"${model}" é uma máscara válida e sai no idioma da tradução`, async () => {
      const mask = new Uint8Array(await renderFrameModel(model, profile, 'pt', 'fr'));
      const inspection = await inspectMask(mask);
      assert.equal(inspection.ok, true, inspection.errors.join(' '));
      const filled = await fillMask(
        mask,
        { ...approvedTranscriptDraft, targetLanguage: 'fr' },
        { numero: '1201', livro: '7', folha: '1', data: new Date('2026-10-21T12:00:00Z'), tradutor: profile.name },
        profile.name,
        { look: { font: 'Times New Roman', fontSize: 10 } },
      );
      const content = await text(filled);
      assert.match(content, /1201/);
      assert.match(content, /HELENA DUARTE FICTÍCIA/);
      assert.match(content, /CERTIFIE/);
      assert.doesNotMatch(content, /\{\{/);
    });
  }

  it('bilíngue traz o português e o idioma da tradução', async () => {
    const content = await text(await renderFrameModel('bilingue', profile, 'pt', 'en'));
    assert.match(content, /CERTIFICO/);
    assert.match(content, /DO HEREBY CERTIFY/);
  });
});
