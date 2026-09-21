import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

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

test('hash CLI accepts exactly one password through stdin without echoing it', async () => {
  const password = 'StrongCliPassword123!';
  const script = path.resolve(__dirname, '..', '..', 'tools', 'hash-password.cjs');
  const env = { ...process.env };
  delete env.RZ_PASSWORD;
  const result = spawnSync(process.execPath, [script, '--stdin'], {
    input: `${password}\n`, encoding: 'utf8', env, windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  const digest = result.stdout.trim();
  assert.match(digest, /^scrypt\$16384\$8\$1\$/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(password));
  assert.equal(await verifyPassword(password, digest), true);

  const trailing = spawnSync(process.execPath, [script, '--stdin'], {
    input: `${password}\nsecond-password\n`, encoding: 'utf8', env, windowsHide: true
  });
  assert.equal(trailing.status, 2);
  assert.doesNotMatch(`${trailing.stdout}${trailing.stderr}`, new RegExp(password));
});
