import type { Queryable } from '../db/pool.js';
import type { Language } from './draft.js';

/**
 * Glossários das skills de tradução da organização (ADR-015), do português para cada idioma. Quando a skill dá duas
 * opções ("A / B"), a primeira vira o termo e a outra fica na observação, porque o glossário entra no texto como está.
 */
export interface SkillTerm {
  source: string;
  target: string;
  note?: string;
}

const ENG: SkillTerm[] = [
  { source: 'Certidão de Nascimento', target: 'Birth Certificate', note: 'Também: Full Birth Certificate (inteiro teor)' },
  { source: 'Certidão de Casamento', target: 'Marriage Certificate', note: 'Também: Full Marriage Certificate (inteiro teor)' },
  { source: 'Certidão de Óbito', target: 'Death Certificate' },
  { source: 'Certidão de Antecedentes Criminais', target: 'Criminal Record Certificate' },
  { source: 'Certidão Negativa de Naturalização', target: 'Negative Certificate of Naturalization' },
  { source: 'Procuração', target: 'Power of Attorney' },
  { source: 'Procuração Ad Judicia', target: 'Power of Attorney Ad Judicia' },
  { source: 'Ministério da Justiça e Segurança Pública', target: 'Ministry of Justice and Public Security' },
  { source: 'Polícia Federal', target: 'Federal Police' },
  { source: 'Departamento de Migrações', target: 'Department of Migrations' },
  { source: 'Receita Federal', target: 'Federal Revenue Service' },
  { source: 'Cartório de Registro Civil', target: 'Civil Registry Office' },
  { source: 'Oficial', target: 'Officer', note: 'No sentido de oficial do cartório' },
  { source: 'Escrevente', target: 'Clerk' },
  { source: 'Matrícula', target: 'Registration Number' },
  { source: 'Selo Digital de Emissão Digital', target: 'Issuance Seal' },
  { source: 'Selo Digital de Materialização Digital', target: 'Materialization Seal' },
  { source: 'Código de Validação', target: 'Validation Code' },
  { source: 'Não consta', target: 'No record found', note: 'Também: Does not appear' },
  { source: 'Doméstica (empregada)', target: 'Maid', note: 'Também: Domestic Worker' },
  { source: 'Doméstica (dona de casa)', target: 'Housewife', note: 'Também: Homemaker' },
  { source: 'Lavrador', target: 'Farmer', note: 'Também: Agricultural Worker' },
  { source: 'Agricultor', target: 'Farmer', note: 'Também: Agricultural Worker' },
  { source: 'Divórcio Litigioso', target: 'Litigious Divorce', note: 'Também: Contested Divorce' },
  { source: 'CPF', target: 'CPF (Brazilian Individual Taxpayer Registry)' },
  { source: 'Dou fé', target: 'In witness whereof', note: 'Também: I certify' },
  { source: 'O conteúdo é verdadeiro. Dou fé', target: 'The content is true. In witness whereof' },
  { source: 'Não foi localizado', target: 'No record was found', note: 'Também: Was not located' },
  { source: 'Esta certidão é válida por', target: 'This certificate is valid for' },
  { source: 'Certidão emitida', target: 'Certificate issued' },
  { source: 'A autenticidade do documento', target: 'The authenticity of the document' },
];

const FRA: SkillTerm[] = [
  { source: 'Ministério da Justiça', target: 'Ministère de la Justice' },
  {
    source: 'Certidão de Antecedentes Criminais',
    target: 'Certificat de Casier Judiciaire',
    note: 'Também: Bulletin de Casier Judiciaire',
  },
  { source: 'Trânsito em julgado', target: 'Autorité de la chose jugée', note: 'Também: Décision définitive' },
  { source: 'Vara de Família e Sucessões', target: 'Tribunal des Affaires Familiales et des Successions' },
  { source: 'Agravo de Instrumento', target: 'Appel Intermédiaire' },
  { source: 'Requerente', target: 'Requérant(e)' },
  { source: 'Agravante', target: 'Appelant(e)' },
  { source: 'Requerido(a)', target: 'Intimé(e)' },
  { source: 'Agravado(a)', target: 'Intimé(e)' },
];

const ITA: SkillTerm[] = [
  { source: 'Certidão', target: 'Certificato' },
  { source: 'Certidão Negativa', target: 'Certificato Negativo' },
  { source: 'Certidão de Antecedentes Criminais', target: 'Certificato di Precedenti Penali' },
  { source: 'Certidão de Nascimento', target: 'Certificato di Nascita' },
  { source: 'Certidão de Casamento', target: 'Certificato di Matrimonio' },
  { source: 'Certidão de Inteiro Teor', target: 'Certificato Integrale' },
  { source: 'Procuração', target: 'Procura' },
  { source: 'Procurador', target: 'Procuratore' },
  { source: 'Polícia Federal', target: 'Polizia Federale' },
  { source: 'Ministério da Justiça', target: 'Ministero della Giustizia' },
  { source: 'Secretaria Nacional de Justiça', target: 'Segreteria Nazionale di Giustizia' },
  { source: 'Departamento de Migrações', target: 'Dipartimento di Migrazioni' },
  { source: 'Reconhecimento de firma', target: 'Riconoscimento di firma' },
  { source: 'Apostille', target: 'Apostille' },
  { source: 'Jure sanguinis', target: 'Jure sanguinis' },
  { source: 'Cidadania italiana', target: 'Cittadinanza italiana' },
  { source: 'Escrevente', target: 'Escrivente' },
  { source: 'Tabelião', target: 'Notaio' },
  { source: 'Cartório', target: 'Cartorio' },
  { source: 'Registro Civil', target: 'Registro Civile' },
  { source: 'Emolumentos', target: 'Emolumenti' },
  { source: 'Custas', target: 'Spese' },
  { source: 'Assinatura eletrônica', target: 'Firma Elettronica' },
  { source: 'Não consta', target: 'Non consta', note: 'Exemplo da skill: "NON CONSTA" em negrito como no original' },
];

const ESP: SkillTerm[] = [
  { source: 'Certidão de Nascimento', target: 'Certificado de Nacimiento', note: 'Também: Certificado Íntegro del Acta de Nacimiento' },
  { source: 'Certidão de Casamento', target: 'Certificado Íntegro del Acta de Matrimonio' },
  { source: 'Certidão de Óbito', target: 'Certificado de Defunción' },
  { source: 'Certidão de Antecedentes Criminais', target: 'Certificado de Antecedentes Penales' },
  { source: 'Certidão Negativa de Naturalização', target: 'Certificado Negativo de Naturalización' },
  { source: 'Procuração', target: 'Poder Notarial' },
  { source: 'Procuração Ad Judicia', target: 'Poder Notarial Ad Judicia' },
  { source: 'Ministério da Justiça e Segurança Pública', target: 'Ministerio de Justicia y Seguridad Pública' },
  { source: 'Polícia Federal', target: 'Policía Federal' },
  { source: 'Departamento de Migrações', target: 'Departamento de Migraciones' },
  { source: 'Receita Federal', target: 'Agencia de Ingresos' },
  { source: 'Cartório de Registro Civil', target: 'Oficina de Estado Civil de las Personas Naturales' },
  { source: 'Oficial', target: 'Oficial' },
  { source: 'Escrevente', target: 'Empleado/a' },
  { source: 'Matrícula', target: 'Registro' },
  { source: 'Selo Digital de Emissão', target: 'Sello Digital de Emisión' },
  { source: 'Selo Digital de Materialização', target: 'Sello Digital de Materialización' },
  { source: 'Código de Validação', target: 'Código Validador' },
  { source: 'Não consta', target: 'No consta' },
  { source: 'Doméstica (empregada)', target: 'Empleada doméstica' },
  { source: 'Doméstica (dona de casa)', target: 'Ama de casa' },
  { source: 'Lavrador', target: 'Agricultor' },
  { source: 'Agricultor', target: 'Agricultor' },
  { source: 'Divórcio Litigioso', target: 'Divorcio Contencioso' },
  { source: 'CPF', target: 'CPF (Código de Identificación Fiscal brasileño)' },
  { source: 'Dou fé', target: 'Doy fe' },
  { source: 'O conteúdo é verdadeiro. Dou fé', target: 'Lo anterior es verdadero. Doy fe' },
  { source: 'Não foi localizado', target: 'No fue localizado' },
  { source: 'Esta certidão é válida por', target: 'Este certificado es válido por' },
  { source: 'Certidão emitida', target: 'Certificado emitido' },
  { source: 'A autenticidade do documento', target: 'La autenticidad del documento' },
];

/** Glossário das skills por idioma de destino (origem: português). */
export const SKILL_GLOSSARY: Array<{ target: Language; skill: string; terms: SkillTerm[] }> = [
  { target: 'en', skill: 'traducao-eng', terms: ENG },
  { target: 'fr', skill: 'traducao-fra', terms: FRA },
  { target: 'it', skill: 'traducao-ita', terms: ITA },
  { target: 'es', skill: 'traducao-espanhol', terms: ESP },
];

/**
 * Coloca o glossário das skills no glossário da organização, se ainda não estiver (idempotente). Precisa de um Diretor
 * para registrar a autoria; sem Diretor (instalação nova), não faz nada e roda de novo na próxima migração.
 */
export async function seedSkillGlossary(db: Queryable) {
  const director = (await db.query<{ id: string }>(`SELECT id FROM users WHERE org_role = 'director' ORDER BY created_at LIMIT 1`)).rows[0];
  if (!director) return 0;
  const rows = SKILL_GLOSSARY.flatMap(({ target, skill, terms }) =>
    terms.map((term) => ({
      target,
      source_term: term.source,
      target_term: term.target,
      note: term.note ?? null,
      origin: `Skill ${skill}`,
    })),
  );
  const result = await db.query(
    `INSERT INTO glossary_entries (source_language, target_language, source_term, target_term, note, team_id, created_by, origin)
     SELECT 'pt', row.target, row.source_term, row.target_term, row.note, NULL, $1, row.origin
       FROM jsonb_to_recordset($2::jsonb) AS row(target text, source_term text, target_term text, note text, origin text)
     ON CONFLICT DO NOTHING`,
    [director.id, JSON.stringify(rows)],
  );
  return result.rowCount ?? 0;
}
