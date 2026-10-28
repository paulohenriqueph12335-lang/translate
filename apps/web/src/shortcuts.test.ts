import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyParts, shortcutProps } from './shortcut-keys.ts';

test('atalhos têm no máximo duas teclas e anunciam só o que o leitor de tela entende', () => {
  assert.deepEqual(keyParts('G I'), ['G', 'I']);
  assert.deepEqual(keyParts('N'), ['N']);
  assert.equal(keyParts('Ctrl+K').length, 2);
  assert.deepEqual(shortcutProps('G I'), { 'data-shortcut': 'G I' });
  assert.equal(shortcutProps('N')['aria-keyshortcuts' as keyof ReturnType<typeof shortcutProps>], 'N');
});
