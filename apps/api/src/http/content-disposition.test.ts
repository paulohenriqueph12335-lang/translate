import assert from 'node:assert/strict';
import { it } from 'node:test';
import { contentDisposition } from './content-disposition.js';

it('gera Content-Disposition seguro com nome UTF-8', () => {
  const header = contentDisposition('Relatório "final"; v2.pdf');
  assert.equal(header, `attachment; filename="Relatorio _final__ v2.pdf"; filename*=UTF-8''Relat%C3%B3rio%20%22final%22%3B%20v2.pdf`);
  assert.doesNotMatch(contentDisposition('a\r\nSet-Cookie: x'), /[\r\n]/);
});
