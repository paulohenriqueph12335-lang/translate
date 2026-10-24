import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { suggestDocumentCategory } from './body-models.js';
import type { Draft } from './draft.js';

const draft = (sourceTitle: string): Draft => ({ sourceLanguage: 'fr', targetLanguage: 'es', documentType: '', sourceTitle, blocks: [] });
describe('classificação documental explicável', () => {
  it('identifica títulos em idiomas variados com evidência forte', () => {
    for (const [title, expected] of [
      ['ACTE DE NAISSANCE', 'birth_certificate'],
      ['CERTIFICATO DI NASCITA', 'birth_certificate'],
      ['DIPLÔME', 'diploma'],
      ['APOSTILLA', 'apostille'],
      ['RELEVÉ DE NOTES', 'school_record'],
      ['CONTRATO', 'contract'],
      ["CERTIFICAT D'INSCRIPTION", 'professional_certificate'],
      ['CERTIFICADO DE INSCRIPCIÓN', 'professional_certificate'],
    ])
      assert.deepEqual(suggestDocumentCategory(draft(title!), null), { category: expected, confidence: 95, basis: 'title' });
  });
  it('diferencia título, começo do texto e caso inconclusivo', () => {
    assert.deepEqual(suggestDocumentCategory(draft('Document original'), 'ACTA DE MATRIMONIO\nDados'), {
      category: 'marriage_certificate',
      confidence: 70,
      basis: 'opening_text',
    });
    assert.deepEqual(suggestDocumentCategory(draft('Documento desconhecido'), 'Texto sem indícios confiáveis'), {
      category: 'generic',
      confidence: 0,
      basis: 'unrecognized',
    });
    assert.equal(
      suggestDocumentCategory(draft('Declaração'), `${Array.from({ length: 8 }, () => 'Texto comum').join('\n')}\nBIRTH CERTIFICATE`)
        .category,
      'generic',
    );
  });
  it('reduz a confiança quando o título reúne tipos diferentes', () => {
    assert.deepEqual(suggestDocumentCategory(draft('APOSTILLE — BIRTH CERTIFICATE'), null), {
      category: 'apostille',
      confidence: 80,
      basis: 'title',
    });
  });
});
