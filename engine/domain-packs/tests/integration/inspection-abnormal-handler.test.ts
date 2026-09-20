import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { InspectionService } from '../../packs/inspection_rectification/runtime/inspection-service';
import type { InspectionAbnormalDto } from '../../packs/inspection_rectification/runtime/types';
import { AllowlistedDomainCommandBus } from '../../src/runtime/command-bus';
import type { DomainCommandDefinition, DomainCommandExecutionContext, JsonObject } from '../../src/runtime/types';
import {
  createInspectionTestRuntime,
  executor,
  inspectionContext,
  planner
} from '../helpers/inspection-runtime';

function executingTask(t: test.TestContext) {
  const runtime = createInspectionTestRuntime(t);
  const service = new InspectionService();
  runtime.database.prepare(
    'CREATE TABLE bridge_effect (id INTEGER PRIMARY KEY, item_code TEXT NOT NULL UNIQUE)'
  ).run();
  const task = runtime.database.transaction((connection) => service.createTask({
    planCode: 'PLAN-1',
    title: '异常回调测试',
    executorId: executor.username,
    scheduledAt: '2026-09-19T08:00:00.000Z',
    items: [{ name: '温度', standard: '温度正常' }]
  }, inspectionContext(connection, planner)));
  const started = runtime.database.transaction((connection) => service.startTask({
    taskId: task.taskId,
    expectedTaskVersion: task.version
  }, inspectionContext(connection, executor)));
  return { ...runtime, service, task, started };
}

function bridgeBus(connection: DatabaseSync) {
  const definition: DomainCommandDefinition = Object.freeze({
    id: 'inspection.work_order.create',
    allowedSources: Object.freeze(['inspection_work_order_bridge']),
    parse: (payload: JsonObject) => payload,
    execute: (context: DomainCommandExecutionContext, payload: JsonObject) => {
      context.connection.prepare('INSERT INTO bridge_effect (item_code) VALUES (?)')
        .run(String(payload.itemCode));
    }
  });
  return new AllowlistedDomainCommandBus([definition], Object.freeze({
    connection,
    actor: executor,
    sourcePluginId: 'inspection_work_order_bridge'
  }));
}

test('invokes frozen abnormal handlers only for abnormal item results', (t) => {
  const runtime = executingTask(t);
  const calls: InspectionAbnormalDto[] = [];
  runtime.database.transaction((connection) => runtime.service.recordItemResult({
    taskId: runtime.task.taskId,
    itemId: runtime.task.itemIds[0]!,
    expectedTaskVersion: runtime.started.version,
    expectedItemVersion: 1,
    result: 'abnormal',
    finding: '温度超限',
    disposition: '生成整改工单'
  }, inspectionContext(connection, executor, {
    commandBus: bridgeBus(connection),
    abnormalHandlers: [
      (dto, bus) => {
        calls.push(dto);
        assert.equal(Object.isFrozen(dto), true);
        assert.equal('connection' in dto, false);
        bus.invoke('inspection.work_order.create', { itemCode: dto.itemCode });
      }
    ]
  })));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.taskCode, runtime.task.taskCode);
  assert.equal(calls[0]!.resultCode, 'abnormal');
  assert.equal(calls[0]!.recordedBy, executor.username);
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM bridge_effect').get() as { count: number }).count, 1);
});

test('does not invoke abnormal handlers for normal item results', (t) => {
  const runtime = executingTask(t);
  let calls = 0;
  runtime.database.transaction((connection) => runtime.service.recordItemResult({
    taskId: runtime.task.taskId,
    itemId: runtime.task.itemIds[0]!,
    expectedTaskVersion: runtime.started.version,
    expectedItemVersion: 1,
    result: 'normal',
    finding: null,
    disposition: null
  }, inspectionContext(connection, executor, {
    commandBus: bridgeBus(connection),
    abnormalHandlers: [() => { calls += 1; }]
  })));
  assert.equal(calls, 0);
});

test('rolls back item, task, event, command write and audit boundary when a later handler fails', (t) => {
  const runtime = executingTask(t);
  const eventsBefore = (runtime.database.prepare(
    'SELECT COUNT(*) count FROM biz_inspection_event'
  ).get() as { count: number }).count;

  assert.throws(() => runtime.database.transaction((connection) => runtime.service.recordItemResult({
    taskId: runtime.task.taskId,
    itemId: runtime.task.itemIds[0]!,
    expectedTaskVersion: runtime.started.version,
    expectedItemVersion: 1,
    result: 'abnormal',
    finding: '温度超限',
    disposition: '生成整改工单'
  }, inspectionContext(connection, executor, {
    commandBus: bridgeBus(connection),
    abnormalHandlers: [
      (dto, bus) => bus.invoke('inspection.work_order.create', { itemCode: dto.itemCode }),
      () => { throw new Error('bridge failed'); }
    ]
  }))), /bridge failed/);

  const item = runtime.database.prepare(
    'SELECT result, version FROM biz_inspection_item WHERE id=?'
  ).get(runtime.task.itemIds[0]!) as { result: string; version: number };
  const task = runtime.database.prepare(
    'SELECT version FROM biz_inspection_task WHERE id=?'
  ).get(runtime.task.taskId) as { version: number };
  assert.deepEqual({ ...item }, { result: 'pending', version: 1 });
  assert.equal(task.version, runtime.started.version);
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM bridge_effect').get() as { count: number }).count, 0);
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_inspection_event').get() as { count: number }).count, eventsBefore);
});
