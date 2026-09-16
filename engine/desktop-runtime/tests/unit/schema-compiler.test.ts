import test from 'node:test';
import assert from 'node:assert/strict';

import { compileSchema } from '../../src/core/schema-compiler';
import type { RuntimeBlueprint } from '../../src/shared/blueprint';
import { AppError } from '../../src/shared/errors';

function blueprint(): RuntimeBlueprint {
  return {
    schemaVersion: '1.0',
    software: { id: 'asset_demo', name: '资产管理软件', version: '1.0.0' },
    plugins: [],
    entities: [
      {
        id: 'service', name: '服务', retention: 'protected', history: false, systemManaged: false,
        fields: [
          { id: 'code', name: '编码', type: 'text', required: true, unique: true },
          { id: 'enabled', name: '启用', type: 'boolean', required: true, unique: false, default: true }
        ],
        relations: []
      },
      {
        id: 'asset', name: '资产', retention: 'protected', history: false, systemManaged: false,
        fields: [
          { id: 'code', name: '编码', type: 'text', required: true, unique: true },
          {
            id: 'service_id', name: '服务', type: 'reference', required: true, unique: false,
            reference: { entity: 'service', field: 'code' }
          },
          { id: 'count', name: '数量', type: 'integer', required: true, unique: false, default: 0 },
          { id: 'cost', name: '成本', type: 'decimal', required: false, unique: false },
          { id: 'installed_on', name: '安装日期', type: 'date', required: false, unique: false },
          {
            id: 'status', name: '状态', type: 'enum', required: true, unique: false,
            options: ['active', 'inactive'], default: 'active'
          }
        ],
        relations: [
          {
            id: 'asset_service', name: '所属服务', field: 'service_id',
            targetEntity: 'service', targetField: 'code', onDelete: 'restrict'
          }
        ]
      },
      {
        id: 'audit_record', name: '审计', retention: 'append_only', history: true, systemManaged: true,
        fields: [{ id: 'action', name: '操作', type: 'text', required: true, unique: false }],
        relations: []
      }
    ]
  };
}

test('compiles deterministic business and system migrations', () => {
  const first = compileSchema(blueprint());
  const second = compileSchema(blueprint());
  const sql = first.migrations.flatMap((migration) => migration.statements).join('\n');

  assert.deepEqual(first, second);
  assert.equal(first.version, 1);
  assert.equal(first.entityTables.asset, 'biz_asset');
  assert.equal(first.entityTables.service, 'biz_service');
  assert.match(sql, /CREATE TABLE "biz_service"/);
  assert.match(sql, /"code" TEXT NOT NULL UNIQUE/);
  assert.match(sql, /"enabled" INTEGER NOT NULL DEFAULT 1/);
  assert.match(sql, /CREATE TABLE "biz_asset"/);
  assert.match(sql, /"count" INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /"cost" REAL/);
  assert.match(sql, /"installed_on" TEXT/);
  assert.match(sql, /FOREIGN KEY \("service_id"\) REFERENCES "biz_service" \("code"\) ON DELETE RESTRICT/);
  assert.match(sql, /CHECK \("status" IN \('active', 'inactive'\)\)/);
  assert.match(sql, /CREATE TABLE "sys_migration"/);
  assert.match(sql, /CREATE TABLE "sys_user"/);
  assert.match(sql, /CREATE TABLE "sys_audit_event"/);
  assert.ok(first.systemTables.includes('sys_backup_manifest'));
  assert.match(first.digest, /^[0-9a-f]{64}$/);
});

test('rejects unsafe identifiers even when upstream validation is bypassed', () => {
  const value = blueprint();
  (value.entities as Array<{ id: string }>)[0]!.id = 'bad";drop_table';

  assert.throws(
    () => compileSchema(value),
    (error: unknown) => error instanceof AppError && error.code === 'BLUEPRINT_INCOMPATIBLE'
  );
});

test('rejects defaults incompatible with declared field types', () => {
  const value = blueprint();
  const countField = value.entities![1]!.fields[2]! as { default?: unknown };
  countField.default = 'not-an-integer';

  assert.throws(
    () => compileSchema(value),
    (error: unknown) => error instanceof AppError && error.code === 'BLUEPRINT_INCOMPATIBLE'
  );
});
