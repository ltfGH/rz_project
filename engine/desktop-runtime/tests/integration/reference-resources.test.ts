import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openDatabase } from '../../src/core/database';
import { DomainCommandService } from '../../src/core/domain-command-service';
import { PermissionService } from '../../src/core/permission-service';
import { PluginHost } from '../../src/core/plugin-host';
import { PluginRegistry } from '../../src/core/plugin-registry';
import { verifyProjectResources } from '../../src/core/project-lock';
import { loadProductionPluginCatalog } from '../../src/core/production-plugin-loader';
import { compileSchema } from '../../src/core/schema-compiler';
import { seedProjectData } from '../../src/core/seed';

const root = path.resolve(__dirname, '..', '..');

test('assembles and activates a deterministic reference project through production paths', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-resources-'));
  const first = path.join(parent, 'first');
  const second = path.join(parent, 'second');
  const project = path.join(root, 'reference', 'asset-operations', 'project.json');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  for (const output of [first, second]) {
    const result = spawnSync(process.execPath, [
      path.join(root, 'tools', 'build-project-resources.cjs'),
      '--project', project, '--output', output
    ], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const verified = verifyProjectResources(first);
  const repeated = verifyProjectResources(second);
  for (const name of [
    'blueprint.json', 'seed.json', 'domain-lock.json', 'project.lock.json',
    'production-runtime-catalog.cjs'
  ]) {
    assert.deepEqual(fs.readFileSync(path.join(first, name)), fs.readFileSync(path.join(second, name)));
  }
  const blueprint = JSON.parse(verified.blueprintText);
  const seed = JSON.parse(verified.seedText);
  assert.equal(blueprint.modules.length, 13);
  assert.equal(blueprint.plugins.length, 6);
  assert.equal(seed.report.countedBusinessRows, 1000);
  assert.deepEqual(verified.projectLock.packs, repeated.projectLock.packs);

  const database = openDatabase({ filename: path.join(parent, 'reference.sqlite') });
  database.migrate(compileSchema(blueprint));
  seedProjectData(database, seed);
  seedProjectData(database, seed);
  let total = 0;
  for (const [name, count] of Object.entries(seed.report.counts) as Array<[string, number]>) {
    const row = database.prepare(`SELECT COUNT(*) count FROM biz_${name}`).get() as { count: number };
    assert.equal(row.count, count);
    total += row.count;
  }
  assert.equal(total, 1000);
  assert.equal((database.prepare('SELECT COUNT(*) count FROM sys_user').get() as { count: number }).count, 4);

  const registry = new PluginRegistry();
  for (const descriptor of loadProductionPluginCatalog(verified.productionCatalogPath)) {
    registry.register(descriptor);
  }
  registry.assertCompatible(blueprint.plugins, blueprint.schemaVersion);
  registry.assertLocked(verified.domainLock);
  const pluginHost = new PluginHost();
  registry.activate(blueprint.plugins, pluginHost, verified.domainLock.dependencyOrder);
  const plugins = pluginHost.freeze();
  assert.deepEqual(plugins.activationOrder, verified.domainLock.dependencyOrder);

  const domain = new DomainCommandService({
    database: () => database,
    blueprint,
    plugins,
    permissions: new PermissionService(blueprint)
  });
  domain.execute('inspection.record', {
    taskId: 6,
    itemId: 6,
    expectedTaskVersion: 1,
    expectedItemVersion: 1,
    result: 'abnormal',
    finding: '运行温度异常',
    disposition: '自动创建整改工单'
  }, {
    userId: 2,
    username: 'operator',
    displayName: '处理人员',
    roleId: 'operations_operator'
  });
  assert.equal((database.prepare('SELECT COUNT(*) count FROM biz_work_order').get() as { count: number }).count, 151);
  assert.equal((database.prepare('SELECT COUNT(*) count FROM biz_inspection_work_order_link').get() as { count: number }).count, 6);
  database.close();
});
