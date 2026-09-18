import test from 'node:test';
import assert from 'node:assert/strict';
import { InspectionService } from '../../packs/inspection_rectification/runtime/inspection-service';
import { createInspectionTestRuntime, executor, inspectionContext, planner } from '../helpers/inspection-runtime';

test('reads task and dashboard summaries from current SQLite state', (t) => {
  const runtime = createInspectionTestRuntime(t); const service = new InspectionService();
  const task = runtime.database.transaction((c) => service.createTask({ planCode: 'PLAN-1', title: '汇总任务', executorId: executor.username, scheduledAt: '2026-09-19T08:00:00.000Z', items: [{ name: '一', standard: '正常' }, { name: '二', standard: '正常' }, { name: '三', standard: '正常' }] }, inspectionContext(c, planner)));
  const started = runtime.database.transaction((c) => service.startTask({ taskId: task.taskId, expectedTaskVersion: 1 }, inspectionContext(c, executor)));
  const normal = runtime.database.transaction((c) => service.recordItemResult({ taskId: task.taskId, itemId: task.itemIds[0]!, expectedTaskVersion: started.version, expectedItemVersion: 1, result: 'normal', finding: null, disposition: null }, inspectionContext(c, executor)));
  runtime.database.transaction((c) => service.recordItemResult({ taskId: task.taskId, itemId: task.itemIds[1]!, expectedTaskVersion: normal.taskVersion, expectedItemVersion: 1, result: 'abnormal', finding: '异常', disposition: '处置' }, inspectionContext(c, executor)));
  assert.deepEqual(service.readTaskSummary(task.taskId, inspectionContext(runtime.database, planner)), { total: 3, pending: 1, normal: 1, abnormal: 1 });
  assert.deepEqual(service.readDashboardSummary(inspectionContext(runtime.database, planner)), { total: 1, pending: 0, executing: 1, pendingReview: 0, archived: 0, abnormalItems: 1 });
});
