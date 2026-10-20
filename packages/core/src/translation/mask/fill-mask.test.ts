import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import JSZip from 'jszip';
import { approvedTranscriptDraft } from '../fixtures.js';
import { fillMask, inspectMask, renderMaskTemplate } from './fill-mask.js';

const documentXml = async (docx: Uint8Array) => (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
const allText = async (docx: Uint8Array) => {
  const zip = await JSZip.loadAsync(docx);
  const parts = Object.keys(zip.files).filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(name));
  return (await Promise.all(parts.map((name) => zip.file(name)!.async('string'))))
    .join('\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&');
};

/** Reescreve o XML de uma parte (para simular o que o Word faz com os marcadores). */
async function rewrite(docx: Uint8Array, part: string, change: (xml: string) => string) {
  const zip = await JSZip.loadAsync(docx);
  zip.file(part, change(await zip.file(part)!.async('string')));
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer' }));
}

const values = {
  numero: '0007/2026',
  livro: '002',
  folha: '015',
  data: new Date('2026-10-18T12:00:00Z'),
  tradutor: 'ANA BEATRIZ MOREIRA LIMA',
};

describe('máscara do tradutor juramentado (ADR-012)', () => {
  it('o modelo gerado pelo sistema é uma máscara válida com os marcadores principais', async () => {
    const template = new Uint8Array(await renderMaskTemplate('en'));
    const inspection = await inspectMask(template);
    assert.equal(inspection.ok, true, inspection.errors.join('; '));
    const names = new Set(inspection.markers.map((marker) => marker.name));
    for (const name of ['texto', 'numero', 'livro', 'folha', 'data', 'tipo', 'tradutor']) assert.ok(names.has(name), name);
    assert.ok(inspection.markers.some((marker) => marker.name === 'numero' && marker.part.startsWith('footer')));
  });

  it('preenche corpo, cabeçalho e rodapé e insere o documento no lugar de {{texto}}', async () => {
    const template = new Uint8Array(await renderMaskTemplate('en'));
    const filled = new Uint8Array(await fillMask(template, approvedTranscriptDraft, values, 'ANA BEATRIZ MOREIRA LIMA'));
    const text = await allText(filled);
    assert.doesNotMatch(text, /\{\{/);
    assert.match(text, /TRADUÇÃO PÚBLICA Nº 0007\/2026/);
    assert.match(text, /LIVRO Nº 002 – FOLHA Nº 015/);
    assert.match(text, /October 18, 2026/);
    assert.match(text, /DOCUMENT TYPE: SCHOOL TRANSCRIPT/);
    assert.match(text, /SCHOOL TRANSCRIPT \[Histórico Escolar\]/);
    assert.match(text, /\[Translator's note: /);
    assert.match(text, /ANA BEATRIZ MOREIRA LIMA/);
    assert.match(text, /Tradução Pública nº 0007\/2026/);
    assert.doesNotMatch(text, /DRAFT/);
  });

  it('tabelas entram com a grade, as mesclagens e a largura útil da página da máscara', async () => {
    const template = new Uint8Array(await renderMaskTemplate('en'));
    const xml = await documentXml(await fillMask(template, approvedTranscriptDraft, values, 'X'));
    const tables = approvedTranscriptDraft.blocks.filter((block) => block.kind === 'table');
    assert.equal((xml.match(/<w:tbl>/g) ?? []).length, tables.length);
    const restarts = (xml.match(/<w:vMerge w:val="restart"\/>/g) ?? []).length;
    const continues = (xml.match(/<w:vMerge\/>/g) ?? []).length;
    const expected = tables.flatMap((table) => (table.kind === 'table' ? table.rows.flatMap((row) => row.cells) : []));
    assert.equal(restarts, expected.filter((cell) => cell.rowSpan > 1).length);
    assert.equal(
      continues,
      expected.reduce((sum, cell) => sum + Math.max(0, cell.rowSpan - 1), 0),
    );
    // A4 com margens de 2 cm: 11906 − 2 × 1134.
    assert.match(xml, /<w:tblW w:w="9638" w:type="dxa"\/>/);
  });

  it('marcador partido pelo Word em vários trechos é trocado sem perder a formatação dos trechos', async () => {
    const template = new Uint8Array(await renderMaskTemplate('en'));
    const split = await rewrite(template, 'word/document.xml', (xml) =>
      xml.replace(
        /<w:t xml:space="preserve">TRADUÇÃO PÚBLICA Nº \{\{numero\}\}<\/w:t>/,
        '<w:t xml:space="preserve">TRADUÇÃO PÚBLICA Nº {{nu</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>mer</w:t></w:r><w:r><w:t>o}}</w:t>',
      ),
    );
    assert.match(await documentXml(split), /\{\{nu<\/w:t>/);
    const xml = await documentXml(await fillMask(split, approvedTranscriptDraft, values, 'X'));
    assert.match(xml, /TRADUÇÃO PÚBLICA Nº 0007\/2026<\/w:t>/);
    assert.match(xml, /<w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve"><\/w:t>/);
    assert.doesNotMatch(xml, /\{\{|o\}\}/);
  });

  it('o texto herda a fonte do parágrafo de {{texto}}; o resto da máscara fica igual', async () => {
    const template = new Uint8Array(await renderMaskTemplate('en'));
    const styled = await rewrite(template, 'word/document.xml', (xml) =>
      xml.replace(/(<w:r>)(<w:rPr>)?([^]*?)(<w:t xml:space="preserve">\{\{texto\}\}<\/w:t>)/, (_m, run, _rpr, rest, text) => {
        const cleaned = String(rest).replace(/<\/w:rPr>$/, '');
        return `${run}<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>${text}`.replace(cleaned, '');
      }),
    );
    const before = await documentXml(styled);
    const xml = await documentXml(await fillMask(styled, approvedTranscriptDraft, values, 'X'));
    assert.match(xml, /<w:rFonts w:ascii="Arial" w:hAnsi="Arial"\/><w:b\/><w:bCs\/><w:sz w:val="26"\/>/);
    // Tudo antes do primeiro bloco inserido continua idêntico, exceto os marcadores trocados.
    const head = before.slice(0, before.indexOf('DOCUMENT TYPE'));
    assert.ok(xml.startsWith(head.slice(0, 2000)));
  });

  it('prévia: número em branco e aviso de rascunho; máscara sem {{texto}} é recusada', async () => {
    // O aviso sai no idioma da tradução (o rascunho de referência é PT → EN).
    const template = new Uint8Array(await renderMaskTemplate('en'));
    const preview = await allText(new Uint8Array(await fillMask(template, approvedTranscriptDraft, null, 'X')));
    assert.match(preview, /DRAFT – NOT APPROVED/);
    assert.match(preview, /TRADUÇÃO PÚBLICA Nº ____/);
    const broken = await rewrite(template, 'word/document.xml', (xml) => xml.replace('{{texto}}', 'texto'));
    const inspection = await inspectMask(broken);
    assert.equal(inspection.ok, false);
    // Continua sendo um Word: pode ser guardado e configurado depois.
    assert.equal(inspection.isWord, true);
    assert.match(inspection.errors[0]!, /\{\{texto\}\}/);
    assert.equal((await inspectMask(new Uint8Array([1, 2, 3]))).isWord, false);
    assert.match((await inspectMask(new TextEncoder().encode('%PDF-1.4'))).errors[0]!, /PDF não é aceito/);
  });
});
