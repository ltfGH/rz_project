import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword } from '../../src/core/passwords';

test('uses random salts and verifies only the matching password', async () => {
  const first = await hashPassword('Correct Horse Battery Staple');
  const second = await hashPassword('Correct Horse Battery Staple');

  assert.notEqual(first, second);
  assert.equal(await verifyPassword('Correct Horse Battery Staple', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.doesNotMatch(first, /Correct Horse Battery Staple/);
});

test('fails closed for malformed stored digests', async () => {
  assert.equal(await verifyPassword('password', 'not-a-digest'), false);
  assert.equal(await verifyPassword('password', 'scrypt$1$2$3$bad$bad'), false);
});
