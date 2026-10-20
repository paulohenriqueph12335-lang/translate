import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isConnectionDrop } from './object-storage.js';

test('conexão derrubada pelo servidor é repetida; outros erros não', () => {
  const hangUp = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET', name: 'TimeoutError' });
  assert.equal(isConnectionDrop(hangUp), true);
  assert.equal(isConnectionDrop(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })), true);
  assert.equal(isConnectionDrop(new Error('socket hang up')), true);
  assert.equal(isConnectionDrop(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' })), false);
  assert.equal(isConnectionDrop('ECONNRESET'), false);
});
