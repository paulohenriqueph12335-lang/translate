import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linesFromTsv, ocrDocument, ocrLanguages } from './ocr.js';

const row = (block: number, line: number, left: number, width: number, conf: number, text: string) =>
  ['5', '1', String(block), '1', String(line), '1', String(left), '100', String(width), '20', String(conf), text].join('\t');

describe('OCR (Tesseract)', () => {
  it('monta as linhas na ordem e separa colunas distantes com espaço largo', () => {
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      row(1, 1, 300, 80, 95, 'NASCIMENTO'),
      row(1, 1, 100, 180, 91, 'CERTIDÃO DE'),
      row(1, 2, 100, 60, 90, 'Nome'),
      row(1, 2, 400, 200, 88, 'MARIANA'),
      row(1, 2, 610, 150, 86, 'TEIXEIRA'),
      ['4', '1', '1', '1', '2', '0', '0', '0', '0', '0', '-1', ''].join('\t'),
    ].join('\n');
    const result = linesFromTsv(tsv);
    assert.equal(result.text, 'CERTIDÃO DE NASCIMENTO\nNome  MARIANA TEIXEIRA');
    assert.equal(Math.round(result.confidence), 90);
  });

  it('sem Tesseract instalado, segue sem OCR (sem erro)', async () => {
    if (await ocrLanguages()) return;
    assert.equal(await ocrDocument(new Uint8Array([1, 2, 3]), 'png', 'pt'), null);
  });
});
