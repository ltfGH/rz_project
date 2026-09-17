import test from 'node:test';
import assert from 'node:assert/strict';

import { AuditService } from '../../src/core/audit-service';
import { openDatabase } from '../../src/core/database';
import { EntityRepository } from '../../src/core/entity-repository';
import { PermissionService } from '../../src/core/permission-service';
import { compileSchema } from '../../src/core/schema-compiler';
import { WorkflowEngine } from '../../src/core/workflow-engine';
import type { RuntimeBlueprint } from '../../src/shared/blueprint';
import type { ActorDto } from '../../src/shared/dto';
import { AppError } from '../../src/shared/errors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const operator: ActorDto = {
  userId: 2, username: 'operator', displayName: '处理人', roleId: 'operator'
};
const viewer: ActorDto = {
  userId: 3, username: 'viewer', displayName: '只读人员', roleId: 'viewer'
};

function workflowBlueprint(): RuntimeBlueprint {
  return {
    schemaVersion: '1.0',
    software: { id: 'workflow_test', name: '流程测试软件', version: '1.0.0' },
    plugins: [],
    modules: [
      { id: 'projects', name: '项目', route: 'projects', entity: 'project', actions: ['list', 'create', 'update', 'view'] },
      { id: 'tasks', name: '任务', route: 'tasks', entity: 'task', actions: ['list', 'create', 'update', 'close', 'view'] },
      { id: 'task_events', name: '任务事件', route: 'task_events', entity: 'task_event', actions: ['list', 'view'] }
    ],
    entities: [
      {
        id: 'project', name: '项目', retention: 'protected', history: false, systemManaged: false,
        fields: [
          { id: 'code', name: '编码', type: 'text', required: true, unique: true },
          { id: 'status', name: '状态', type: 'enum', required: true, unique: false, options: ['active', 'complete'] }
        ], relations: []
      },
      {
        id: 'task', name: '任务', retention: 'protected', history: false, systemManaged: false,
        fields: [
          { id: 'code', name: '编码', type: 'text', required: true, unique: true },
          { id: 'title', name: '标题', type: 'text', required: true, unique: false },
          { id: 'project_code', name: '项目', type: 'reference', required: true, unique: false, reference: { entity: 'project', field: 'code' } },
          { id: 'status', name: '状态', type: 'enum', required: true, unique: false, options: ['pending', 'processing', 'closed'] },
          { id: 'completed', name: '完成', type: 'boolean', required: true, unique: false, default: false }
        ],
        relations: [{
          id: 'task_project', name: '所属项目', field: 'project_code',
          targetEntity: 'project', targetField: 'code', onDelete: 'restrict'
        }]
      },
      {
        id: 'task_event', name: '任务事件', retention: 'append_only', history: true, systemManaged: true,
        fields: [
          { id: 'code', name: '编码', type: 'text', required: true, unique: true },
          { id: 'task_code', name: '任务', type: 'reference', required: true, unique: false, reference: { entity: 'task', field: 'code' } }
        ],
        relations: [{
          id: 'event_task', name: '所属任务', field: 'task_code',
          targetEntity: 'task', targetField: 'code', onDelete: 'restrict'
        }]
      }
    ],
    roles: [
      { id: 'operator', name: '处理人', permissions: ['projects.create', 'tasks.create', 'tasks.list', 'tasks.close', 'tasks.view'] },
      { id: 'viewer', name: '只读人员', permissions: ['tasks.list', 'tasks.view'] }
    ],
    workflows: [{
      id: 'task_flow', name: '任务流程', entity: 'task', initialState: 'pending',
      terminalStates: ['closed'], states: ['pending', 'processing', 'closed'],
      transitions: [
        {
          id: 'start', name: '开始处理', from: 'pending', to: 'processing',
          permission: 'tasks.close', conditions: [],
          actions: [{ type: 'write_audit', parameters: {} }]
        },
        {
          id: 'close', name: '关闭任务', from: 'processing', to: 'closed',
          permission: 'tasks.close',
          conditions: [
            { type: 'required_field', parameters: { field: 'title' } },
            { type: 'field_equals', parameters: { field: 'status', value: 'processing' } },
            { type: 'relation_exists', parameters: { relation: 'task_project' } }
          ],
          actions: [
            { type: 'set_field', parameters: { field: 'completed', value: true } },
            { type: 'create_record', parameters: { entity: 'task_event', values: { code: 'EVENT-CLOSE', task_code: 'TASK-1' } } },
            { type: 'update_related', parameters: { relation: 'task_project', values: { status: 'complete' } } },
            { type: 'append_event', parameters: {} },
            { type: 'write_audit', parameters: {} }
          ]
        }
      ]
    }]
  };
}

function setup(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-engine-'));
  const blueprint = workflowBlueprint();
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  const repository = new EntityRepository(database, blueprint, schema);
  const project = repository.create('project', { code: 'PROJECT-1', status: 'active' }, operator);
  const taskRecord = repository.create('task', {
    code: 'TASK-1', title: '处理故障', project_code: 'PROJECT-1', status: 'pending'
  }, operator);
  const engine = new WorkflowEngine(
    database,
    blueprint,
    schema,
    new PermissionService(blueprint),
    new AuditService('1.0.0', () => new Date('2026-09-16T08:00:00.000Z'))
  );
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { database, repository, engine, project, taskRecord };
}

test('lists only transitions allowed by state and permission', (t) => {
  const { engine, taskRecord } = setup(t);
  assert.deepEqual(
    engine.allowedActions('task', taskRecord.id, operator).map((item) => item.transitionId),
    ['start']
  );
  assert.deepEqual(engine.allowedActions('task', taskRecord.id, viewer), []);
});

test('rejects permission, state and optimistic version violations', (t) => {
  const { engine, taskRecord } = setup(t);
  assert.throws(() => engine.execute({
    workflowId: 'task_flow', transitionId: 'start', recordId: taskRecord.id,
    expectedVersion: 1, actor: viewer, input: {}
  }), code('PERMISSION_DENIED'));
  assert.throws(() => engine.execute({
    workflowId: 'task_flow', transitionId: 'close', recordId: taskRecord.id,
    expectedVersion: 1, actor: operator, input: {}
  }), code('INVALID_TRANSITION'));
  assert.throws(() => engine.execute({
    workflowId: 'task_flow', transitionId: 'start', recordId: taskRecord.id,
    expectedVersion: 99, actor: operator, input: {}
  }), code('VERSION_CONFLICT'));
});

test('executes whitelisted actions, event and audit in one transaction', (t) => {
  const { database, repository, engine, taskRecord } = setup(t);
  const processing = engine.execute({
    workflowId: 'task_flow', transitionId: 'start', recordId: taskRecord.id,
    expectedVersion: 1, actor: operator, input: {}
  });
  const closed = engine.execute({
    workflowId: 'task_flow', transitionId: 'close', recordId: taskRecord.id,
    expectedVersion: processing.version, actor: operator, input: {}
  });

  assert.equal(closed.values.status, 'closed');
  assert.equal(closed.values.completed, true);
  assert.equal(repository.list('task_event', { page: 1, pageSize: 20 }, operator).total, 1);
  assert.equal(repository.get('project', 1, operator).values.status, 'complete');
  const events = database.prepare('SELECT COUNT(*) AS count FROM sys_workflow_event').get() as { count: number };
  const audits = database.prepare('SELECT COUNT(*) AS count FROM sys_audit_event').get() as { count: number };
  assert.equal(events.count, 2);
  assert.equal(audits.count, 2);
});

test('rolls back the main state when a later action fails', (t) => {
  const { database, repository, engine, taskRecord } = setup(t);
  const processing = engine.execute({
    workflowId: 'task_flow', transitionId: 'start', recordId: taskRecord.id,
    expectedVersion: 1, actor: operator, input: {}
  });
  database.prepare(
    `INSERT INTO biz_task_event
      (code, task_code, version, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`
  ).run(
    'EVENT-CLOSE', 'TASK-1',
    '2026-09-16T08:00:00.000Z', '2026-09-16T08:00:00.000Z'
  );

  assert.throws(() => engine.execute({
    workflowId: 'task_flow', transitionId: 'close', recordId: taskRecord.id,
    expectedVersion: processing.version, actor: operator, input: {}
  }));
  const after = repository.get('task', taskRecord.id, operator);
  assert.equal(after.values.status, 'processing');
  assert.equal(after.values.completed, false);
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
