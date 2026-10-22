import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prepareSegment } from './machine/machine-draft.js';
import { checklistOf, defaultRules, effectiveRules, MODE_STAGES, outputFileName } from './profiles.js';

describe('regras das modalidades (ADR-015)', () => {
  it('datas e números conforme a skill de cada idioma de destino', () => {
    const fr = defaultRules('sworn', 'fr');
    const it_ = defaultRules('sworn', 'it');
    const es = defaultRules('sworn', 'es');
    assert.equal(prepareSegment('Nascimento: 14/03/2006, nota 8,5', 'pt', 'fr', fr), 'Nascimento: 14 mars 2006, nota 8,5');
    assert.equal(prepareSegment('Nascimento: 14/03/2006', 'pt', 'it', it_), 'Nascimento: 14/03/2006');
    assert.equal(prepareSegment('Nascimento: 14/03/2006', 'pt', 'es', es), 'Nascimento: 14 de marzo de 2006');
    assert.equal(prepareSegment('São Paulo, 15 de dezembro de 2023.', 'pt', 'it', it_), 'São Paulo, 15 dicembre 2023.');
    // Números e códigos ficam exatamente como no original (a skill ENG proíbe trocar o separador).
    assert.equal(prepareSegment('nota 8,5 e RG 12.345.678-9', 'pt', 'en', defaultRules('sworn', 'en')), 'nota 8,5 e RG 12.345.678-9');
  });

  it('padrões das skills e etapas por modalidade', () => {
    assert.equal(defaultRules('sworn', 'en').font, 'Calibri Light');
    assert.equal(defaultRules('technical', 'es').font, 'Times New Roman');
    assert.equal(defaultRules('certified', 'fr').visualElements, 'markers');
    assert.ok(defaultRules('certified', 'en').statement);
    assert.equal(outputFileName('certidao de nascimento.pdf', defaultRules('sworn', 'en')), 'certidao de nascimento - ENG.docx');
    assert.equal(outputFileName('acte.pdf', defaultRules('sworn', 'fr')), 'acte-FRA.docx');
    assert.deepEqual(MODE_STAGES.simple, ['translation', 'review']);
    const stages = (mode: 'sworn' | 'certified' | 'simple') => [
      ...new Set(checklistOf(mode, defaultRules(mode, 'en')).map((item) => item.stage)),
    ];
    assert.deepEqual(stages('sworn'), ['correction', 'review']);
    assert.deepEqual(stages('certified'), ['layout', 'review']);
    assert.deepEqual(stages('simple'), ['review']);
  });

  it('ajuste inválido do Supervisor não quebra: volta ao padrão', () => {
    assert.equal(effectiveRules('sworn', 'en', { fontSize: 11 }).fontSize, 11);
    assert.equal(effectiveRules('sworn', 'en', { fontSize: 'enorme' }).fontSize, 10);
    assert.deepEqual(effectiveRules('sworn', 'en', { checklist: { review: ['Conferi'] } }).checklist.review, ['Conferi']);
    assert.ok(effectiveRules('sworn', 'en', { checklist: { review: ['Conferi'] } }).checklist.correction.length > 0);
  });
});
