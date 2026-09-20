import test from 'node:test';
import assert from 'node:assert/strict';

import { createBusinessApi } from '../../src/preload/api';
import { IPC_CHANNELS, IPC_REQUEST_SCHEMAS } from '../../src/shared/ipc';

test('exposes only named business methods and no generic IPC escape hatch', () => {
  const calls: Array<{ channel: string; request: unknown }> = [];
  const api = createBusinessApi(async (channel, request) => {
    calls.push({ channel, request });
    return { ok: true, data: null };
  });

  assert.deepEqual(Object.keys(api).sort(), ['dashboard', 'domain', 'entities', 'maintenance', 'metadata', 'session', 'workflows']);
  assert.deepEqual(Object.keys(api.session).sort(), ['current', 'login', 'logout']);
  assert.deepEqual(Object.keys(api.entities).sort(), ['create', 'get', 'list', 'update']);
  assert.equal('invoke' in api, false);
  assert.equal('send' in api, false);
  assert.equal('filesystem' in api, false);
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api.domain), ['execute']);

  void api.entities.get('token', 'asset', 9);
  assert.deepEqual(calls[0], {
    channel: IPC_CHANNELS.entitiesGet,
    request: { token: 'token', entityId: 'asset', id: 9 }
  });
  void api.domain.execute('token', 'asset.change_status', { assetId: 9 });
  assert.deepEqual(calls[1], {
    channel: IPC_CHANNELS.domainExecute,
    request: { token: 'token', commandId: 'asset.change_status', payload: { assetId: 9 } }
  });
});

test('strict request schemas reject identity injection and oversized pages', () => {
  assert.equal(IPC_REQUEST_SCHEMAS[IPC_CHANNELS.entitiesList].safeParse({
    token: 'token',
    entityId: 'asset',
    actor: { userId: 999 },
    query: { page: 1, pageSize: 20 }
  }).success, false);
  assert.equal(IPC_REQUEST_SCHEMAS[IPC_CHANNELS.entitiesList].safeParse({
    token: 'token',
    entityId: 'asset',
    query: { page: 1, pageSize: 1001 }
  }).success, false);
  assert.equal(IPC_REQUEST_SCHEMAS[IPC_CHANNELS.entitiesList].safeParse({
    token: 'token',
    entityId: 'asset',
    query: { page: 1, pageSize: 20 }
  }).success, true);
  assert.equal(IPC_REQUEST_SCHEMAS[IPC_CHANNELS.domainExecute].safeParse({
    token: 'token', commandId: 'asset.change_status', payload: { assetId: 1 }, actor: { userId: 9 }
  }).success, false);
});
