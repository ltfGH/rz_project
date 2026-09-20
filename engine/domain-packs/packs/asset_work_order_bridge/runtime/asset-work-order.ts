import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type { AssetLifecycleBlocker } from '../../asset_registry/runtime/index';
import type { CreateWorkOrderRequest, WorkOrderContext, WorkOrderResult } from '../../work_order_service/runtime/types';
import { WorkOrderService } from '../../work_order_service/runtime/work-order-service';

export interface CreateAssetLinkedWorkOrderRequest extends CreateWorkOrderRequest {
  readonly assetId: number;
}

export function createAssetLinkedWorkOrder(
  request: CreateAssetLinkedWorkOrderRequest,
  context: WorkOrderContext
): WorkOrderResult {
  const asset = context.connection.prepare(
    'SELECT code,status FROM biz_asset WHERE id=?'
  ).get(request.assetId) as { code: string; status: string } | undefined;
  if (!asset) throw new AppError('NOT_FOUND', 'Linked asset was not found.');
  if (asset.status === 'inactive') {
    throw new AppError('INVALID_TRANSITION', 'Inactive assets cannot create work orders.');
  }

  const service = new WorkOrderService();
  const result = service.create({
    title: request.title,
    description: request.description,
    serviceCode: request.serviceCode,
    priority: request.priority
  }, context);
  const linked = context.connection.prepare(
    'UPDATE biz_work_order SET asset_code=? WHERE id=? AND asset_code IS NULL'
  ).run(asset.code, result.workOrderId);
  if (Number(linked.changes) !== 1) {
    throw new AppError('VERSION_CONFLICT', 'Work order asset relation could not be saved.');
  }
  return result;
}

export function createOpenWorkOrderAssetBlocker(): AssetLifecycleBlocker {
  return (assetId, connection) => {
    const asset = connection.prepare('SELECT code FROM biz_asset WHERE id=?').get(assetId) as {
      code: string;
    } | undefined;
    if (!asset) return Object.freeze({ blocked: false, code: 'ASSET_NOT_FOUND', message: '' });
    const row = connection.prepare(
      "SELECT COUNT(*) count FROM biz_work_order WHERE asset_code=? AND status!='closed'"
    ).get(asset.code) as { count: number };
    return Number(row.count) > 0
      ? Object.freeze({
        blocked: true,
        code: 'ASSET_HAS_OPEN_WORK_ORDERS',
        message: 'Asset has open work orders.'
      })
      : Object.freeze({
        blocked: false,
        code: 'ASSET_WORK_ORDERS_CLOSED',
        message: ''
      });
  };
}
