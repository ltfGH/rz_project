import type { AssetLifecycleContext, AssetLifecycleBlocker } from './index';
import { AssetLifecycleService } from './index';
import { createServiceActions, type PluginActionContext } from '../../../src/runtime/action-types';

function context(source: PluginActionContext): AssetLifecycleContext {
  return {
    connection: source.connection,
    actor: source.actor,
    requirePermission: source.requirePermission,
    appendAudit: (connection, entry) => source.appendAudit(connection, entry),
    blockers: source.extensions.values<AssetLifecycleBlocker>('asset.lifecycle.blockers'),
    assigneeExists: source.identityExists,
    now: source.now,
    eventCode: () => source.nextCode('asset_event')
  };
}

export function createAssetDomainActions() {
  return createServiceActions(
    new AssetLifecycleService(),
    context,
    [
    { id: 'asset.change_status', method: 'changeStatus', permission: 'assets.change_status' },
    { id: 'asset.assign_responsibility', method: 'assignResponsibility', permission: 'asset_responsibilities.assign' }
    ]
  );
}
