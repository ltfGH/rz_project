import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWindowOptions } from '../../src/main/window-options';

test('creates an isolated sandboxed renderer without Node access', () => {
  const options = buildWindowOptions('C:\\app\\preload.js');

  assert.equal(options.width, 1366);
  assert.equal(options.height, 820);
  assert.equal(options.minWidth, 1100);
  assert.equal(options.minHeight, 760);
  assert.equal(options.show, false);
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(options.webPreferences?.preload, 'C:\\app\\preload.js');
});
