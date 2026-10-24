import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Queryable } from '../db/pool.js';
import { forgetLayoutKnowledge, loadLayoutKnowledge } from './knowledge.js';

it('mantém cache de modelos separado por conexão/banco', async () => {
  forgetLayoutKnowledge();
  let queriesA = 0;
  let queriesB = 0;
  const a = {
    query: async () => {
      queriesA++;
      return { rows: [] };
    },
  } as unknown as Queryable;
  const b = {
    query: async () => {
      queriesB++;
      return { rows: [] };
    },
  } as unknown as Queryable;
  await loadLayoutKnowledge(a);
  await loadLayoutKnowledge(a);
  await loadLayoutKnowledge(b);
  assert.equal(queriesA, 2);
  assert.equal(queriesB, 2, 'Outro banco não reutiliza o resultado do primeiro.');
});
