import type { Language } from './draft.js';

/**
 * Convenções de formato por idioma (ADR-007, ADR-015): meses, datas por extenso, separador decimal, ordem das datas
 * numéricas. Servem às checagens determinísticas e ao preparo dos trechos para a tradução automática.
 */

const MONTHS: Record<Language, string[]> = {
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};

/** Nome de cada idioma escrito em cada idioma: LANGUAGE_NAMES[em][de qual]. */
export const LANGUAGE_NAMES: Record<Language, Record<Language, string>> = {
  pt: { pt: 'português', en: 'inglês', fr: 'francês', it: 'italiano', es: 'espanhol' },
  en: { pt: 'Portuguese', en: 'English', fr: 'French', it: 'Italian', es: 'Spanish' },
  fr: { pt: 'portugais', en: 'anglais', fr: 'français', it: 'italien', es: 'espagnol' },
  it: { pt: 'portoghese', en: 'inglese', fr: 'francese', it: 'italiano', es: 'spagnolo' },
  es: { pt: 'portugués', en: 'inglés', fr: 'francés', it: 'italiano', es: 'español' },
};

/** Só o inglês usa ponto decimal e data mês/dia; os demais, vírgula e dia/mês. */
const usesDecimalPoint = (language: Language) => language === 'en';

/** Data por extenso no idioma: "17 de outubro de 2026", "October 17, 2026", "17 octobre 2026", "17 ottobre 2026", "17 de octubre de 2026". */
export function longDate(date: Date, language: Language) {
  return formatLong(date.getUTCDate(), date.getUTCMonth(), date.getUTCFullYear(), language);
}

function formatLong(day: number, month: number, year: number, language: Language) {
  const name = MONTHS[language][month]!;
  switch (language) {
    case 'en':
      return `${name} ${day}, ${year}`;
    case 'fr':
      return `${day === 1 ? '1er' : day} ${name} ${year}`;
    case 'it':
      return `${day} ${name} ${year}`;
    default:
      return `${day} de ${name} de ${year}`;
  }
}

/** Data numérica: troca dia e mês só quando um dos idiomas é o inglês (mm/dd) e o outro não. */
export function convertNumericDate(text: string, from: Language, to: Language) {
  if (from === to || usesDecimalPoint(from) === usesDecimalPoint(to)) return text;
  return text.replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, (_match, a: string, b: string, year: string) => `${b}/${a}/${year}`);
}

/** Data numérica escrita por extenso no idioma de destino ("14/03/2006" → "14 de março de 2006"). */
export function numericDateToLong(text: string, from: Language, to: Language) {
  return text.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (match, a: string, b: string, year: string) => {
    const [day, month] = usesDecimalPoint(from) ? [Number(b), Number(a)] : [Number(a), Number(b)];
    if (month < 1 || month > 12 || day < 1 || day > 31) return match;
    return formatLong(day, month - 1, Number(year), to);
  });
}

/** Troca separadores decimais e de milhar ("1.000,5" ↔ "1,000.5"). */
export function swapNumberSeparators(token: string) {
  return token.replace(/[.,]/g, (char) => (char === '.' ? ',' : '.'));
}

/** Os dois idiomas escrevem números de forma diferente (ponto × vírgula decimal). */
export const separatorsDiffer = (from: Language, to: Language) => usesDecimalPoint(from) !== usesDecimalPoint(to);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Padrões de data por extenso de um idioma, com grupos dia, mês e ano. */
function longDatePattern(language: Language) {
  const months = MONTHS[language].map(escape).join('|');
  switch (language) {
    case 'en':
      return {
        regex: new RegExp(`\\b(${months}) (\\d{1,2}), (\\d{4})\\b`, 'g'),
        parts: (m: RegExpExecArray) => [m[2]!, m[1]!, m[3]!] as const,
      };
    case 'fr':
    case 'it':
      return {
        regex: new RegExp(`\\b(\\d{1,2})(?:er)? (${months}) (\\d{4})\\b`, 'gi'),
        parts: (m: RegExpExecArray) => [m[1]!, m[2]!, m[3]!] as const,
      };
    default:
      return {
        regex: new RegExp(`\\b(\\d{1,2}) de (${months}) de (\\d{4})\\b`, 'gi'),
        parts: (m: RegExpExecArray) => [m[1]!, m[2]!, m[3]!] as const,
      };
  }
}

/** Datas por extenso do idioma de origem, reescritas no formato e com o mês do idioma de destino. */
export function convertLongDates(text: string, from: Language, to: Language) {
  if (from === to) return text;
  const { regex, parts } = longDatePattern(from);
  return text.replace(regex, (...args) => {
    const match = args[0] as string;
    const groups = args.slice(0, 4) as unknown as RegExpExecArray;
    const [day, month, year] = parts(groups);
    const index = MONTHS[from].findIndex((name) => name.toLowerCase() === month.toLowerCase());
    return index < 0 ? match : formatLong(Number(day), index, Number(year), to);
  });
}
