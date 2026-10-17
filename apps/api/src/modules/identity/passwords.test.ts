import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from './passwords.js';

describe('senhas', () => {
  it('gera hash com sal e verifica', async () => {
    const first = await hashPassword('uma senha bem longa');
    const second = await hashPassword('uma senha bem longa');
    assert.notEqual(first, second);
    assert.match(first, /^scrypt\$32768\$8\$1\$/);
    assert.equal(await verifyPassword('uma senha bem longa', first), true);
    assert.equal(await verifyPassword('outra senha bem longa', first), false);
  });

  it('rejeita hash malformado', async () => {
    assert.equal(await verifyPassword('qualquer', 'texto-sem-formato'), false);
  });
});
