import { IPC_CHANNELS, type IpcChannel } from '../shared/ipc';

export type IpcInvoke = (channel: IpcChannel, request: unknown) => Promise<unknown>;

export interface BusinessApi {
  readonly session: {
    login(username: string, password: string): Promise<unknown>;
    logout(token: string): Promise<unknown>;
    current(token: string): Promise<unknown>;
  };
  readonly metadata: { read(token: string): Promise<unknown> };
  readonly entities: {
    list(token: string, entityId: string, query: unknown): Promise<unknown>;
    get(token: string, entityId: string, id: number): Promise<unknown>;
    create(token: string, entityId: string, values: unknown): Promise<unknown>;
    update(token: string, entityId: string, id: number, expectedVersion: number, values: unknown): Promise<unknown>;
  };
  readonly workflows: {
    allowed(token: string, entityId: string, id: number): Promise<unknown>;
    execute(token: string, request: Record<string, unknown>): Promise<unknown>;
  };
  readonly dashboard: { read(token: string): Promise<unknown> };
  readonly maintenance: {
    backup(token: string, destinationDirectory: string): Promise<unknown>;
    inspectRestore(token: string, databasePath: string, manifestPath: string): Promise<unknown>;
    restore(token: string, inspection: unknown, confirmation: string): Promise<unknown>;
  };
}

function frozen<T extends object>(value: T): T {
  return Object.freeze(value);
}

export function createBusinessApi(invoke: IpcInvoke): BusinessApi {
  return frozen({
    session: frozen({
      login: (username: string, password: string) => invoke(IPC_CHANNELS.sessionLogin, { username, password }),
      logout: (token: string) => invoke(IPC_CHANNELS.sessionLogout, { token }),
      current: (token: string) => invoke(IPC_CHANNELS.sessionCurrent, { token })
    }),
    metadata: frozen({ read: (token: string) => invoke(IPC_CHANNELS.metadataRead, { token }) }),
    entities: frozen({
      list: (token: string, entityId: string, query: unknown) => invoke(IPC_CHANNELS.entitiesList, { token, entityId, query }),
      get: (token: string, entityId: string, id: number) => invoke(IPC_CHANNELS.entitiesGet, { token, entityId, id }),
      create: (token: string, entityId: string, values: unknown) => invoke(IPC_CHANNELS.entitiesCreate, { token, entityId, values }),
      update: (token: string, entityId: string, id: number, expectedVersion: number, values: unknown) => (
        invoke(IPC_CHANNELS.entitiesUpdate, { token, entityId, id, expectedVersion, values })
      )
    }),
    workflows: frozen({
      allowed: (token: string, entityId: string, id: number) => invoke(IPC_CHANNELS.workflowsAllowed, { token, entityId, id }),
      execute: (token: string, request: Record<string, unknown>) => invoke(IPC_CHANNELS.workflowsExecute, { token, ...request })
    }),
    dashboard: frozen({ read: (token: string) => invoke(IPC_CHANNELS.dashboardRead, { token }) }),
    maintenance: frozen({
      backup: (token: string, destinationDirectory: string) => invoke(IPC_CHANNELS.maintenanceBackup, { token, destinationDirectory }),
      inspectRestore: (token: string, databasePath: string, manifestPath: string) => (
        invoke(IPC_CHANNELS.maintenanceInspectRestore, { token, databasePath, manifestPath })
      ),
      restore: (token: string, inspection: unknown, confirmation: string) => (
        invoke(IPC_CHANNELS.maintenanceRestore, { token, inspection, confirmation })
      )
    })
  });
}
