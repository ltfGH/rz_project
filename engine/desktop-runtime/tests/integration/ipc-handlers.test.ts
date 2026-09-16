import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerIpcHandlers,
  type IpcRegistrar,
  type RuntimeServices
} from '../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../src/shared/ipc';
import type { ActorDto } from '../../src/shared/dto';

class TestIpc implements IpcRegistrar {
  readonly handlers = new Map<string, (request: unknown) => Promise<unknown>>();

  handle(channel: string, handler: (_event: unknown, request: unknown) => Promise<unknown>): void {
    this.handlers.set(channel, (request) => handler({}, request));
  }

  invoke(channel: string, request: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing handler ${channel}`);
    return handler(request);
  }
}

const actor: ActorDto = {
  userId: 7, username: 'operator', displayName: '处理人', roleId: 'operator'
};

function services(observed: ActorDto[]): RuntimeServices {
  return {
    auth: {
      login: async () => ({ token: 'token', actor, expiresAt: '2026-09-17T00:00:00.000Z' }),
      logout: () => undefined,
      requireSession: () => actor
    },
    metadata: { read: () => ({ software: { name: '测试软件' }, modules: [] }) },
    entities: {
      list: (_entity, _query, current) => {
        observed.push(current);
        return { items: [], page: 1, pageSize: 20, total: 0 };
      },
      get: (_entity, id, current) => {
        observed.push(current);
        return { id, version: 1, values: {} };
      },
      create: (_entity, _values, current) => {
        observed.push(current);
        return { id: 1, version: 1, values: {} };
      },
      update: (_entity, id, _version, _values, current) => {
        observed.push(current);
        return { id, version: 2, values: {} };
      }
    },
    workflows: {
      allowedActions: (_entity, _id, current) => {
        observed.push(current);
        return [];
      },
      execute: (request) => {
        observed.push(request.actor);
        return { id: request.recordId, version: 2, values: {} };
      }
    },
    dashboard: { read: () => [] },
    maintenance: {
      createBackup: async () => ({ fileName: 'backup.sqlite' }),
      inspectBackup: () => ({ valid: true }),
      restoreBackup: () => ({ restored: true })
    }
  };
}

test('registers every channel and resolves actor only from the session', async () => {
  const observed: ActorDto[] = [];
  const ipc = new TestIpc();
  registerIpcHandlers(ipc, services(observed));

  assert.deepEqual([...ipc.handlers.keys()].sort(), Object.values(IPC_CHANNELS).sort());
  const result = await ipc.invoke(IPC_CHANNELS.entitiesList, {
    token: 'renderer-token', entityId: 'asset', query: { page: 1, pageSize: 20 }
  }) as { ok: boolean; data: { total: number } };
  assert.equal(result.ok, true);
  assert.equal(result.data.total, 0);
  assert.deepEqual(observed, [actor]);
});

test('returns structured validation errors before calling services', async () => {
  const observed: ActorDto[] = [];
  const ipc = new TestIpc();
  registerIpcHandlers(ipc, services(observed));

  const result = await ipc.invoke(IPC_CHANNELS.entitiesList, {
    token: 'token', entityId: 'asset', actor: { userId: 999 },
    query: { page: 1, pageSize: 20 }
  }) as { ok: boolean; error: { code: string } };
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(observed, []);
});

test('converts unexpected diagnostics to a redacted internal error', async () => {
  const ipc = new TestIpc();
  const target = services([]);
  target.dashboard.read = () => {
    throw new Error('SQL select password from C:\\private\\db.sqlite');
  };
  registerIpcHandlers(ipc, target);

  const result = await ipc.invoke(IPC_CHANNELS.dashboardRead, { token: 'token' }) as {
    ok: boolean;
    error: { code: string; message: string };
  };
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(result), /select password|private|sqlite/i);
});
