import path from 'node:path';
import { PluginHost } from '../../../desktop-runtime/src/core/plugin-host';
import { PluginRegistry } from '../../../desktop-runtime/src/core/plugin-registry';
import type { RuntimeBlueprint } from '../../../desktop-runtime/src/shared/blueprint';
import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import type { CompositionResult, JsonValue } from '../../src/shared/types';
import { productionPluginDescriptors } from '../../src/runtime/production-catalog';

const CONFIG: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = Object.freeze({
  application_archive: Object.freeze({ approval_levels: 1, reminder_days: 30 }),
  inventory_batch: Object.freeze({ quantity_scale: 0 }),
  inspection_work_order_bridge: Object.freeze({ service_code: 'SVC-RECTIFICATION', priority: 'normal' })
});

export function loadProductionPacks(ids: readonly string[]): PackRegistry {
  const registry = new PackRegistry();
  for (const id of ids) registry.register(loadPack(path.resolve(__dirname, '..', '..', 'packs', id)));
  return registry;
}

export function composeProduction(ids: readonly string[]): CompositionResult {
  return composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: { id: 'matrix_test', name: '领域组合矩阵测试', version: '1.0.0', purpose: '验证生产领域组合', targetUsers: ['业务人员'], boundaries: ['离线'], loginMode: 'required' },
    selections: ids.map((id) => ({ id, version: '1.0.0', config: CONFIG[id] ?? {} })),
    coverage: { supported: ['生产组合矩阵'], unsupported: [] },
    materials: { developmentPurpose: '验证生产组合矩阵', industry: '企业管理', technicalFeatures: ['SQLite事务'] }
  }, loadProductionPacks(ids));
}

export function activateProduction(result: CompositionResult) {
  if (!result.blueprint || !result.lock) throw new Error(result.summary || 'Composition has no output.');
  const registry = new PluginRegistry();
  for (const descriptor of productionPluginDescriptors) registry.register(descriptor);
  const blueprint = result.blueprint as unknown as RuntimeBlueprint;
  registry.assertCompatible(blueprint.plugins, blueprint.schemaVersion);
  registry.assertLocked(result.lock);
  const host = new PluginHost();
  registry.activate(blueprint.plugins, host, result.lock.dependencyOrder);
  return host.freeze();
}
