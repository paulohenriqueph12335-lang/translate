import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createRateLimiter } from './rate-limit.js';

it('limita tentativas por janela e reinicia após expirar', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.hit('k'), true);
  assert.equal(limiter.hit('k'), true);
  assert.equal(limiter.hit('k'), false);
  assert.equal(limiter.hit('other'), true);
  now = 1000;
  assert.equal(limiter.hit('k'), true);
});
