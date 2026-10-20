import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { checkDraft, numericTokens } from './checks.js';
import { convertLongDates, convertNumericDate, longDate, swapNumberSeparators } from './conventions.js';
import { structuralProblems, type Draft } from './draft.js';
import { extractPdfText } from './extract-pdf.js';
import { approvedTranscriptDraft } from './fixtures.js';

const fixture = (name: string) => new URL(`../../fixtures/historico-escolar/${name}`, import.meta.url);

describe('convenções PT↔EN', () => {
  it('converte datas, separadores e datas por extenso', () => {
    assert.equal(convertNumericDate('Nascido em 14/03/2006.', 'pt', 'en'), 'Nascido em 03/14/2006.');
    assert.equal(swapNumberSeparators('1.000,5'), '1,000.5');
    assert.equal(convertLongDates('Vila Esperança, 15 de dezembro de 2023.', 'pt', 'en'), 'Vila Esperança, December 15, 2023.');
    assert.equal(convertLongDates('on October 17, 2026', 'en', 'pt'), 'on 17 de outubro de 2026');
    assert.equal(longDate(new Date('2026-10-17T12:00:00Z'), 'pt'), '17 de outubro de 2026');
  });
});

describe('extração de PDF digital', () => {
  it('extrai o texto em linhas e separa a marca d’água inclinada', async () => {
    const extraction = await extractPdfText(new Uint8Array(await readFile(fixture('original.pdf'))));
    assert.equal(extraction.pages, 1);
    assert.equal(extraction.hasTextLayer, true);
    assert.match(extraction.text, /HISTÓRICO ESCOLAR/);
    assert.match(extraction.text, /MARIANA ALVES TEIXEIRA/);
    assert.match(extraction.text, /Língua Portuguesa/);
    assert.match(extraction.rotatedText.join(' ').replace(/\s/g, ''), /DOCUMENTOSIMULADO/);
    assert.doesNotMatch(extraction.text, /DOCUMENTO SIMULADO/);
  });
});

describe('checagens do rascunho', () => {
  it('a tradução aprovada de referência não tem números faltando em relação ao original', async () => {
    const extraction = await extractPdfText(new Uint8Array(await readFile(fixture('original.pdf'))));
    const issues = checkDraft(approvedTranscriptDraft, extraction.text);
    assert.deepEqual(
      issues.filter((issue) => issue.severity === 'error'),
      [],
    );
  });

  it('acusa nota alterada ou omitida', async () => {
    const extraction = await extractPdfText(new Uint8Array(await readFile(fixture('original.pdf'))));
    const tampered: Draft = JSON.parse(
      JSON.stringify(approvedTranscriptDraft)
        .replace('"000.123.456-7"', '"000.123.456-8"')
        .replace('RA [Student Registration No.]: 000.123.456-7', 'RA: 000.123.456-8'),
    );
    const issues = checkDraft(tampered, extraction.text);
    assert.ok(issues.some((issue) => issue.code === 'number_missing' && issue.token === '000.123.456-7'));
  });

  it('aponta termo do glossário não aplicado', () => {
    const issues = checkDraft(approvedTranscriptDraft, 'Componente: Língua Portuguesa e Educação Física', [
      { source: 'Educação Física', target: 'Physical Education' },
      { source: 'Língua Portuguesa', target: 'Portuguese Language Arts' },
    ]);
    assert.deepEqual(
      issues.map((issue) => issue.token),
      ['Língua Portuguesa'],
    );
  });

  it('valida a ocupação de colunas com mesclagens', () => {
    assert.deepEqual(structuralProblems(approvedTranscriptDraft), []);
    const broken: Draft = JSON.parse(JSON.stringify(approvedTranscriptDraft));
    const table = broken.blocks.find((block) => block.kind === 'table');
    if (table?.kind === 'table') table.rows[0]!.cells.pop();
    assert.equal(structuralProblems(broken).length, 1);
  });

  it('ignora inteiros curtos ao listar números', () => {
    assert.deepEqual(numericTokens('Nota 8,5 em 2021, turma 3, CH 80, RG 12.345.678-9'), ['8,5', '2021', '12.345.678-9']);
  });
});

describe('extração de DOCX', () => {
  it('lê parágrafos, tabelas, cabeçalho e rodapé do Word', async () => {
    const { extractOfficeText } = await import('./extract-office.js');
    const extraction = await extractOfficeText(new Uint8Array(await readFile(fixture('esperado.docx'))), 'docx');
    assert.equal(extraction.hasTextLayer, true);
    assert.match(extraction.text, /^\[Cabeçalho\] ANA BEATRIZ MOREIRA LIMA/);
    assert.match(extraction.text, /SCHOOL TRANSCRIPT \[Histórico Escolar\]/);
    assert.match(extraction.text, /Portuguese Language \| 8\.5 \| 160 \| 8\.0 \| 160 \| 8\.7 \| 160/);
    assert.match(extraction.text, /\[Rodapé\] Tradução Pública nº 0001\/2026/);
  });
});
