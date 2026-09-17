import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDeadline,
  evaluateDeadline
} from '../../packs/work_order_service/runtime/sla';

test('calculates stable UTC deadlines from positive integer minutes', () => {
  assert.equal(
    calculateDeadline(new Date('2026-09-17T08:00:00.000Z'), 90),
    '2026-09-17T09:30:00.000Z'
  );
  assert.throws(() => calculateDeadline(new Date('invalid'), 30), /valid date/i);
  for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calculateDeadline(new Date('2026-09-17T08:00:00.000Z'), value), /minutes/i);
  }
});

test('evaluates pending, met and overdue deadlines at exact boundaries', () => {
  const due = '2026-09-17T09:00:00.000Z';
  assert.equal(evaluateDeadline(null, due, new Date('2026-09-17T08:59:59.999Z')), 'pending');
  assert.equal(evaluateDeadline(null, due, new Date(due)), 'pending');
  assert.equal(evaluateDeadline(null, due, new Date('2026-09-17T09:00:00.001Z')), 'overdue');
  assert.equal(evaluateDeadline('2026-09-17T08:59:00.000Z', due, new Date('2026-09-18T00:00:00.000Z')), 'met');
  assert.equal(evaluateDeadline(due, due, new Date('2026-09-18T00:00:00.000Z')), 'met');
  assert.equal(evaluateDeadline('2026-09-17T09:00:00.001Z', due, new Date('2026-09-18T00:00:00.000Z')), 'overdue');
});
