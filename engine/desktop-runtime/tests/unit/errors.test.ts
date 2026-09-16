import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError, fail, ok } from '../../src/shared/errors';

test('serializes successful results without changing data', () => {
  assert.deepEqual(ok({ id: 1 }), { ok: true, data: { id: 1 } });
});

test('serializes expected errors without stack or sensitive details', () => {
  const error = new AppError('VERSION_CONFLICT', '记录已被更新', {
    details: {
      entity: 'asset',
      password: 'secret',
      token: 'token-value',
      digest: 'digest-value',
      sql: 'select secret',
      path: 'C:\\private\\database.sqlite'
    }
  });

  const result = fail(error);

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'VERSION_CONFLICT',
      message: '记录已被更新',
      retryable: true,
      details: { entity: 'asset' }
    }
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /secret|token-value|digest-value|select secret|private/i);
  assert.doesNotMatch(serialized, /stack|cause/i);
});

test('preserves field validation errors as frozen data', () => {
  const error = new AppError('VALIDATION_FAILED', '输入不合法', {
    fieldErrors: [{ field: 'name', message: '名称不能为空' }]
  });

  const result = fail(error);

  assert.deepEqual(result.error.fieldErrors, [{ field: 'name', message: '名称不能为空' }]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
});
