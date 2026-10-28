import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { archiveBaseName } from './archive.js';

/** Nome de cada tradução no ZIP (2026-10-28): número e protocolo; sem número, a referência sequencial. */
describe('nome da tradução no ZIP', () => {
  it('número e protocolo, quando há os dois', () => {
    assert.equal(archiveBaseName({ number_label: '0012/2026', protocol: 'ABC-1', reference_number: '7' }), '0012-2026 – ABC-1');
  });

  it('só número, só protocolo ou nenhum dos dois', () => {
    assert.equal(archiveBaseName({ number_label: '501', protocol: null, reference_number: 7 }), '501');
    assert.equal(archiveBaseName({ number_label: null, protocol: 'ABC-1', reference_number: 7 }), 'ABC-1 – Tradução 7');
    assert.equal(archiveBaseName({ number_label: null, protocol: null, reference_number: '42' }), 'Tradução 42');
  });

  it('caracteres proibidos em nome de arquivo não passam', () => {
    assert.equal(archiveBaseName({ number_label: null, protocol: 'A:B*C', reference_number: 1 }), 'A_B_C – Tradução 1');
  });
});
