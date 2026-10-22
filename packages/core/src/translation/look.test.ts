import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import JSZip from 'jszip';
import { approvedTranscriptDraft } from './fixtures.js';
import { fillMask, renderMaskTemplate } from './mask/fill-mask.js';
import { defaultRules } from './profiles.js';
import { renderPlainDocx } from './render-docx.js';

/** Fontes e tamanhos (em pontos) usados no corpo do documento, e dentro das tabelas. */
async function look(docx: Buffer) {
  const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
  const sizes = (part: string) => [...new Set([...part.matchAll(/<w:sz w:val="(\d+)"\/>/g)].map((match) => Number(match[1]) / 2))].sort();
  const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((match) => match[0]).join('');
  return {
    fonts: [...new Set([...xml.matchAll(/w:ascii="([^"]+)"/g)].map((match) => match[1]))],
    sizes: sizes(xml),
    tableSizes: sizes(tables),
    banner: /DRAFT – NOT APPROVED/.test(xml),
  };
}

const values = { numero: '1201', livro: '7', folha: '1', data: new Date('2026-10-21T12:00:00Z'), tradutor: 'X' };

describe('fonte e tamanho da regra em todo o documento (skills)', () => {
  it('juramentada com máscara: o conteúdo sai em Calibri Light 10 para o inglês, inclusive as tabelas', async () => {
    const mask = new Uint8Array(await renderMaskTemplate('en'));
    const rules = defaultRules('sworn', 'en');
    const result = await look(await fillMask(mask, approvedTranscriptDraft, values, 'X', { look: rules }));
    assert.ok(result.fonts.includes('Calibri Light'), JSON.stringify(result.fonts));
    assert.deepEqual(result.tableSizes, [10]);
    assert.ok(result.sizes.includes(10));
    assert.equal(result.banner, false);
  });

  it('prévia com o número previsto continua marcada como rascunho', async () => {
    const mask = new Uint8Array(await renderMaskTemplate('en'));
    const result = await look(
      await fillMask(mask, approvedTranscriptDraft, values, 'X', { look: defaultRules('sworn', 'en'), draft: true }),
    );
    assert.equal(result.banner, true);
  });

  it('sem máscara: Times New Roman 10 nos demais idiomas, títulos, linhas de apoio e tabelas no mesmo tamanho', async () => {
    const draft = { ...approvedTranscriptDraft, targetLanguage: 'fr' as const };
    const rules = defaultRules('certified', 'fr');
    const result = await look(
      await renderPlainDocx(draft, { look: rules, draft: false, statement: null, translatorName: null, issuedAt: new Date() }),
    );
    assert.deepEqual(result.fonts, ['Times New Roman']);
    assert.deepEqual(result.tableSizes, [10]);
    // Só o rodapé com o número da página é menor que o corpo.
    assert.ok(
      result.sizes.every((size) => size === 10 || size === 8),
      JSON.stringify(result.sizes),
    );
  });
});
