import assert from 'node:assert/strict';
import { it } from 'node:test';
import { searchTokens } from '../audit/service.js';

it('normaliza acentos e pontuação sem criar tokens duplicados', () => {
  assert.deepEqual(searchTokens('  CERTIDÃO abc-10003 José certidao '), ['certidao', 'abc', '10003', 'jose']);
  assert.deepEqual(searchTokens('% _ \\'), []);
  assert.equal(searchTokens(Array.from({ length: 30 }, (_, i) => `token${i}`).join(' ')).length, 20);
});
