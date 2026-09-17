'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.resolve(root, 'dist', 'installers');
const expectedParent = path.resolve(root, 'dist');
if (path.dirname(target) !== expectedParent || path.basename(target) !== 'installers') {
  throw new Error(`Refusing to clean unexpected installer path: ${target}`);
}
fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
