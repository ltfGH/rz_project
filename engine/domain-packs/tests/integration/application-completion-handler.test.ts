import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { ApplicationArchiveService } from '../../packs/application_archive/runtime/application-service';
import { AllowlistedDomainCommandBus } from '../../packs/application_archive/runtime/command-bus';
import type {
  DomainCommandDefinition,
  DomainCommandExecutionContext,
  JsonObject
} from '../../src/runtime/types';
import {
  applicant,
  applicationContext,
  compliance,
  createApplicationRuntime,
  reviewer
} from '../helpers/application-runtime';

type Handler = (payload: JsonObject) => unknown;

function commandBus(connection: DatabaseSync, handlers: Readonly<Record<string, Handler>>) {
  const definitions: DomainCommandDefinition[] = Object.entries(handlers).map(([id, handler]) => ({
    id,
    allowedSources: Object.freeze(['test_bridge']),
    parse: (payload: JsonObject) => payload,
    execute: (_context: DomainCommandExecutionContext, payload: JsonObject) => {
      const result = handler(payload);
      return result === undefined ? undefined : result as never;
    }
  }));
  return new AllowlistedDomainCommandBus(definitions, Object.freeze({
    connection,
    actor: compliance,
    sourcePluginId: 'test_bridge'
  }));
}

function submitted(t: test.TestContext) {
  const runtime = createApplicationRuntime(t);
  const service = new ApplicationArchiveService();
  runtime.database.prepare(
    'CREATE TABLE bridge_effect (id INTEGER PRIMARY KEY, application_code TEXT NOT NULL)'
  ).run();
  let application = runtime.database.transaction((connection) => service.createApplication({
    applicationType: 'inventory_issue',
    title: '桥接申请',
    content: '正文'
  }, applicationContext(connection, applicant)));
  application = runtime.database.transaction((connection) => service.submitApplication({
    applicationId: application.applicationId,
    expectedVersion: 1,
    comment: '提交'
  }, applicationContext(connection, applicant)));
  const first = runtime.database.prepare(
    'SELECT id,version FROM biz_approval_node WHERE application_code=? AND sequence=1'
  ).get(application.applicationCode) as { id: number; version: number };
  return { ...runtime, service, application, first };
}

test('invokes frozen completion handlers only on final approval in stable order', (t) => {
  const runtime = submitted(t);
  const calls: string[] = [];
  let application = runtime.database.transaction((connection) => runtime.service.approveCurrentNode({
    applicationId: runtime.application.applicationId,
    expectedApplicationVersion: 2,
    nodeId: runtime.first.id,
    expectedNodeVersion: runtime.first.version,
    comment: '一级通过'
  }, applicationContext(connection, reviewer, {
    approvalCompletionHandlers: [() => calls.push('unexpected')]
  })));
  assert.equal(calls.length, 0);

  const final = runtime.database.prepare(
    'SELECT id,version FROM biz_approval_node WHERE application_code=? AND sequence=2'
  ).get(application.applicationCode) as { id: number; version: number };
  application = runtime.database.transaction((connection) => {
    const bus = commandBus(connection, {
      'inventory.issue': (payload) => {
        connection.prepare('INSERT INTO bridge_effect (application_code) VALUES (?)')
          .run(String(payload.applicationCode));
        calls.push('command');
      }
    });
    return runtime.service.approveCurrentNode({
      applicationId: application.applicationId,
      expectedApplicationVersion: application.version,
      nodeId: final.id,
      expectedNodeVersion: final.version,
      comment: '最终通过'
    }, applicationContext(connection, compliance, {
      commandBus: bus,
      approvalCompletionHandlers: [
        (dto, completionBus) => {
          assert.equal(Object.isFrozen(dto), true);
          assert.equal('connection' in dto, false);
          calls.push('first');
          completionBus.invoke('inventory.issue', { applicationCode: dto.applicationCode });
        },
        () => calls.push('second')
      ]
    }));
  });

  assert.equal(application.status, 'approved');
  assert.deepEqual(calls, ['first', 'command', 'second']);
  const effects = runtime.database.prepare('SELECT COUNT(*) count FROM bridge_effect').get() as { count: number };
  assert.equal(effects.count, 1);
});

test('rolls back node, application, record, bridge write and audit when a later handler fails', (t) => {
  const runtime = submitted(t);
  const application = runtime.database.transaction((connection) => runtime.service.approveCurrentNode({
    applicationId: runtime.application.applicationId,
    expectedApplicationVersion: 2,
    nodeId: runtime.first.id,
    expectedNodeVersion: runtime.first.version,
    comment: '一级通过'
  }, applicationContext(connection, reviewer)));
  const final = runtime.database.prepare(
    'SELECT id,version FROM biz_approval_node WHERE application_code=? AND sequence=2'
  ).get(application.applicationCode) as { id: number; version: number };

  assert.throws(() => runtime.database.transaction((connection) => {
    const bus = commandBus(connection, {
      'inventory.issue': (payload) => connection
        .prepare('INSERT INTO bridge_effect (application_code) VALUES (?)')
        .run(String(payload.applicationCode))
    });
    return runtime.service.approveCurrentNode({
      applicationId: application.applicationId,
      expectedApplicationVersion: application.version,
      nodeId: final.id,
      expectedNodeVersion: final.version,
      comment: '最终通过'
    }, applicationContext(connection, compliance, {
      commandBus: bus,
      approvalCompletionHandlers: [
        (dto, completionBus) => completionBus.invoke(
          'inventory.issue',
          { applicationCode: dto.applicationCode }
        ),
        () => { throw new Error('bridge failed'); }
      ]
    }));
  }), /bridge failed/);

  const state = runtime.database.prepare(
    'SELECT status,version,current_node_code FROM biz_application WHERE id=?'
  ).get(application.applicationId) as Record<string, unknown>;
  const node = runtime.database.prepare(
    'SELECT status,version FROM biz_approval_node WHERE id=?'
  ).get(final.id) as Record<string, unknown>;
  const nodeCode = runtime.database.prepare(
    'SELECT code FROM biz_approval_node WHERE id=?'
  ).get(final.id) as { code: string };
  assert.deepEqual({ ...state }, {
    status: 'approving',
    version: 3,
    current_node_code: nodeCode.code
  });
  assert.deepEqual({ ...node }, { status: 'active', version: 2 });
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM bridge_effect').get() as { count: number }).count, 0);
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_approval_record').get() as { count: number }).count, 2);
});

test('fails closed for an unregistered domain command', () => {
  const connection = new DatabaseSync(':memory:');
  try {
    assert.throws(() => commandBus(connection, {}).invoke('inventory.issue', {}), /not registered/);
  } finally {
    connection.close();
  }
});

test('rejects non-JSON cyclic executable and accessor payloads before handlers', () => {
  const connection = new DatabaseSync(':memory:');
  let calls = 0;
  const bus = commandBus(connection, { safe: () => { calls += 1; } });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  class Payload { readonly value = 1; }
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'value', { get: () => 1, enumerable: true });
  try {
    for (const payload of [{ fn: () => undefined }, cyclic, new Payload(), accessor]) {
      assert.throws(() => bus.invoke('safe', payload as never), /JSON/i);
    }
    assert.equal(calls, 0);
  } finally {
    connection.close();
  }
});

test('normalizes prototype-named keys without changing the payload prototype', () => {
  const connection = new DatabaseSync(':memory:');
  let received: JsonObject | undefined;
  const bus = commandBus(connection, { safe: (payload) => { received = payload; } });
  try {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"safe":1}') as never;
    bus.invoke('safe', payload);
    assert.ok(received);
    assert.equal(Object.getPrototypeOf(received), null);
    assert.equal(Object.hasOwn(received, '__proto__'), true);
    assert.equal((received.__proto__ as { polluted: boolean }).polluted, true);
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  } finally {
    connection.close();
  }
});
