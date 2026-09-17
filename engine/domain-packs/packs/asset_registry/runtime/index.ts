import type { DatabaseSync } from 'node:sqlite';

import { AppError } from '../../../../desktop-runtime/src/shared/errors';

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

interface AssetRow {
  readonly id: number;
  readonly code: string;
  readonly status: AssetStatus;
  readonly version: number;
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

export class AssetLifecycleService {
  changeStatus(
    request: ChangeAssetStatusRequest,
    context: AssetLifecycleContext
  ): AssetLifecycleResult {
    const reason = requireReason(request.reason);
    context.requirePermission(context.actor, PERMISSION);

    const asset = context.connection.prepare(
      'SELECT id, code, status, version FROM biz_asset WHERE id = ?'
    ).get(request.assetId) as AssetRow | undefined;
    if (!asset) throw new AppError('NOT_FOUND', 'Asset was not found.');
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
}

export const assetRuntimeDescriptor = Object.freeze({
  id: 'asset_registry',
  version: '1.0.0',
  services: Object.freeze(['AssetLifecycleService'])
});
