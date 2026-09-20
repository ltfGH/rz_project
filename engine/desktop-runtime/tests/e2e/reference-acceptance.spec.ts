import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const credentialNames = [
  'RZ_E2E_DISPATCHER_PASSWORD', 'RZ_E2E_OPERATOR_PASSWORD',
  'RZ_E2E_REVIEWER_PASSWORD', 'RZ_E2E_ADMINISTRATOR_PASSWORD'
];
test.skip(
  process.env.RZ_SKIP_REFERENCE_E2E === '1' || credentialNames.some((name) => !process.env[name]),
  'Reference credentials are unavailable or the current image cannot launch Electron.'
);

test('reference workflow', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-e2e-'));
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.appendFileSync(path.join(root, 'test-results', 'e2e-temp-paths.txt'), `${userData}\n`, 'utf8');
  const app = await electron.launch({ args: [root], env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel('账号')).toBeVisible();
    const source = fs.readFileSync(path.join(root, 'tools', 'reference-e2e-flow.source.js'), 'utf8');
    const run = new Function(source)() as () => Promise<void>;
    (globalThis as any).__referenceE2eContext = { electron, initialApp: app, initialPage: page, userData, root, fs, path };
    await run();
    delete (globalThis as any).__referenceE2eContext;
  } finally {
    await app.close().catch(() => undefined);
  }
});
