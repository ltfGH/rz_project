import { app, dialog, ipcMain } from 'electron';
import path from 'node:path';

import { AuditService } from '../core/audit-service';
import { AuthService } from '../core/auth-service';
import { BackupService, type BackupInspection, type DatabaseController } from '../core/backup-service';
import { loadRuntimeBlueprint } from '../core/blueprint-loader';
import { DashboardService } from '../core/dashboard-service';
import { openDatabase, type RuntimeDatabase } from '../core/database';
import { EntityRepository } from '../core/entity-repository';
import { PermissionService } from '../core/permission-service';
import { PluginRegistry } from '../core/plugin-registry';
import { verifyProjectResources } from '../core/project-lock';
import { compileSchema } from '../core/schema-compiler';
import { seedAcceptanceData } from '../core/seed';
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
  const blueprint = loadRuntimeBlueprint(
    verified.blueprintText,
    verified.blueprintSha256,
    new PluginRegistry()
  );
  const schema = compileSchema(blueprint);
  const databasePath = path.join(app.getPath('userData'), 'runtime.sqlite');
  let database: RuntimeDatabase = openDatabase({ filename: databasePath });
  database.migrate(schema);
  const seed = JSON.parse(verified.seedText) as Parameters<typeof seedAcceptanceData>[1];
  seedAcceptanceData(database, seed);

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
  const services: RuntimeServices = {
    auth,
    metadata: {
      read: () => ({
        software: blueprint.software,
        modules: (blueprint.modules ?? []).filter((module) => module.id !== 'maintenance'),
        entities: blueprint.entities ?? [],
        workflows: blueprint.workflows ?? []
      })
    },
    entities,
    workflows,
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
