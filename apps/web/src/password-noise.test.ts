import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNoiseField, noiseFrame } from './password-noise.ts';

/** Gerador com semente, para o teste dar sempre o mesmo resultado. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const width = 120;
const height = 40;
/** Uma faixa no meio faz o papel das letras. */
const mask = new Uint8Array(width * height).map((_, index) => (Math.floor(index / width) >= 10 && Math.floor(index / width) < 30 ? 1 : 0));
const share = (frame: Uint8Array, inMask: boolean) => {
  let lit = 0;
  let total = 0;
  frame.forEach((cell, index) => {
    if (!!mask[index] !== inMask) return;
    total++;
    lit += cell;
  });
  return lit / total;
};

test('um quadro sozinho é ruído igual dentro e fora das letras', () => {
  const field = createNoiseField(width, height, seeded(7));
  for (const offset of [0, 1, 17]) {
    const frame = noiseFrame(field, mask, offset);
    assert.ok(Math.abs(share(frame, true) - 0.5) < 0.05);
    assert.ok(Math.abs(share(frame, false) - 0.5) < 0.05);
  }
});

test('de um quadro para o outro, só as letras mudam', () => {
  const field = createNoiseField(width, height, seeded(11));
  const first = noiseFrame(field, mask, 3);
  const second = noiseFrame(field, mask, 4);
  let changedOutside = 0;
  let changedInside = 0;
  first.forEach((cell, index) => {
    if (cell === second[index]) return;
    if (mask[index]) changedInside++;
    else changedOutside++;
  });
  assert.equal(changedOutside, 0);
  assert.ok(changedInside > 0);
});

test('o chiado das letras desce uma linha por quadro', () => {
  const field = createNoiseField(width, height, seeded(5));
  const full = new Uint8Array(width * height).fill(1);
  const first = noiseFrame(field, full, 0);
  const next = noiseFrame(field, full, 1);
  assert.deepEqual(next.subarray(width), first.subarray(0, width * (height - 1)));
});
