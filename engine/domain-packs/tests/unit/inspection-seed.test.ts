import test from 'node:test';
import assert from 'node:assert/strict';
import { generateInspectionSeed } from '../../packs/inspection_rectification/seed/index';

test('generates stable seed-sensitive inspection data', () => {
  const a = generateInspectionSeed({ seed: 20260918, planCount: 3, taskCount: 16 });
  const b = generateInspectionSeed({ seed: 20260918, planCount: 3, taskCount: 16 });
  const c = generateInspectionSeed({ seed: 20260919, planCount: 3, taskCount: 16 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a), JSON.stringify(c));
});

test('emits valid references, unique codes and consistent state data', () => {
  const seed = generateInspectionSeed({ seed: 17, planCount: 4, taskCount: 20 });
  assert.equal(seed.records.inspection_plan.length, 4);
  assert.equal(seed.records.inspection_task.length, 20);
  for (const records of Object.values(seed.records)) {
    const codes = records.map((record) => record.code);
    assert.equal(new Set(codes).size, codes.length);
  }
  const plans = new Set(seed.records.inspection_plan.map((record) => record.code));
  const tasks = new Set(seed.records.inspection_task.map((record) => record.code));
  assert.ok(seed.records.inspection_task.every((record) => plans.has(record.plan_code)));
  assert.ok(seed.records.inspection_item.every((record) => tasks.has(record.task_code)));
  assert.ok(seed.records.inspection_event.every((record) => tasks.has(record.task_code)));
  assert.deepEqual(new Set(seed.records.inspection_task.map((record) => record.status)), new Set([
    'pending', 'executing', 'pending_review', 'archived'
  ]));
  for (const task of seed.records.inspection_task) {
    const items = seed.records.inspection_item.filter((item) => item.task_code === task.code);
    assert.ok(items.length >= 2 && items.length <= 6);
    const events = seed.records.inspection_event.filter((event) => event.task_code === task.code);
    assert.equal(events[0]?.event_type, 'created');
    assert.equal(events.at(-1)?.to_status, task.status);
    if (task.status === 'pending_review' || task.status === 'archived') {
      assert.ok(items.every((item) => item.result !== 'pending'));
    }
    assert.ok(items.filter((item) => item.result === 'abnormal').every(
      (item) => Boolean(item.finding && item.disposition)
    ));
    if (task.status === 'archived') assert.ok(task.archived_at);
  }
});

test('uses only anonymous operational identities and validates parameter bounds', () => {
  const seed = generateInspectionSeed({ seed: 42, planCount: 2, taskCount: 8 });
  const text = JSON.stringify(seed);
  assert.doesNotMatch(text, /申请人|有限公司|公司|集团|张[\u4e00-\u9fa5]|李[\u4e00-\u9fa5]/);
  assert.ok(seed.records.inspection_task.every((task) => /^执行岗位-\d{2}$/.test(task.executor_id)));
  const valid = { seed: 1, planCount: 1, taskCount: 4 };
  for (const options of [
    { ...valid, seed: 1.5 }, { ...valid, seed: 0x1_0000_0000 },
    { ...valid, seed: -1 },
    { ...valid, planCount: 0 }, { ...valid, planCount: 51 },
    { ...valid, taskCount: 3 }, { ...valid, taskCount: 10_001 }
  ]) assert.throws(() => generateInspectionSeed(options), RangeError);
});
