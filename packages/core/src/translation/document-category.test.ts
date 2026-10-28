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
  it('reconhece os tipos novos nos cinco idiomas pelo título', () => {
    for (const [title, expected] of [
      ['CERTIDÃO NEGATIVA DE NATURALIZAÇÃO', 'naturalization_certificate'],
      ['NEGATIVE CERTIFICATE OF NATURALIZATION', 'naturalization_certificate'],
      ['CERTIFICATO NEGATIVO DI NATURALIZZAZIONE', 'naturalization_certificate'],
      ['CERTIDÃO DE ANTECEDENTES CRIMINAIS', 'criminal_record'],
      ['IDENTITY HISTORY SUMMARY', 'criminal_record'],
      ['POLICE CERTIFICATE', 'criminal_record'],
      ['BULLETIN N° 3 DU CASIER JUDICIAIRE', 'criminal_record'],
      ['CERTIFICATO DEL CASELLARIO GIUDIZIALE', 'criminal_record'],
      ['CERTIFICADO DE ANTECEDENTES PENALES', 'criminal_record'],
      ['ATESTADO MÉDICO', 'medical_certificate'],
      ['CERTIFICAT MÉDICAL', 'medical_certificate'],
      ['CERTIFICADO MÉDICO OFICIAL', 'medical_certificate'],
      ['CERTIFICATE OF GOOD STANDING', 'professional_certificate'],
      ["ATTESTATION D'INSCRIPTION AU TABLEAU", 'professional_certificate'],
      ['CERTIFICADO DE COLEGIACIÓN', 'professional_certificate'],
      ['ORDEM DOS ADVOGADOS DO BRASIL – CONSELHO SECCIONAL DE SÃO PAULO', 'professional_certificate'],
      ['ESCRITURA PÚBLICA DE DIVÓRCIO CONSENSUAL', 'divorce'],
      ['JUDGMENT OF DISSOLUTION OF MARRIAGE', 'divorce'],
      ['JUGEMENT DE DIVORCE', 'divorce'],
      ['SENTENZA DI DIVORZIO', 'divorce'],
      ['PROCURAÇÃO PÚBLICA', 'power_of_attorney'],
      ['DURABLE POWER OF ATTORNEY', 'power_of_attorney'],
      ['PROCURA SPECIALE', 'power_of_attorney'],
      ['ESCRITURA DE PODER ESPECIAL', 'power_of_attorney'],
      ['PLANO DE ENSINO', 'syllabus'],
      ['COURSE SYLLABUS', 'syllabus'],
      ["PROGRAMME D'ENSEIGNEMENT", 'syllabus'],
      ['PROGRAMMA DEL CORSO', 'syllabus'],
      ['GUÍA DOCENTE', 'syllabus'],
      ['DECLARAÇÃO', 'attestation'],
      ["ATTESTATION SUR L'HONNEUR", 'attestation'],
      ['CERTIFICATE OF LIVE BIRTH', 'birth_certificate'],
      ['CERTIFICACIÓN LITERAL DE NACIMIENTO', 'birth_certificate'],
    ])
      assert.equal(suggestDocumentCategory(draft(title!), null).category, expected, title);
  });
  it('o tipo mais específico vence o que ele cita', () => {
    // A certidão de casamento com averbação de divórcio continua certidão de casamento.
    assert.equal(
      suggestDocumentCategory(draft(''), 'REGISTRO CIVIL\nCERTIDÃO DE CASAMENTO\nAverbação: Divórcio consensual em 2026').category,
      'marriage_certificate',
    );
    // A procuração qualifica a pessoa com a carteira de identidade; o atestado médico traz o Conselho Regional de Medicina.
    assert.equal(suggestDocumentCategory(draft('PROCURAÇÃO'), 'portador da Carteira de Identidade RG nº 1').category, 'power_of_attorney');
    assert.equal(
      suggestDocumentCategory(draft(''), 'CLÍNICA FICTÍCIA\nATESTADO MÉDICO\nConselho Regional de Medicina – CRM 1').category,
      'medical_certificate',
    );
    // "Procura della Repubblica" é a promotoria italiana, não uma procuração.
    assert.notEqual(suggestDocumentCategory(draft('PROCURA DELLA REPUBBLICA'), null).category, 'power_of_attorney');
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
      suggestDocumentCategory(draft('Documento avulso'), `${Array.from({ length: 8 }, () => 'Texto comum').join('\n')}\nBIRTH CERTIFICATE`)
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
