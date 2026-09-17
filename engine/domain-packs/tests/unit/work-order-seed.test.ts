import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorkOrderSeed } from '../../packs/work_order_service/seed/index';

test('generates byte-stable but seed-sensitive work order data', () => {
  const first = generateWorkOrderSeed({ seed: 20260917, serviceCount: 3, orderCount: 20 });
  const second = generateWorkOrderSeed({ seed: 20260917, serviceCount: 3, orderCount: 20 });
  const another = generateWorkOrderSeed({ seed: 20260918, serviceCount: 3, orderCount: 20 });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.notEqual(JSON.stringify(first), JSON.stringify(another));
});

test('emits exact counts, unique codes, complete states and valid references', () => {
  const seed = generateWorkOrderSeed({ seed: 17, serviceCount: 4, orderCount: 25 });
  assert.equal(seed.records.service_catalog.length, 4);
  assert.equal(seed.records.sla_policy.length, 16);
  assert.equal(seed.records.work_order.length, 25);

  for (const records of Object.values(seed.records)) {
    const codes = records.map((record) => record.code);
    assert.equal(new Set(codes).size, codes.length);
  }
  const serviceCodes = new Set(seed.records.service_catalog.map((record) => record.code));
  const slaCodes = new Set(seed.records.sla_policy.map((record) => record.code));
  const orderCodes = new Set(seed.records.work_order.map((record) => record.code));
  assert.ok(seed.records.sla_policy.every((record) => serviceCodes.has(record.service_code)));
  assert.ok(seed.records.work_order.every((record) => (
    serviceCodes.has(record.service_code) && slaCodes.has(record.sla_policy_code)
  )));
  assert.ok(seed.records.work_order_event.every((record) => orderCodes.has(record.work_order_code)));
  assert.deepEqual(new Set(seed.records.work_order.map((record) => record.status)), new Set([
    'pending_dispatch', 'pending_acceptance', 'processing', 'pending_review', 'closed'
  ]));

  for (const order of seed.records.work_order) {
    const events = seed.records.work_order_event.filter((event) => event.work_order_code === order.code);
    assert.equal(events[0]?.event_type, 'created');
    assert.equal(events.at(-1)?.to_status, order.status);
    if (order.status === 'pending_dispatch') {
      assert.equal(order.handler_id, null);
      assert.equal(order.accepted_at, null);
    }
    if (order.status === 'pending_review' || order.status === 'closed') {
      assert.ok(order.resolution);
      assert.ok(order.submitted_at);
    }
    if (order.status === 'closed') assert.ok(order.closed_at);
  }
});

test('uses anonymous operational identities and content', () => {
  const seed = generateWorkOrderSeed({ seed: 42, serviceCount: 2, orderCount: 10 });
  const serialized = JSON.stringify(seed);
  assert.doesNotMatch(serialized, /申请人|有限公司|公司|集团|张[\u4e00-\u9fa5]|李[\u4e00-\u9fa5]/);
  assert.ok(seed.records.work_order.every((record) => /^调度岗位-\d{2}$/.test(record.requester_id)));
  assert.ok(seed.records.work_order.filter((record) => record.handler_id !== null).every(
    (record) => /^处理岗位-\d{2}$/.test(record.handler_id!)
  ));
});

test('rejects invalid deterministic seed parameters', () => {
  const valid = { seed: 1, serviceCount: 1, orderCount: 5 };
  for (const options of [
    { ...valid, seed: 1.5 },
    { ...valid, seed: 0x1_0000_0000 },
    { ...valid, serviceCount: 0 },
    { ...valid, serviceCount: 51 },
    { ...valid, orderCount: 4 },
    { ...valid, orderCount: 10_001 }
  ]) {
    assert.throws(() => generateWorkOrderSeed(options), RangeError);
  }
});
