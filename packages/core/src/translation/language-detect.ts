import { LANGUAGES, type Language } from './draft.js';

/**
 * Idioma de um trecho por palavras funcionais e terminações típicas (sem serviço externo). Serve para a revisão
 * automática achar trechos que ficaram no idioma errado; nomes, endereços e códigos não têm palavras funcionais e
 * ficam sem idioma.
 */
const WORDS: Record<Language, string[]> = {
  pt: [
    'de',
    'da',
    'do',
    'das',
    'dos',
    'e',
    'que',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'para',
    'com',
    'por',
    'um',
    'uma',
    'os',
    'as',
    'ao',
    'aos',
    'não',
    'é',
    'foi',
    'são',
    'pelo',
    'pela',
    'seu',
    'sua',
    'este',
    'esta',
    'nascido',
    'nascida',
    'data',
    'nome',
    'filho',
    'filha',
    'certidão',
    'cartório',
    'registro',
    'pagamento',
    'valor',
    'até',
    'também',
    'já',
  ],
  en: [
    'the',
    'of',
    'and',
    'to',
    'in',
    'is',
    'for',
    'on',
    'with',
    'by',
    'at',
    'this',
    'that',
    'was',
    'are',
    'as',
    'from',
    'be',
    'has',
    'have',
    'which',
    'date',
    'born',
    'name',
    'son',
    'daughter',
    'certificate',
    'registry',
    'payment',
    'amount',
    'due',
    'issued',
    'birth',
    'not',
    'or',
    'an',
  ],
  fr: [
    'le',
    'la',
    'les',
    'des',
    'du',
    'de',
    'et',
    'en',
    'un',
    'une',
    'pour',
    'par',
    'sur',
    'dans',
    'est',
    'au',
    'aux',
    'que',
    'qui',
    'ce',
    'cette',
    'né',
    'née',
    'avec',
    'nom',
    'fils',
    'fille',
    'acte',
    'naissance',
    'paiement',
    'montant',
    'date',
    'délivré',
    'ou',
    'pas',
    'sont',
    'été',
  ],
  it: [
    'il',
    'lo',
    'la',
    'gli',
    'le',
    'di',
    'del',
    'della',
    'dei',
    'delle',
    'e',
    'che',
    'in',
    'per',
    'con',
    'un',
    'una',
    'è',
    'sono',
    'nel',
    'nella',
    'al',
    'alla',
    'questo',
    'questa',
    'nato',
    'nata',
    'nome',
    'figlio',
    'figlia',
    'atto',
    'nascita',
    'pagamento',
    'importo',
    'data',
    'rilasciato',
    'o',
    'non',
    'stato',
  ],
  es: [
    'el',
    'la',
    'los',
    'las',
    'de',
    'del',
    'y',
    'que',
    'en',
    'por',
    'para',
    'con',
    'un',
    'una',
    'es',
    'son',
    'al',
    'este',
    'esta',
    'nacido',
    'nacida',
    'fecha',
    'nombre',
    'hijo',
    'hija',
    'acta',
    'nacimiento',
    'pago',
    'importe',
    'expedido',
    'o',
    'no',
    'fue',
    'sus',
  ],
};

/** Terminações e letras que quase só um idioma usa. */
const HINTS: Record<Language, RegExp[]> = {
  pt: [/ção\b/g, /ções\b/g, /ões\b/g, /[ãõ]/g, /\blh/g, /nh[aeiou]/g],
  en: [/\bth/g, /'s\b/g, /tion\b/g, /\bw[ha]/g, /ing\b/g],
  fr: [/\b[ldjnqs]'/g, /eau\b/g, /[èêë]/g, /\bç/g, /ée?s?\b/g],
  it: [/zione\b/g, /zioni\b/g, /\bgli\b/g, /[àìòù]\b/g, /cch|gn[aeiou]/g],
  es: [/ñ/g, /ción\b/g, /ciones\b/g, /\bll/g, /¿|¡/g],
};

const WEIGHTS = (() => {
  const counts = new Map<string, number>();
  for (const words of Object.values(WORDS)) for (const word of new Set(words)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
})();

export interface DetectedLanguage {
  language: Language | null;
  /** Pontuação do idioma mais provável e do segundo. */
  score: number;
  runnerUp: number;
  words: number;
}

export function detectLanguage(text: string): DetectedLanguage {
  const lower = text.normalize('NFC').toLowerCase().replace(/\*\*/g, '');
  const words = lower.match(/\p{L}+(?:'\p{L}+)?/gu) ?? [];
  const scores = new Map<Language, number>(LANGUAGES.map((language) => [language, 0]));
  for (const language of LANGUAGES) {
    const vocabulary = new Set(WORDS[language]);
    let score = 0;
    for (const word of words) if (vocabulary.has(word)) score += 1 / (WEIGHTS.get(word) ?? 1);
    for (const hint of HINTS[language]) score += (lower.match(hint)?.length ?? 0) * 0.6;
    scores.set(language, score);
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  const [best, second] = [ranked[0]!, ranked[1]!];
  return { language: best[1] > 0 ? best[0] : null, score: best[1], runnerUp: second[1], words: words.length };
}

/** Idioma só quando há texto suficiente e um vencedor claro; trechos curtos ou ambíguos voltam `null`. */
export function confidentLanguage(text: string, minWords = 4): Language | null {
  const result = detectLanguage(text);
  if (result.words < minWords || result.score < 1.5 || result.score < result.runnerUp * 1.5) return null;
  return result.language;
}
