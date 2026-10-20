import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import JSZip from 'jszip';
import { approvedTranscriptDraft, fictitiousTranslator } from './fixtures.js';
import { renderSwornDocx } from './render-docx.js';

const fixture = (name: string) => new URL(`../../fixtures/historico-escolar/${name}`, import.meta.url);

/** Textos não vazios dos parágrafos de cada parte do DOCX, na ordem do documento (inclui células de tabela). */
async function paragraphs(docx: Buffer) {
  const zip = await JSZip.loadAsync(docx);
  const texts = async (part: string) => {
    const xml = await zip.file(part)?.async('string');
    if (!xml) return [];
    return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
      .map((match) =>
        [...match[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
          .map((text) => text[1]!)
          .join('')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>'),
      )
      .filter((text) => text.trim());
  };
  const headerPart = Object.keys(zip.files).find((name) => /^word\/header\d*\.xml$/.test(name))!;
  const footerPart = Object.keys(zip.files).find((name) => /^word\/footer\d*\.xml$/.test(name))!;
  return { header: await texts(headerPart), body: await texts('word/document.xml'), footer: await texts(footerPart) };
}

const numbering = { number: 1, year: 2026, book: 1, sheet: 1 };
const issuedAt = new Date('2026-10-17T12:00:00Z');

describe('DOCX da tradução juramentada', () => {
  it('reproduz o texto do modelo esperado, parágrafo por parágrafo', async () => {
    const expected = await paragraphs(await readFile(fixture('esperado.docx')));
    const rendered = await paragraphs(
      await renderSwornDocx(approvedTranscriptDraft, { profile: fictitiousTranslator, issuedAt, numbering }),
    );
    assert.deepEqual(rendered.header, expected.header);
    assert.deepEqual(rendered.body, expected.body);
    // O rodapé do modelo tem "Página 1 de 1" fixo; o gerado usa campos do Word para página e total.
    assert.equal(rendered.footer[0]?.startsWith('Tradução Pública nº 0001/2026 – Livro nº 001 – Página '), true);
  });

  it('prévia sem numeração é marcada como rascunho não aprovado', async () => {
    const rendered = await paragraphs(
      await renderSwornDocx(approvedTranscriptDraft, { profile: fictitiousTranslator, issuedAt, numbering: null }),
    );
    assert.ok(rendered.header.includes('DRAFT – NOT APPROVED – NOT VALID AS A TRANSLATION'));
    assert.equal(rendered.body[0], 'TRADUÇÃO PÚBLICA Nº ____/____');
  });

  it('usa a moldura em português quando o destino é português', async () => {
    const draft = { ...approvedTranscriptDraft, sourceLanguage: 'en' as const, targetLanguage: 'pt' as const, blocks: [] };
    const rendered = await paragraphs(await renderSwornDocx(draft, { profile: fictitiousTranslator, issuedAt, numbering }));
    assert.match(
      rendered.body[2]!,
      /^Eu, abaixo assinado\(a\), ANA BEATRIZ MOREIRA LIMA, .*redigido em inglês, que fielmente traduzo para o português/,
    );
    assert.equal(rendered.body[3], 'TIPO DE DOCUMENTO: SCHOOL TRANSCRIPT');
    assert.match(rendered.body[4]!, /^NADA MAIS constava .* em 17 de outubro de 2026\.$/);
  });
});
