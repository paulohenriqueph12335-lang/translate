import assert from 'node:assert/strict';
import test from 'node:test';
import { languagePairTokens, searchLanguagePairs } from './language-pair-search.ts';

// Catálogo sintético de cinco idiomas para testar a busca sem importar transporte HTTP/DOM.
const languages = ['pt', 'en', 'fr', 'it', 'es'];
const LANGUAGE_PAIRS = languages.flatMap((source) =>
  languages
    .filter((target) => target !== source)
    .map((target) => ({
      value: `${source}-${target}`,
      source,
      target,
      label: `${source} → ${target}`,
    })),
);

test('empty search preserves all twenty distinct directed pairs and catalog order', () => {
  const found = searchLanguagePairs('', LANGUAGE_PAIRS);
  assert.deepEqual(found, LANGUAGE_PAIRS);
  assert.equal(found.length, 20);
  assert.equal(new Set(found.map((pair) => pair.value)).size, 20);
  assert.ok(found.every((pair) => pair.source !== pair.target));
  assert.notEqual(found, LANGUAGE_PAIRS);
});

test('language names normalize accents, case, separators and common connective words', () => {
  assert.deepEqual(languagePairTokens('Tradução de FRANCÊS para ESPANHOL'), ['frances', 'espanhol']);
  for (const query of ['francês espanhol', 'FRANCES ESPANHOL', 'français → español', 'french to spanish', 'FRAN – ESP', 'FR:ES', 'fr-es'])
    assert.equal(searchLanguagePairs(query, LANGUAGE_PAIRS)[0]?.value, 'fr-es', query);
});

test('abbreviations and partial names preserve source and destination instead of swapping directions', () => {
  for (const query of ['FR ES', 'FRA ESP', 'FRE SPA', 'franc espa'])
    assert.deepEqual(
      searchLanguagePairs(query, LANGUAGE_PAIRS).map((pair) => pair.value),
      ['fr-es'],
      query,
    );
  assert.deepEqual(
    searchLanguagePairs('ESP FRA', LANGUAGE_PAIRS).map((pair) => pair.value),
    ['es-fr'],
  );
  assert.deepEqual(
    searchLanguagePairs('ENG POR', LANGUAGE_PAIRS).map((pair) => pair.value),
    ['en-pt'],
  );
});

test('a single language finds either direction with source matches ranked before target matches', () => {
  const found = searchLanguagePairs('FR', LANGUAGE_PAIRS);
  assert.equal(found.length, 8);
  assert.ok(found.slice(0, 4).every((pair) => pair.source === 'fr'));
  assert.ok(found.slice(4).every((pair) => pair.target === 'fr'));
});

test('small spelling errors are tolerated in names without inventing unsupported languages', () => {
  assert.equal(searchLanguagePairs('francse espanhol', LANGUAGE_PAIRS).length, 0, 'two edits should not broaden the direction');
  assert.equal(searchLanguagePairs('francess espanhol', LANGUAGE_PAIRS)[0]?.value, 'fr-es');
  assert.deepEqual(searchLanguagePairs('alemão japonês', LANGUAGE_PAIRS), []);
  assert.deepEqual(searchLanguagePairs('123 ES', LANGUAGE_PAIRS), []);
});

test('contradictory language groups and same-language requests yield no false selectable pair', () => {
  assert.deepEqual(searchLanguagePairs('FR FR', LANGUAGE_PAIRS), []);
  assert.deepEqual(searchLanguagePairs('FR EN ES', LANGUAGE_PAIRS), []);
  assert.equal(searchLanguagePairs('francês português do brasil', LANGUAGE_PAIRS)[0]?.value, 'fr-pt');
});
