import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type test from 'node:test';

import { openDatabase, type RuntimeDatabase } from '../../src/core/database';
import { compileSchema, type CompiledSchema } from '../../src/core/schema-compiler';
import type { RuntimeBlueprint } from '../../src/shared/blueprint';
import type { ActorDto } from '../../src/shared/dto';

export const adminActor: ActorDto = {
  userId: 1,
  username: 'admin',
  displayName: '管理员',
  roleId: 'admin'
};

export function repositoryBlueprint(): RuntimeBlueprint {
  return {
    schemaVersion: '1.0',
    software: { id: 'repository_test', name: '仓储测试软件', version: '1.0.0' },
    plugins: [],
    modules: [
      { id: 'services', name: '服务', route: 'services', entity: 'service', actions: ['list', 'create', 'update', 'view'] },
      { id: 'assets', name: '资产', route: 'assets', entity: 'asset', actions: ['list', 'create', 'update', 'view'] }
    ],
    entities: [
      {
        id: 'service', name: '服务', retention: 'protected', history: false, systemManaged: false,
        fields: [
          { id: 'code', name: '编码', type: 'text', required: true, unique: true },
          { id: 'name', name: '名称', type: 'text', required: true, unique: false }
        ],
        relations: []
      },
      {
        id: 'asset', name: '资产', retention: 'protected', history: false, systemManaged: false,
        fields: [
          { id: 'code', name: '编码', type: 'text', required: true, unique: true },
          { id: 'name', name: '名称', type: 'text', required: true, unique: false },
          {
            id: 'service_id', name: '服务', type: 'reference', required: true, unique: false,
            reference: { entity: 'service', field: 'code' }
          },
          {
            id: 'status', name: '状态', type: 'enum', required: true, unique: false,
            options: ['active', 'inactive'], default: 'active'
          },
          { id: 'quantity', name: '数量', type: 'integer', required: true, unique: false, default: 0 }
        ],
        relations: [
          {
            id: 'asset_service', name: '所属服务', field: 'service_id',
            targetEntity: 'service', targetField: 'code', onDelete: 'restrict'
          }
        ]
      }
    ],
    roles: [{
      id: 'admin', name: '管理员',
      permissions: ['services.list', 'services.create', 'services.update', 'services.view', 'assets.list', 'assets.create', 'assets.update', 'assets.view']
    }]
  };
}

export interface TestRuntime {
  readonly database: RuntimeDatabase;
  readonly blueprint: RuntimeBlueprint;
  readonly schema: CompiledSchema;
}

export function createTestRuntime(t: test.TestContext): TestRuntime {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-'));
  const blueprint = repositoryBlueprint();
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { database, blueprint, schema };
}
