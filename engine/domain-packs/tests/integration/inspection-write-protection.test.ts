import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { InspectionService } from '../../packs/inspection_rectification/runtime/inspection-service';
import { admin, createInspectionTestRuntime, executor, inspectionContext, planner } from '../helpers/inspection-runtime';

test('blocks generic writes for every inspection entity', (t) => {
  const runtime = createInspectionTestRuntime(t); const service = new InspectionService();
  const task = runtime.database.transaction((c) => service.createTask({ planCode: 'PLAN-1', title: '保护任务', executorId: executor.username, scheduledAt: '2026-09-19T08:00:00.000Z', items: [{ name: '项目', standard: '正常' }] }, inspectionContext(c, planner)));
  for (const entityId of ['inspection_plan', 'inspection_task', 'inspection_item', 'inspection_event']) {
    assert.throws(() => runtime.repository.create(entityId, {}, admin), denied);
  }
  const targets = [
    ['inspection_plan', 1], ['inspection_task', task.taskId],
    ['inspection_item', task.itemIds[0]!], ['inspection_event', 1]
  ] as const;
  for (const [entityId, id] of targets) {
    assert.throws(() => runtime.repository.update(entityId, id, 1, { code: 'CHANGED' }, admin), denied);
  }
});
function denied(error: unknown) { return error instanceof AppError && error.code === 'PERMISSION_DENIED'; }
