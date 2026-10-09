import assert from 'node:assert/strict';
import test from 'node:test';

const captureRuntime = require('../../tools/capture-standard-screenshots.cjs') as {
  launchCaptureApplication?: (
    electron: { launch: (options: Record<string, unknown>) => Promise<{ firstWindow: (options?: Record<string, unknown>) => Promise<unknown>; close: () => Promise<void> }> },
    launchOptions: Record<string, unknown>
  ) => Promise<{ app: unknown; page: unknown }>;
};

test('retries one transient Electron first-window timeout with a clean application', async () => {
  assert.equal(typeof captureRuntime.launchCaptureApplication, 'function');
  let launches = 0;
  let closes = 0;
  const page = { id: 'ready-window' };
  const electron = {
    launch: async () => {
      launches += 1;
      return {
        firstWindow: async () => {
          if (launches === 1) throw new Error('Timeout 30000ms exceeded while waiting for event "window"');
          return page;
        },
        close: async () => { closes += 1; }
      };
    }
  };

  const result = await captureRuntime.launchCaptureApplication!(electron, { executablePath: 'fixture.exe' });

  assert.equal(launches, 2);
  assert.equal(closes, 1);
  assert.equal(result.page, page);
});

test('does not retry non-timeout Electron capture failures', async () => {
  assert.equal(typeof captureRuntime.launchCaptureApplication, 'function');
  let launches = 0;
  const electron = {
    launch: async () => {
      launches += 1;
      throw new Error('Packaged blueprint is invalid.');
    }
  };

  await assert.rejects(
    captureRuntime.launchCaptureApplication!(electron as never, { executablePath: 'fixture.exe' }),
    /Packaged blueprint is invalid/
  );
  assert.equal(launches, 1);
});
