import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateCondition } from '../../src/core/workflow-engine';
import { AppError } from '../../src/shared/errors';
import type { RuntimeCondition } from '../../src/shared/blueprint';

test('evaluates the three whitelisted condition types', () => {
  const record = { title: '处理故障', status: 'processing', note: '' };

  assert.equal(evaluateCondition(
    { type: 'required_field', parameters: { field: 'title' } }, record, () => false
  ), true);
  assert.equal(evaluateCondition(
    { type: 'required_field', parameters: { field: 'note' } }, record, () => false
  ), false);
  assert.equal(evaluateCondition(
    { type: 'field_equals', parameters: { field: 'status', value: 'processing' } }, record, () => false
  ), true);
  assert.equal(evaluateCondition(
    { type: 'relation_exists', parameters: { relation: 'task_project' } }, record,
    (relation) => relation === 'task_project'
  ), true);
});

test('fails closed for unknown runtime condition types', () => {
  const condition = { type: 'script', parameters: {} } as unknown as RuntimeCondition;

  assert.throws(
    () => evaluateCondition(condition, {}, () => true),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_TRANSITION'
  );
});
