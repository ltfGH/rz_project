import type { ActorDto } from '../shared/dto';
import { AppError, fail, ok } from '../shared/errors';
import { IPC_CHANNELS, IPC_REQUEST_SCHEMAS, type IpcChannel } from '../shared/ipc';
import type { ExecuteTransitionRequest, WorkflowEngine } from '../core/workflow-engine';
import type { EntityRepository, ListQuery } from '../core/entity-repository';

export interface IpcRegistrar {
  handle(channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>): void;
}

export interface RuntimeServices {
  auth: {
    login(username: string, password: string): Promise<unknown>;
    logout(token: string): void;
    requireSession(token: string): ActorDto;
  };
  metadata: { read(actor: ActorDto): unknown };
  entities: Pick<EntityRepository, 'list' | 'get' | 'create' | 'update'>;
  workflows: Pick<WorkflowEngine, 'allowedActions' | 'execute'>;
  dashboard: { read(actor: ActorDto): unknown };
  maintenance: {
    createBackup(destinationDirectory: string, actor: ActorDto): Promise<unknown>;
    inspectBackup(databasePath: string, manifestPath: string): unknown;
    restoreBackup(inspection: unknown, confirmation: string, actor: ActorDto): unknown;
  };
}

type Parsed = Record<string, unknown>;

function actorFor(services: RuntimeServices, request: Parsed): ActorDto {
  return services.auth.requireSession(request.token as string);
}

function validationError(error: unknown): AppError {
  let fieldErrors: Array<{ field: string; message: string }> | undefined;
  if (error && typeof error === 'object' && 'issues' in error) {
    fieldErrors = (error.issues as Array<{ path: PropertyKey[]; message: string }>).map((entry) => ({
      field: entry.path.join('.'),
      message: entry.message
    }));
  }
  return new AppError('VALIDATION_FAILED', '请求参数不合法。',
    fieldErrors ? { fieldErrors } : {});
}

export function registerIpcHandlers(ipc: IpcRegistrar, services: RuntimeServices): void {
  const register = (
    channel: IpcChannel,
    action: (request: Parsed) => unknown | Promise<unknown>
  ): void => {
    ipc.handle(channel, async (_event, raw) => {
      try {
        const parsed = IPC_REQUEST_SCHEMAS[channel].parse(raw) as Parsed;
        return ok(await action(parsed));
      } catch (error) {
        if (error instanceof AppError) return fail(error);
        if (error && typeof error === 'object' && 'issues' in error) return fail(validationError(error));
        return fail(new AppError('INTERNAL_ERROR', '操作失败，请使用日志编号联系管理员。'));
      }
    });
  };

  register(IPC_CHANNELS.sessionLogin, (request) => (
    services.auth.login(request.username as string, request.password as string)
  ));
  register(IPC_CHANNELS.sessionLogout, (request) => services.auth.logout(request.token as string));
  register(IPC_CHANNELS.sessionCurrent, (request) => services.auth.requireSession(request.token as string));
  register(IPC_CHANNELS.metadataRead, (request) => services.metadata.read(actorFor(services, request)));
  register(IPC_CHANNELS.entitiesList, (request) => services.entities.list(
    request.entityId as string,
    request.query as ListQuery,
    actorFor(services, request)
  ));
  register(IPC_CHANNELS.entitiesGet, (request) => services.entities.get(
    request.entityId as string, request.id as number, actorFor(services, request)
  ));
  register(IPC_CHANNELS.entitiesCreate, (request) => services.entities.create(
    request.entityId as string,
    request.values as Record<string, unknown>,
    actorFor(services, request)
  ));
  register(IPC_CHANNELS.entitiesUpdate, (request) => services.entities.update(
    request.entityId as string,
    request.id as number,
    request.expectedVersion as number,
    request.values as Record<string, unknown>,
    actorFor(services, request)
  ));
  register(IPC_CHANNELS.workflowsAllowed, (request) => services.workflows.allowedActions(
    request.entityId as string, request.id as number, actorFor(services, request)
  ));
  register(IPC_CHANNELS.workflowsExecute, (request) => services.workflows.execute({
    workflowId: request.workflowId as string,
    transitionId: request.transitionId as string,
    recordId: request.recordId as number,
    expectedVersion: request.expectedVersion as number,
    actor: actorFor(services, request),
    input: request.input as ExecuteTransitionRequest['input']
  }));
  register(IPC_CHANNELS.dashboardRead, (request) => services.dashboard.read(actorFor(services, request)));
  register(IPC_CHANNELS.maintenanceBackup, (request) => services.maintenance.createBackup(
    request.destinationDirectory as string, actorFor(services, request)
  ));
  register(IPC_CHANNELS.maintenanceInspectRestore, (request) => {
    actorFor(services, request);
    return services.maintenance.inspectBackup(
      request.databasePath as string, request.manifestPath as string
    );
  });
  register(IPC_CHANNELS.maintenanceRestore, (request) => services.maintenance.restoreBackup(
    request.inspection,
    request.confirmation as string,
    actorFor(services, request)
  ));
}
