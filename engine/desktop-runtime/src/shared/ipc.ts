export const IPC_CHANNELS = Object.freeze({
  sessionLogin: 'business:session:login',
  sessionLogout: 'business:session:logout',
  sessionCurrent: 'business:session:current',
  metadataRead: 'business:metadata:read',
  entitiesList: 'business:entities:list',
  entitiesGet: 'business:entities:get',
  entitiesCreate: 'business:entities:create',
  entitiesUpdate: 'business:entities:update',
  workflowsAllowed: 'business:workflows:allowed',
  workflowsExecute: 'business:workflows:execute',
  dashboardRead: 'business:dashboard:read',
  maintenanceBackup: 'business:maintenance:backup',
  maintenanceInspectRestore: 'business:maintenance:inspect-restore',
  maintenanceRestore: 'business:maintenance:restore'
} as const);

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
