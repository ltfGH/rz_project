import { app, dialog, ipcMain } from 'electron';
import path from 'node:path';

import { AuditService } from '../core/audit-service';
import { AuthService } from '../core/auth-service';
import { BackupService, type BackupInspection, type DatabaseController } from '../core/backup-service';
import { loadRuntimeBlueprint } from '../core/blueprint-loader';
import { DashboardService } from '../core/dashboard-service';
import { DomainCommandService } from '../core/domain-command-service';
import { openDatabase, type RuntimeDatabase } from '../core/database';
import { EntityRepository } from '../core/entity-repository';
import { PermissionService } from '../core/permission-service';
import { PluginHost } from '../core/plugin-host';
import { PluginRegistry } from '../core/plugin-registry';
import { loadProductionPluginCatalog } from '../core/production-plugin-loader';
import { verifyProjectResources } from '../core/project-lock';
import { compileSchema } from '../core/schema-compiler';
import { seedAcceptanceData, seedProjectData } from '../core/seed';
import { WorkflowEngine } from '../core/workflow-engine';
import { registerIpcHandlers, type IpcRegistrar, type RuntimeServices } from './ipc-handlers';
import { createMainWindow } from './window';

function resourceRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'runtime-resources')
    : path.resolve(__dirname, '..', '..', 'resources');
}

function rendererPath(): string {
  return path.resolve(__dirname, '..', '..', 'renderer', 'index.html');
}

function preloadPath(): string {
  return path.resolve(__dirname, '..', 'preload', 'index.js');
}

async function start(): Promise<void> {
  const resources = resourceRoot();
  const verified = verifyProjectResources(resources);
  const registry = new PluginRegistry();
  for (const descriptor of loadProductionPluginCatalog(verified.productionCatalogPath)) {
    registry.register(descriptor);
  }
  const blueprint = loadRuntimeBlueprint(
    verified.blueprintText,
    verified.blueprintSha256,
    registry
  );
  registry.assertLocked(verified.domainLock);
  const pluginHost = new PluginHost();
  registry.activate(blueprint.plugins, pluginHost, verified.domainLock.dependencyOrder);
  const plugins = pluginHost.freeze();
  const schema = compileSchema(blueprint);
  const databasePath = path.join(app.getPath('userData'), 'runtime.sqlite');
  let database: RuntimeDatabase = openDatabase({ filename: databasePath });
  database.migrate(schema);
  const seed = JSON.parse(verified.seedText) as Record<string, unknown>;
  if (seed.formatVersion === '1.0') {
    seedProjectData(database, seed as unknown as Parameters<typeof seedProjectData>[1]);
  } else {
    seedAcceptanceData(database, seed as unknown as Parameters<typeof seedAcceptanceData>[1]);
  }

  const controller: DatabaseController = {
    current: () => database,
    close: () => database.close(),
    reopen: () => {
      database = openDatabase({ filename: databasePath });
      database.migrate(schema);
      return database;
    }
  };
  const permissions = new PermissionService(blueprint);
  const audit = new AuditService(blueprint.software.version ?? '1.0.0');
  const auth = new AuthService(database);
  const entities = new EntityRepository(database, blueprint, schema);
  const workflows = new WorkflowEngine(database, blueprint, schema, permissions, audit);
  const dashboard = new DashboardService(database, blueprint, schema);
  const backup = new BackupService({
    databasePath,
    appId: blueprint.software.id,
    appVersion: blueprint.software.version ?? '1.0.0',
    schemaVersion: schema.version,
    controller,
    permissions,
    audit
  });
  const domain = new DomainCommandService({
    database: () => database,
    blueprint,
    plugins,
    permissions,
    audit
  });
  const services: RuntimeServices = {
    auth,
    metadata: {
      read: (actor) => ({
        software: blueprint.software,
        modules: blueprint.modules ?? [],
        entities: blueprint.entities ?? [],
        workflows: blueprint.workflows ?? [],
        domainActions: Object.values(plugins.uiExtensions).flatMap((entry) => {
          const extension = entry.value as {
            slot?: string; entityId?: string; label?: string; order?: number; actionIds?: readonly string[];
          };
          if (extension.slot !== 'entity.detail.actions' || !extension.entityId) return [];
          return (extension.actionIds ?? []).flatMap((id) => {
            const action = plugins.domainActions[id]?.value as { permission?: string } | undefined;
            if (!action?.permission || !permissions.allows(actor, action.permission)) return [];
            return [{ id, entityId: extension.entityId!, label: extension.label ?? id, order: extension.order ?? 100 }];
          });
        })
      })
    },
    entities,
    workflows,
    domain,
    dashboard,
    maintenance: {
      createBackup: (actor) => backup.createBackup(path.join(app.getPath('userData'), 'backups'), actor),
      inspectBackup: (backupDatabasePath, backupManifestPath, actor) => {
        permissions.require(actor, 'maintenance.restore');
        return backup.inspectBackup(backupDatabasePath, backupManifestPath);
      },
      restoreBackup: (inspection, confirmation, actor) => {
        const result = backup.restoreBackup(inspection as BackupInspection, confirmation, actor);
        setTimeout(() => { app.relaunch(); app.exit(0); }, 100);
        return result;
      }
    }
  };
  const registrar: IpcRegistrar = {
    handle: (channel, handler) => {
      ipcMain.handle(channel, (event, request) => handler(event, request));
    }
  };
  registerIpcHandlers(registrar, services);
  if (process.argv.includes('--verify')) {
    database.close();
    app.exit(0);
    return;
  }
  createMainWindow(rendererPath(), preloadPath());
  app.on('before-quit', () => {
    try { database.close(); } catch { }
  });
}

const overrideUserData = process.env.RZ_RUNTIME_USER_DATA;
if (overrideUserData) app.setPath('userData', path.resolve(overrideUserData));

void app.whenReady().then(start).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup failure';
  dialog.showErrorBox('应用启动失败', message);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
