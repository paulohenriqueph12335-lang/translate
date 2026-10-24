export interface SearchableLanguagePair {
  value: string;
  source: string;
  target: string;
  label: string;
}

const aliases: Record<string, string[]> = {
  pt: ['pt', 'por', 'port', 'portugues', 'portuguesa', 'portuguese', 'br', 'brasil'],
  en: ['en', 'eng', 'ing', 'ingles', 'inglesa', 'english'],
  fr: ['fr', 'fra', 'fre', 'fran', 'frances', 'francesa', 'francais', 'french'],
  es: ['es', 'esp', 'spa', 'espanhol', 'espanhola', 'espanol', 'spanish', 'castelhano'],
  it: ['it', 'ita', 'italiano', 'italiana', 'italian'],
};
const ignored = new Set(['de', 'do', 'da', 'para', 'to', 'a', 'e', 'idioma', 'idiomas', 'traducao', 'origem', 'destino']);

export function languagePairTokens(query: string) {
  return query
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !ignored.has(token));
}

function oneEditApart(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}

function tokenScore(token: string, language: string) {
  const names = aliases[language] ?? [language];
  if (names.includes(token)) return 100;
  if (names.some((name) => name.startsWith(token))) return 60 + Math.min(token.length, 20);
  if (token.length >= 4 && names.some((name) => name.length >= 4 && oneEditApart(token, name))) return 25;
  return 0;
}

/** Mantém a direção digitada: FR ES encontra francês→espanhol, sem inverter a intenção. */
export function searchLanguagePairs<T extends SearchableLanguagePair>(query: string, pairs: readonly T[]): T[] {
  const tokens = languagePairTokens(query);
  if (!tokens.length) return [...pairs];
  const scored = pairs.map((pair, index) => {
    let score = 0;
    if (tokens.length === 1) {
      const source = tokenScore(tokens[0]!, pair.source),
        target = tokenScore(tokens[0]!, pair.target);
      score = Math.max(source ? source + 5 : 0, target);
    } else {
      for (let split = 1; split < tokens.length; split++) {
        const source = tokens.slice(0, split).map((token) => tokenScore(token, pair.source));
        const target = tokens.slice(split).map((token) => tokenScore(token, pair.target));
        if (source.every(Boolean) && target.every(Boolean))
          score = Math.max(score, source.reduce((sum, n) => sum + n, 0) + target.reduce((sum, n) => sum + n, 0));
      }
    }
    return { pair, index, score };
  });
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.pair);
}
