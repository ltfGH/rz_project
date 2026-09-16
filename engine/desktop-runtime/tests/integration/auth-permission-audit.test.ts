import test from 'node:test';
import assert from 'node:assert/strict';

import { AuditService } from '../../src/core/audit-service';
import { AuthService } from '../../src/core/auth-service';
import { hashPassword } from '../../src/core/passwords';
import { PermissionService } from '../../src/core/permission-service';
import { AppError } from '../../src/shared/errors';
import { adminActor, createTestRuntime } from '../helpers/runtime-fixture';

async function insertUser(
  database: ReturnType<typeof createTestRuntime>['database'],
  values: { username: string; password: string; roleId: string; enabled?: boolean }
): Promise<number> {
  const now = new Date('2026-09-16T08:00:00.000Z').toISOString();
  const result = database.prepare(
    'INSERT INTO sys_user (username, display_name, role_id, password_digest, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    values.username,
    values.username,
    values.roleId,
    await hashPassword(values.password),
    values.enabled === false ? 0 : 1,
    now,
    now
  );
  return Number(result.lastInsertRowid);
}

test('logs in, resolves sessions, logs out and rejects expired sessions', async (t) => {
  const runtime = createTestRuntime(t);
  let now = new Date('2026-09-16T08:00:00.000Z');
  await insertUser(runtime.database, { username: 'admin', password: 'Secret123!', roleId: 'admin' });
  const auth = new AuthService(runtime.database, {
    now: () => now,
    sessionDurationMs: 60_000,
    tokenFactory: () => 'session-token'
  });

  const session = await auth.login('admin', 'Secret123!');
  assert.equal(session.token, 'session-token');
  assert.equal(auth.requireSession(session.token).username, 'admin');

  now = new Date('2026-09-16T08:02:00.000Z');
  assert.throws(() => auth.requireSession(session.token), unauthenticated);

  now = new Date('2026-09-16T08:00:00.000Z');
  const second = await auth.login('admin', 'Secret123!');
  auth.logout(second.token);
  assert.throws(() => auth.requireSession(second.token), unauthenticated);
});

test('rejects disabled users and locks repeated login failures', async (t) => {
  const runtime = createTestRuntime(t);
  let now = new Date('2026-09-16T08:00:00.000Z');
  await insertUser(runtime.database, {
    username: 'disabled', password: 'Secret123!', roleId: 'admin', enabled: false
  });
  await insertUser(runtime.database, {
    username: 'operator', password: 'Secret123!', roleId: 'admin'
  });
  const auth = new AuthService(runtime.database, {
    now: () => now,
    maxAttempts: 2,
    lockDurationMs: 60_000,
    tokenFactory: () => 'token'
  });

  await assert.rejects(() => auth.login('disabled', 'Secret123!'), unauthenticated);
  await assert.rejects(() => auth.login('operator', 'wrong'), unauthenticated);
  await assert.rejects(() => auth.login('operator', 'wrong'), unauthenticated);
  await assert.rejects(() => auth.login('operator', 'Secret123!'), unauthenticated);

  now = new Date('2026-09-16T08:02:00.000Z');
  assert.equal((await auth.login('operator', 'Secret123!')).actor.username, 'operator');
  const row = runtime.database.prepare(
    'SELECT failed_attempts, locked_until FROM sys_user WHERE username = ?'
  ).get('operator') as { failed_attempts: number; locked_until: string | null };
  assert.equal(row.failed_attempts, 0);
  assert.equal(row.locked_until, null);
});

test('checks current blueprint permissions instead of trusting renderer claims', (t) => {
  const runtime = createTestRuntime(t);
  const permissions = new PermissionService(runtime.blueprint);

  permissions.require(adminActor, 'assets.update');
  assert.throws(() => permissions.require(adminActor, 'assets.delete'), (error: unknown) => (
    error instanceof AppError && error.code === 'PERMISSION_DENIED'
  ));
  assert.throws(() => permissions.require({ ...adminActor, roleId: 'missing' }, 'assets.list'), (error: unknown) => (
    error instanceof AppError && error.code === 'PERMISSION_DENIED'
  ));
});

test('appends redacted audit records and exposes no mutation API', (t) => {
  const runtime = createTestRuntime(t);
  const audit = new AuditService('1.0.0');

  runtime.database.transaction((connection) => {
    audit.append(connection, {
      actor: adminActor,
      permission: 'assets.update',
      entityId: 'asset',
      recordId: 9,
      result: 'success',
      details: {
        changed: ['name'],
        password: 'secret',
        token: 'token-value',
        sql: 'select hidden',
        path: 'C:\\private\\db.sqlite'
      }
    });
  });

  const row = runtime.database.prepare('SELECT * FROM sys_audit_event').get() as {
    permission: string;
    detail_json: string;
  };
  assert.equal(row.permission, 'assets.update');
  assert.deepEqual(JSON.parse(row.detail_json), { changed: ['name'] });
  assert.equal('update' in audit, false);
  assert.equal('delete' in audit, false);
});

function unauthenticated(error: unknown): boolean {
  return error instanceof AppError && error.code === 'UNAUTHENTICATED';
}
