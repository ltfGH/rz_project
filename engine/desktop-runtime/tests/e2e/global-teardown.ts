import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default function globalTeardown(): void {
  const manifestPath = path.resolve('test-results', 'e2e-temp-paths.txt');
  if (!fs.existsSync(manifestPath)) return;
  const allowedPrefix = path.join(os.tmpdir(), 'desktop-runtime-e2e-');
  const directories = fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const directory of directories) {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(allowedPrefix)) {
      throw new Error(`Refusing to remove unexpected E2E path: ${resolved}`);
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
