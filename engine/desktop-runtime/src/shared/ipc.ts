import { z } from 'zod';
import type { JsonValue } from './blueprint';

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
  domainExecute: 'business:domain:execute',
  dashboardRead: 'business:dashboard:read',
  maintenanceBackup: 'business:maintenance:backup',
  maintenanceInspectRestore: 'business:maintenance:inspect-restore',
  maintenanceRestore: 'business:maintenance:restore'
} as const);

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

const token = z.string().min(1).max(512);
const entityId = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const positiveId = z.number().int().positive();
const jsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const filter = z.object({
  field: entityId,
  operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']),
  value: z.union([jsonScalar, z.array(jsonScalar).max(100)])
}).strict();
const listQuery = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
  keyword: z.string().max(200).optional(),
  sort: z.object({ field: entityId, direction: z.enum(['asc', 'desc']) }).strict().optional(),
  filters: z.array(filter).max(20).optional()
}).strict();
const values = z.record(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), jsonScalar);
const domainJson: z.ZodType<JsonValue> = z.lazy(() => z.union([
  jsonScalar,
  z.array(domainJson).max(1000),
  z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), domainJson)
]));
const domainPayload = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), domainJson
).refine((value) => Object.keys(value).length <= 100);

export const IPC_REQUEST_SCHEMAS = {
  [IPC_CHANNELS.sessionLogin]: z.object({
    username: z.string().min(1).max(64), password: z.string().min(1).max(1024)
  }).strict(),
  [IPC_CHANNELS.sessionLogout]: z.object({ token }).strict(),
  [IPC_CHANNELS.sessionCurrent]: z.object({ token }).strict(),
  [IPC_CHANNELS.metadataRead]: z.object({ token }).strict(),
  [IPC_CHANNELS.entitiesList]: z.object({ token, entityId, query: listQuery }).strict(),
  [IPC_CHANNELS.entitiesGet]: z.object({ token, entityId, id: positiveId }).strict(),
  [IPC_CHANNELS.entitiesCreate]: z.object({ token, entityId, values }).strict(),
  [IPC_CHANNELS.entitiesUpdate]: z.object({
    token, entityId, id: positiveId, expectedVersion: z.number().int().positive(), values
  }).strict(),
  [IPC_CHANNELS.workflowsAllowed]: z.object({ token, entityId, id: positiveId }).strict(),
  [IPC_CHANNELS.workflowsExecute]: z.object({
    token,
    workflowId: entityId,
    transitionId: entityId,
    recordId: positiveId,
    expectedVersion: z.number().int().positive(),
    input: values
  }).strict(),
  [IPC_CHANNELS.domainExecute]: z.object({
    token,
    commandId: z.string().regex(/^[a-z][a-z0-9_.]{2,95}$/),
    payload: domainPayload
  }).strict(),
  [IPC_CHANNELS.dashboardRead]: z.object({ token }).strict(),
  [IPC_CHANNELS.maintenanceBackup]: z.object({ token }).strict(),
  [IPC_CHANNELS.maintenanceInspectRestore]: z.object({
    token, databasePath: z.string().min(1).max(32767), manifestPath: z.string().min(1).max(32767)
  }).strict(),
  [IPC_CHANNELS.maintenanceRestore]: z.object({
    token, inspection: z.unknown(), confirmation: z.string().min(1).max(128)
  }).strict()
} satisfies Record<IpcChannel, z.ZodType>;
