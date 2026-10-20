import { LANGUAGE_NAMES, longDate } from './conventions.js';
import { MARKERS } from './profiles.js';

const NOTE_LABEL: Record<Language, string> = {
  en: "Translator's note",
  pt: 'Nota do tradutor',
  fr: 'Note du traducteur',
  it: 'Nota del traduttore',
  es: 'Nota del traductor',
};

/** Marca d'água de rascunho no cabeçalho, no idioma de destino. */
export const DRAFT_MARK: Record<Language, string> = {
  en: 'DRAFT – NOT APPROVED – NOT VALID AS A TRANSLATION',
  pt: 'RASCUNHO – NÃO APROVADO – SEM VALOR COMO TRADUÇÃO',
  fr: 'BROUILLON – NON APPROUVÉ – SANS VALEUR DE TRADUCTION',
  it: 'BOZZA – NON APPROVATA – SENZA VALORE DI TRADUZIONE',
  es: 'BORRADOR – NO APROBADO – SIN VALOR COMO TRADUCCIÓN',
};
import type { Language } from './draft.js';

/** Dados do tradutor público da organização (configurados pelo Diretor; ADR-007). */
export interface TranslatorProfile {
  /** Nome completo, como assina. */
  name: string;
  /** Título em português, ex.: "Tradutora Pública e Intérprete Comercial". */
  titlePt: string;
  /** Idioma de habilitação em português, ex.: "Inglês". */
  languagePt: string;
  /** Matrícula como aparece no cabeçalho e na assinatura, ex.: "Matrícula JUCESP nº 0000". */
  registration: string;
  /** Registro em inglês para a abertura, ex.: "the Commercial Registry of the State of São Paulo (JUCESP) under No. 0000". */
  registrationEn: string;
  /** Registro em português para a abertura, ex.: "na Junta Comercial do Estado de São Paulo (JUCESP) sob o nº 0000". */
  registrationPt: string;
  city: string;
  statePt: string;
  stateEn: string;
  /** Linha extra opcional no cabeçalho (ex.: aviso de simulação). */
  letterheadNote: string | null;
  /** Linha opcional de emolumentos após o encerramento. */
  feeNote: string | null;
}

/** Numeração atribuída na aprovação; ausente em prévias de rascunho. */
export interface TranslationNumbering {
  number: number;
  year: number;
  book: number;
  sheet: number;
}

const pad = (value: number, size: number) => String(value).padStart(size, '0');

export const numberingLabel = (numbering: TranslationNumbering) => `${pad(numbering.number, 4)}/${numbering.year}`;

/** Textos fixos da tradução juramentada no idioma de destino. Os títulos do livro ficam em português, como no modelo. */
export function swornFrame(
  profile: TranslatorProfile,
  source: Language,
  target: Language,
  issuedAt: Date,
  numbering: TranslationNumbering | null,
  /** Gera o modelo de máscara: número, livro, folha e data viram marcadores ({{numero}}…), preenchidos na conclusão. */
  placeholders = false,
) {
  const number = placeholders ? '{{numero}}' : numbering ? numberingLabel(numbering) : '____/____';
  const book = placeholders ? '{{livro}}' : numbering ? pad(numbering.book, 3) : '___';
  const sheet = placeholders ? '{{folha}}' : numbering ? pad(numbering.sheet, 3) : '___';
  const date = (language: Language) => (placeholders ? '{{data}}' : longDate(issuedAt, language));
  const upperName = profile.name.toUpperCase();

  const header = [
    { text: upperName, bold: true },
    { text: `${profile.titlePt} – Idioma ${profile.languagePt} – ${profile.registration}`, bold: false },
    ...(profile.letterheadNote ? [{ text: profile.letterheadNote, bold: true }] : []),
  ];

  const titles = [`TRADUÇÃO PÚBLICA Nº ${number}`, `LIVRO Nº ${book} – FOLHA Nº ${sheet}`];

  const names = LANGUAGE_NAMES[target];
  const openings: Record<Language, string> = {
    en: `I, the undersigned, **${upperName}**, Sworn Public Translator and Commercial Interpreter for the ${LANGUAGE_NAMES.en.en} language, duly appointed and registered with ${profile.registrationEn}, **DO HEREBY CERTIFY** that I was presented with a document written in ${LANGUAGE_NAMES.en[source]}, which I faithfully translate into ${LANGUAGE_NAMES.en[target]} as follows:`,
    pt: `Eu, abaixo assinado(a), **${upperName}**, ${profile.titlePt} do idioma ${profile.languagePt.toLowerCase()}, devidamente nomeado(a) e matriculado(a) ${profile.registrationPt}, **CERTIFICO** que me foi apresentado um documento redigido em ${LANGUAGE_NAMES.pt[source]}, que fielmente traduzo para o ${LANGUAGE_NAMES.pt[target]} como segue:`,
    fr: `Je soussigné(e), **${upperName}**, Traducteur Public Juré et Interprète Commercial, dûment nommé(e) et inscrit(e) (${profile.registration}), **CERTIFIE** qu'il m'a été présenté un document rédigé en ${names[source]}, que je traduis fidèlement en ${names[target]} comme suit :`,
    it: `Io sottoscritto/a, **${upperName}**, Traduttore Pubblico Giurato e Interprete Commerciale, debitamente nominato/a e iscritto/a (${profile.registration}), **CERTIFICO** che mi è stato presentato un documento redatto in ${names[source]}, che traduco fedelmente in ${names[target]} come segue:`,
    es: `Yo, el/la abajo firmante, **${upperName}**, Traductor/a Público/a Jurado/a e Intérprete Comercial, debidamente nombrado/a e inscrito/a (${profile.registration}), **CERTIFICO** que me fue presentado un documento redactado en ${names[source]}, que traduzco fielmente al ${names[target]} como sigue:`,
  };
  const opening = openings[target];

  const documentTypeLabel = (
    { en: 'DOCUMENT TYPE', pt: 'TIPO DE DOCUMENTO', fr: 'TYPE DE DOCUMENT', it: 'TIPO DI DOCUMENTO', es: 'TIPO DE DOCUMENTO' } as const
  )[target];

  const closings: Record<Language, string> = {
    en: `**NOTHING ELSE** was contained in said document, which I have faithfully translated, checked and found to be in accordance with the original, to which I refer. **IN WITNESS WHEREOF**, I have hereunto set my hand and seal in the city of ${profile.city}, ${profile.stateEn}, Brazil, on ${date('en')}.`,
    pt: `**NADA MAIS** constava do referido documento, que fielmente traduzi, conferi e achei conforme o original, ao qual me reporto. **EM TESTEMUNHO DO QUE**, firmo a presente na cidade de ${profile.city}, ${profile.statePt}, Brasil, em ${date('pt')}.`,
    fr: `**RIEN DE PLUS** ne figurait dans ledit document, que j'ai fidèlement traduit, vérifié et trouvé conforme à l'original, auquel je me réfère. **EN FOI DE QUOI**, je signe la présente en la ville de ${profile.city}, ${profile.statePt}, Brésil, le ${date('fr')}.`,
    it: `**NIENT'ALTRO** conteneva il suddetto documento, che ho fedelmente tradotto, verificato e trovato conforme all'originale, al quale mi rimetto. **IN FEDE**, firmo la presente nella città di ${profile.city}, ${profile.statePt}, Brasile, il ${date('it')}.`,
    es: `**NADA MÁS** constaba en dicho documento, que fielmente traduje, revisé y encontré conforme al original, al cual me remito. **EN FE DE LO CUAL**, firmo la presente en la ciudad de ${profile.city}, ${profile.statePt}, Brasil, el ${date('es')}.`,
  };
  const closing = closings[target];

  const signature = [
    { text: '______________________________________', bold: false },
    { text: upperName, bold: true },
    { text: `${profile.titlePt} – ${profile.languagePt}`, bold: false },
    { text: profile.registration, bold: false },
  ];

  /** Rodapé "Tradução Pública nº … – Livro nº … – Página X de Y"; X e Y são campos de página do Word. */
  const footer = { prefix: `Tradução Pública nº ${number} – Livro nº ${book} – Página `, between: ' de ' };

  return {
    header,
    titles,
    opening,
    documentTypeLabel,
    closing,
    signature,
    footer,
    translatorNote: (text: string) => `[${NOTE_LABEL[target]}: ${text}]`,
    signatureMark: (illegible: boolean) => `[${illegible ? MARKERS[target].illegibleSignature : MARKERS[target].signature}]`,
    draftMark: DRAFT_MARK[target],
  };
}
