import type { DatabaseSync } from 'node:sqlite';

import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type {
  PluginContributionSink,
  PluginDescriptor
} from '../../../../desktop-runtime/src/core/plugin-registry';
import { runAssetAcceptanceScenario } from '../tests/index';
import { assetUiDescriptor } from '../ui/index';

export type AssetStatus = 'active' | 'maintenance' | 'inactive';

export interface AssetLifecycleActor {
  readonly userId: number;
  readonly username: string;
  readonly displayName: string;
  readonly roleId: string;
}

export interface AssetLifecycleBlockerResult {
  readonly blocked: boolean;
  readonly code: string;
  readonly message: string;
}

export type AssetLifecycleBlocker = (
  assetId: number,
  connection: DatabaseSync
) => AssetLifecycleBlockerResult;

export interface AssetAuditEntry {
  readonly actor: AssetLifecycleActor;
  readonly permission: string;
  readonly entityId: 'asset';
  readonly recordId: number;
  readonly result: 'success';
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AssetLifecycleContext {
  readonly connection: DatabaseSync;
  readonly actor: AssetLifecycleActor;
  readonly requirePermission: (actor: AssetLifecycleActor, permission: string) => void;
  readonly appendAudit: (connection: DatabaseSync, entry: AssetAuditEntry) => void;
  readonly blockers: readonly AssetLifecycleBlocker[];
  readonly now: () => Date;
  readonly eventCode: () => string;
}

export interface ChangeAssetStatusRequest {
  readonly assetId: number;
  readonly expectedVersion: number;
  readonly nextStatus: AssetStatus;
  readonly reason: string;
}

export interface AssetLifecycleResult {
  readonly assetId: number;
  readonly assetCode: string;
  readonly fromStatus: AssetStatus;
  readonly toStatus: AssetStatus;
  readonly version: number;
  readonly eventCode: string;
}

export interface AssignAssetResponsibilityRequest {
  readonly assetId: number;
  readonly expectedVersion: number;
  readonly responsibilityCode: string;
  readonly assignee: string;
  readonly reason: string;
}

export interface AssetResponsibilityResult {
  readonly assetId: number;
  readonly assetCode: string;
  readonly assetVersion: number;
  readonly responsibilityId: number;
  readonly responsibilityCode: string;
  readonly assignee: string;
  readonly previousAssignee: string | null;
  readonly eventCode: string;
}

interface AssetRow {
  readonly id: number;
  readonly code: string;
  readonly status: AssetStatus;
  readonly version: number;
}

interface ActiveResponsibilityRow {
  readonly id: number;
  readonly version: number;
  readonly assignee: string;
}

const PERMISSION = 'assets.change_status';
const TRANSITIONS: Readonly<Record<AssetStatus, ReadonlySet<AssetStatus>>> = Object.freeze({
  active: new Set<AssetStatus>(['maintenance', 'inactive']),
  maintenance: new Set<AssetStatus>(['active', 'inactive']),
  inactive: new Set<AssetStatus>(['active'])
});

function requireReason(reason: string): string {
  const value = reason.trim();
  if (!value) throw new AppError('VALIDATION_FAILED', 'A status change reason is required.');
  return value;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError('VALIDATION_FAILED', `${field} is required.`);
  }
  return normalized;
}

function readAsset(assetId: number, connection: DatabaseSync): AssetRow {
  const asset = connection.prepare(
    'SELECT id, code, status, version FROM biz_asset WHERE id = ?'
  ).get(assetId) as AssetRow | undefined;
  if (!asset) throw new AppError('NOT_FOUND', 'Asset was not found.');
  return asset;
}

export class AssetLifecycleService {
  changeStatus(
    request: ChangeAssetStatusRequest,
    context: AssetLifecycleContext
  ): AssetLifecycleResult {
    const reason = requireReason(request.reason);
    context.requirePermission(context.actor, PERMISSION);

    const asset = readAsset(request.assetId, context.connection);
    if (asset.version !== request.expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'Asset was changed by another operation.');
    }
    if (!TRANSITIONS[asset.status].has(request.nextStatus)) {
      throw new AppError('INVALID_TRANSITION', 'The requested asset status transition is not allowed.');
    }

    if (request.nextStatus === 'inactive') {
      for (const blocker of context.blockers) {
        const result = blocker(asset.id, context.connection);
        if (result.blocked) {
          throw new AppError('INVALID_TRANSITION', result.message, {
            details: { blockerCode: result.code }
          });
        }
      }
    }

    const occurredAt = context.now().toISOString();
    const eventCode = context.eventCode();
    const update = context.connection.prepare(
      'UPDATE biz_asset SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
    ).run(request.nextStatus, occurredAt, asset.id, request.expectedVersion);
    if (Number(update.changes) !== 1) {
      throw new AppError('VERSION_CONFLICT', 'Asset was changed by another operation.');
    }

    context.connection.prepare(
      `INSERT INTO biz_asset_event
        (code, asset_code, event_type, from_status, to_status, reason, occurred_at, version, created_at, updated_at)
       VALUES (?, ?, 'status_changed', ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      eventCode,
      asset.code,
      asset.status,
      request.nextStatus,
      reason,
      occurredAt,
      occurredAt,
      occurredAt
    );

    context.appendAudit(context.connection, Object.freeze({
      actor: context.actor,
      permission: PERMISSION,
      entityId: 'asset',
      recordId: asset.id,
      result: 'success',
      details: Object.freeze({
        eventCode,
        fromStatus: asset.status,
        toStatus: request.nextStatus,
        reason
      })
    }));

    return Object.freeze({
      assetId: asset.id,
      assetCode: asset.code,
      fromStatus: asset.status,
      toStatus: request.nextStatus,
      version: asset.version + 1,
      eventCode
    });
  }

  assertCanDelete(assetId: number, context: AssetLifecycleContext): void {
    const asset = readAsset(assetId, context.connection);
    const history = context.connection.prepare(
      `SELECT
        (SELECT COUNT(*) FROM biz_asset_event WHERE asset_code = ?) AS event_count,
        (SELECT COUNT(*) FROM biz_asset_responsibility WHERE asset_code = ?) AS responsibility_count`
    ).get(asset.code, asset.code) as { event_count: number; responsibility_count: number };
    if (history.event_count > 0 || history.responsibility_count > 0) {
      throw new AppError('INVALID_TRANSITION', 'Assets with history cannot be deleted.', {
        details: {
          eventCount: history.event_count,
          responsibilityCount: history.responsibility_count
        }
      });
    }
  }

  assignResponsibility(
    request: AssignAssetResponsibilityRequest,
    context: AssetLifecycleContext
  ): AssetResponsibilityResult {
    const responsibilityCode = requireText(request.responsibilityCode, 'Responsibility code');
    const assignee = requireText(request.assignee, 'Assignee');
    const reason = requireReason(request.reason);
    context.requirePermission(context.actor, 'asset_responsibilities.create');

    const asset = readAsset(request.assetId, context.connection);
    if (asset.version !== request.expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'Asset was changed by another operation.');
    }
    const active = context.connection.prepare(
      'SELECT id, version, assignee FROM biz_asset_responsibility WHERE asset_code = ? AND active = 1 ORDER BY id DESC LIMIT 1'
    ).get(asset.code) as ActiveResponsibilityRow | undefined;
    if (active?.assignee === assignee) {
      throw new AppError('INVALID_TRANSITION', 'The assignee already owns the active responsibility.');
    }
    if (active) context.requirePermission(context.actor, 'asset_responsibilities.end');

    const occurredAt = context.now().toISOString();
    const update = context.connection.prepare(
      'UPDATE biz_asset SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
    ).run(occurredAt, asset.id, request.expectedVersion);
    if (Number(update.changes) !== 1) {
      throw new AppError('VERSION_CONFLICT', 'Asset was changed by another operation.');
    }

    if (active) {
      const ended = context.connection.prepare(
        `UPDATE biz_asset_responsibility
         SET active = 0, ended_at = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND active = 1`
      ).run(occurredAt, occurredAt, active.id, active.version);
      if (Number(ended.changes) !== 1) {
        throw new AppError('VERSION_CONFLICT', 'Active responsibility was changed by another operation.');
      }
    }

    let responsibilityId: number;
    try {
      const inserted = context.connection.prepare(
        `INSERT INTO biz_asset_responsibility
          (code, asset_code, assignee, started_at, ended_at, active, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 1, 1, ?, ?)`
      ).run(responsibilityCode, asset.code, assignee, occurredAt, occurredAt, occurredAt);
      responsibilityId = Number(inserted.lastInsertRowid);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        throw new AppError('UNIQUE_CONFLICT', 'Responsibility code already exists.');
      }
      throw error;
    }

    const eventCode = context.eventCode();
    context.connection.prepare(
      `INSERT INTO biz_asset_event
        (code, asset_code, event_type, from_status, to_status, reason, occurred_at, version, created_at, updated_at)
       VALUES (?, ?, 'responsibility_changed', NULL, NULL, ?, ?, 1, ?, ?)`
    ).run(eventCode, asset.code, reason, occurredAt, occurredAt, occurredAt);

    context.appendAudit(context.connection, Object.freeze({
      actor: context.actor,
      permission: 'asset_responsibilities.create',
      entityId: 'asset',
      recordId: asset.id,
      result: 'success',
      details: Object.freeze({
        eventCode,
        responsibilityCode,
        previousAssignee: active?.assignee ?? null,
        assignee,
        reason
      })
    }));

    return Object.freeze({
      assetId: asset.id,
      assetCode: asset.code,
      assetVersion: asset.version + 1,
      responsibilityId,
      responsibilityCode,
      assignee,
      previousAssignee: active?.assignee ?? null,
      eventCode
    });
  }
}

function register(
  registry: PluginContributionSink,
  contributionId: string,
  contribution: unknown
): void {
  registry.register('asset_registry', contributionId, contribution);
}

export const assetRuntimeDescriptor = Object.freeze({
  id: 'asset_registry',
  version: '1.0.0',
  blueprintSchemaVersions: Object.freeze(['1.0']),
  runtimeVersions: Object.freeze(['1.0.0']),
  validateConfig: (config) => {
    if (Object.keys(config).length > 0) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Asset registry configuration contains unsupported properties.');
    }
  },
  registerMigrations: (registry) => register(
    registry,
    'asset_registry.v1',
    Object.freeze({ version: 1, owner: 'asset_registry' })
  ),
  registerServices: (registry) => register(
    registry,
    'asset.lifecycle',
    Object.freeze({ create: () => new AssetLifecycleService() })
  ),
  registerIpc: (registry) => {
    register(registry, 'asset.change_status', Object.freeze({
      service: 'asset.lifecycle', method: 'changeStatus', permission: 'assets.change_status'
    }));
    register(registry, 'asset.assign_responsibility', Object.freeze({
      service: 'asset.lifecycle', method: 'assignResponsibility',
      permission: 'asset_responsibilities.create'
    }));
  },
  registerUiExtensions: (registry) => {
    for (const extension of assetUiDescriptor.extensions) {
      register(registry, extension.id, extension);
    }
  },
  registerAcceptanceScenarios: (registry) => register(
    registry,
    'asset.lifecycle.acceptance',
    runAssetAcceptanceScenario
  )
} satisfies PluginDescriptor & { readonly runtimeVersions: readonly string[] });
