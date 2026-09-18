import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type {
  AdjustStockRequest, InventoryBatchResult, InventoryContext, InventoryExpiryStatus,
  InventoryIssueBlockerRequest, InventoryMovementResult, InventoryRecentTransaction,
  InventorySummary, IssueStockRequest, MaterialInput, MaterialResult,
  ReceiveExistingBatchRequest, ReceiveNewBatchRequest, ReturnStockRequest,
  UpdateMaterialRequest, UpdateWarehouseRequest, WarehouseInput, WarehouseResult
} from './types';

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} is required.`, { fieldErrors: [{ field, message: 'Required.' }] });
  return normalized;
}

function nonnegative(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError('VALIDATION_FAILED', `${field} must be a non-negative integer.`);
  return value;
}

function admin(context: InventoryContext): void {
  if (!context.identityHasRole(context.actor.username, 'inventory_admin', context.connection)) throw new AppError('PERMISSION_DENIED', 'Current identity is not an inventory administrator.');
}

function factor(context: InventoryContext): number {
  return 10 ** context.quantityScale;
}

function quantity(value: number, context: InventoryContext): number {
  const scaled = value * factor(context);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(Math.round(scaled)) || Math.abs(Math.round(scaled) - scaled) > 1e-8) {
    throw new AppError('VALIDATION_FAILED', 'Quantity must be positive, finite and within the configured scale.');
  }
  return Math.round(scaled) / factor(context);
}

function normalizedBalance(value: number, context: InventoryContext): number {
  const scaled = value * factor(context);
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.round(scaled))) throw new AppError('VALIDATION_FAILED', 'Inventory balance exceeds the supported range.');
  return Math.round(scaled) / factor(context);
}

function date(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('VALIDATION_FAILED', `${field} is invalid.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new AppError('VALIDATION_FAILED', `${field} is invalid.`);
  return value;
}

function active(context: InventoryContext, table: 'biz_material' | 'biz_warehouse', code: string): void {
  const row = context.connection.prepare(`SELECT active FROM ${table} WHERE code = ?`).get(code) as { active: number } | undefined;
  if (!row || row.active !== 1) throw new AppError('VALIDATION_FAILED', 'Referenced configuration is missing or inactive.');
}

function receipt(context: InventoryContext, batchCode: string, amount: number, reason: string): string {
  const now = context.now().toISOString();
  const code = context.transactionCode();
  context.connection.prepare("INSERT INTO biz_inventory_transaction (code,batch_code,transaction_type,quantity,source_transaction_code,operator_id,reason,occurred_at,version,created_at,updated_at) VALUES (?,?,'receipt',?,NULL,?,?,?,1,?,?)").run(code, batchCode, amount, context.actor.username, reason, now, now, now);
  return code;
}

type BatchRow = {
  id: number; code: string; material_code: string; warehouse_code: string;
  quantity: number; version: number; active: number; expires_at: string | null;
  material_active: number; warehouse_active: number;
};

function batch(id: number, context: InventoryContext): BatchRow {
  const row = context.connection.prepare(
    'SELECT b.id,b.code,b.material_code,b.warehouse_code,b.quantity,b.version,b.active,b.expires_at,m.active AS material_active,w.active AS warehouse_active FROM biz_inventory_batch b JOIN biz_material m ON m.code=b.material_code JOIN biz_warehouse w ON w.code=b.warehouse_code WHERE b.id=?'
  ).get(id) as BatchRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Batch not found.');
  if (row.active !== 1) throw new AppError('INVALID_TRANSITION', 'Batch is inactive.');
  if (row.material_active !== 1 || row.warehouse_active !== 1) throw new AppError('INVALID_TRANSITION', 'Batch material or warehouse is inactive.');
  return row;
}

function readOnlyConnection(context: InventoryContext) {
  const identifier = (value: string) => {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(value)) throw new AppError('VALIDATION_FAILED', 'Issue blocker query identifier is invalid.');
    return `"${value}"`;
  };
  return Object.freeze({
    find: (entityId: string, equalityFilters: Readonly<Record<string, string | number | null>>) => {
      const entries = Object.entries(equalityFilters);
      if (entries.length > 20) throw new AppError('VALIDATION_FAILED', 'Issue blocker query has too many filters.');
      const values: Array<string | number | null> = [];
      const clauses = entries.map(([field, value]) => { values.push(value); return `${identifier(field)} IS ?`; });
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = context.connection.prepare(`SELECT * FROM ${identifier(`biz_${entityId}`)}${where} ORDER BY "id"`).all(...values) as unknown as Array<Record<string, unknown>>;
      return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
    }
  });
}

function movement(context: InventoryContext, row: BatchRow, expected: number, nextValue: number, type: string, amount: number, reason: string, source: string | null, permission: string): InventoryMovementResult {
  const next = normalizedBalance(nextValue, context);
  const now = context.now().toISOString();
  const update = context.connection.prepare('UPDATE biz_inventory_batch SET quantity=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(next, now, row.id, expected);
  if (Number(update.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Batch version conflict.');
  const code = context.transactionCode();
  const inserted = context.connection.prepare('INSERT INTO biz_inventory_transaction (code,batch_code,transaction_type,quantity,source_transaction_code,operator_id,reason,occurred_at,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)').run(code, row.code, type, amount, source, context.actor.username, reason, now, now, now);
  const transactionId = Number(inserted.lastInsertRowid);
  context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission, entityId: 'inventory_batch', recordId: row.id, result: 'success', details: Object.freeze({ code, amount, type }) }));
  return Object.freeze({ batchId: row.id, batchCode: row.code, version: row.version + 1, quantity: next, transactionId, transactionCode: code });
}

export class InventoryService {
  createMaterial(request: MaterialInput, context: InventoryContext): MaterialResult {
    const permission = 'materials.create_material'; context.requirePermission(context.actor, permission); admin(context);
    const name = required(request.name, 'name'), unit = required(request.unit, 'unit'), days = nonnegative(request.expiryWarningDays, 'expiryWarningDays'), code = context.materialCode(), now = context.now().toISOString();
    let id: number;
    try { id = Number(context.connection.prepare('INSERT INTO biz_material (code,name,unit,expiry_warning_days,active,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)').run(code, name, unit, days, request.active ? 1 : 0, now, now).lastInsertRowid); }
    catch (error) { if (error instanceof Error && /UNIQUE/.test(error.message)) throw new AppError('UNIQUE_CONFLICT', 'Material code exists.'); throw error; }
    context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission, entityId: 'material', recordId: id, result: 'success', details: Object.freeze({ code }) }));
    return Object.freeze({ materialId: id, materialCode: code, version: 1, expiryWarningDays: days, active: request.active });
  }

  updateMaterial(request: UpdateMaterialRequest, context: InventoryContext): MaterialResult {
    const permission = 'materials.update_material'; context.requirePermission(context.actor, permission); admin(context);
    const row = context.connection.prepare('SELECT id,code,version FROM biz_material WHERE id=?').get(request.materialId) as { id: number; code: string; version: number } | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Material not found.');
    if (row.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', 'Material version conflict.');
    const name = required(request.name, 'name'), unit = required(request.unit, 'unit'), days = nonnegative(request.expiryWarningDays, 'expiryWarningDays'), now = context.now().toISOString();
    const update = context.connection.prepare('UPDATE biz_material SET name=?,unit=?,expiry_warning_days=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(name, unit, days, request.active ? 1 : 0, now, row.id, request.expectedVersion);
    if (Number(update.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Material version conflict.');
    context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission, entityId: 'material', recordId: row.id, result: 'success', details: Object.freeze({ code: row.code }) }));
    return Object.freeze({ materialId: row.id, materialCode: row.code, version: row.version + 1, expiryWarningDays: days, active: request.active });
  }

  createWarehouse(request: WarehouseInput, context: InventoryContext): WarehouseResult {
    const permission = 'warehouses.create_warehouse'; context.requirePermission(context.actor, permission); admin(context);
    const name = required(request.name, 'name'), code = context.warehouseCode(), now = context.now().toISOString();
    const id = Number(context.connection.prepare('INSERT INTO biz_warehouse (code,name,active,version,created_at,updated_at) VALUES (?,?,?,1,?,?)').run(code, name, request.active ? 1 : 0, now, now).lastInsertRowid);
    context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission, entityId: 'warehouse', recordId: id, result: 'success', details: Object.freeze({ code }) }));
    return Object.freeze({ warehouseId: id, warehouseCode: code, version: 1, active: request.active });
  }

  updateWarehouse(request: UpdateWarehouseRequest, context: InventoryContext): WarehouseResult {
    const permission = 'warehouses.update_warehouse'; context.requirePermission(context.actor, permission); admin(context);
    const row = context.connection.prepare('SELECT id,code,version FROM biz_warehouse WHERE id=?').get(request.warehouseId) as { id: number; code: string; version: number } | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Warehouse not found.');
    if (row.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', 'Warehouse version conflict.');
    const name = required(request.name, 'name'), now = context.now().toISOString();
    const update = context.connection.prepare('UPDATE biz_warehouse SET name=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(name, request.active ? 1 : 0, now, row.id, request.expectedVersion);
    if (Number(update.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Warehouse version conflict.');
    context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission, entityId: 'warehouse', recordId: row.id, result: 'success', details: Object.freeze({ code: row.code }) }));
    return Object.freeze({ warehouseId: row.id, warehouseCode: row.code, version: row.version + 1, active: request.active });
  }

  receiveNewBatch(request: ReceiveNewBatchRequest, context: InventoryContext): InventoryBatchResult {
    const permission = 'inventory_batches.receive_new'; context.requirePermission(context.actor, permission);
    const materialCode = required(request.materialCode, 'materialCode'), warehouseCode = required(request.warehouseCode, 'warehouseCode'), batchNo = required(request.batchNo, 'batchNo'), reason = required(request.reason, 'reason'), amount = quantity(request.quantity, context), produced = date(request.producedAt, 'producedAt'), received = date(request.receivedAt, 'receivedAt')!, expires = date(request.expiresAt, 'expiresAt');
    active(context, 'biz_material', materialCode); active(context, 'biz_warehouse', warehouseCode);
    if ((produced && produced > received) || (expires && received > expires)) throw new AppError('VALIDATION_FAILED', 'Batch dates are inconsistent.');
    if (context.connection.prepare('SELECT 1 FROM biz_inventory_batch WHERE material_code=? AND warehouse_code=? AND batch_no=?').get(materialCode, warehouseCode, batchNo)) throw new AppError('UNIQUE_CONFLICT', 'Batch already exists.');
    const code = context.batchCode(), now = context.now().toISOString();
    const id = Number(context.connection.prepare('INSERT INTO biz_inventory_batch (code,material_code,warehouse_code,batch_no,produced_at,received_at,expires_at,quantity,active,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,?,?)').run(code, materialCode, warehouseCode, batchNo, produced, received, expires, amount, now, now).lastInsertRowid);
    const transactionCode = receipt(context, code, amount, reason);
    context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission, entityId: 'inventory_batch', recordId: id, result: 'success', details: Object.freeze({ tx: transactionCode, amount }) }));
    return Object.freeze({ batchId: id, batchCode: code, version: 1, quantity: amount });
  }

  receiveExistingBatch(request: ReceiveExistingBatchRequest, context: InventoryContext): InventoryBatchResult {
    const permission = 'inventory_batches.receive_existing'; context.requirePermission(context.actor, permission);
    const reason = required(request.reason, 'reason'), amount = quantity(request.quantity, context), row = batch(request.batchId, context);
    if (row.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', 'Batch version conflict.');
    const now = context.now().toISOString(), next = normalizedBalance(Number(row.quantity) + amount, context);
    const update = context.connection.prepare('UPDATE biz_inventory_batch SET quantity=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(next, now, row.id, request.expectedVersion);
    if (Number(update.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Batch version conflict.');
    const transactionCode = receipt(context, row.code, amount, reason);
    context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission, entityId: 'inventory_batch', recordId: row.id, result: 'success', details: Object.freeze({ tx: transactionCode, amount }) }));
    return Object.freeze({ batchId: row.id, batchCode: row.code, version: row.version + 1, quantity: next });
  }

  issueStock(request: IssueStockRequest, context: InventoryContext): InventoryMovementResult {
    const permission = 'inventory_batches.issue'; context.requirePermission(context.actor, permission);
    const reason = required(request.reason, 'reason'), amount = quantity(request.quantity, context), row = batch(request.batchId, context);
    if (row.expires_at && row.expires_at <= context.now().toISOString().slice(0, 10)) throw new AppError('INVALID_TRANSITION', 'Expired batch cannot be issued.');
    const next = Number(row.quantity) - amount;
    if (next < 0) throw new AppError('VALIDATION_FAILED', 'Insufficient inventory.');
    const blockerRequest: InventoryIssueBlockerRequest = Object.freeze({ batchId: row.id, batchCode: row.code, materialCode: row.material_code, warehouseCode: row.warehouse_code, availableQuantity: row.quantity, requestedQuantity: amount, requesterId: context.actor.username });
    for (const blocker of context.issueBlockers) { const result = blocker(blockerRequest, readOnlyConnection(context)); if (result.blocked) throw new AppError('INVALID_TRANSITION', result.message, { details: { blockerCode: result.code } }); }
    if (row.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', 'Batch version conflict.');
    return movement(context, row, request.expectedVersion, next, 'issue', amount, reason, null, permission);
  }

  returnStock(request: ReturnStockRequest, context: InventoryContext): InventoryMovementResult {
    const permission = 'inventory_batches.return_stock'; context.requirePermission(context.actor, permission);
    const reason = required(request.reason, 'reason'), amount = quantity(request.quantity, context), row = batch(request.batchId, context);
    const issue = context.connection.prepare("SELECT id,code,batch_code,quantity,operator_id FROM biz_inventory_transaction WHERE id=? AND transaction_type='issue'").get(request.issueTransactionId) as { id: number; code: string; batch_code: string; quantity: number; operator_id: string } | undefined;
    if (!issue) throw new AppError('NOT_FOUND', 'Issue transaction not found.');
    if (issue.operator_id !== context.actor.username) throw new AppError('PERMISSION_DENIED', 'Only the original requester can return this issue.');
    if (issue.batch_code !== row.code) throw new AppError('VALIDATION_FAILED', 'Issue transaction belongs to another batch.');
    if (row.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', 'Batch version conflict.');
    const returned = context.connection.prepare("SELECT COALESCE(SUM(quantity),0) AS quantity FROM biz_inventory_transaction WHERE transaction_type='return' AND source_transaction_code=?").get(issue.code) as { quantity: number };
    if (Number(returned.quantity) + amount > Number(issue.quantity)) throw new AppError('VALIDATION_FAILED', 'Return exceeds outstanding issue quantity.');
    return movement(context, row, request.expectedVersion, Number(row.quantity) + amount, 'return', amount, reason, issue.code, permission);
  }

  adjustStock(request: AdjustStockRequest, context: InventoryContext): InventoryMovementResult {
    const permission = 'inventory_batches.adjust'; context.requirePermission(context.actor, permission);
    const reason = required(request.reason, 'reason'), amount = quantity(request.quantity, context);
    if (request.direction !== 'in' && request.direction !== 'out') throw new AppError('VALIDATION_FAILED', 'Adjustment direction is invalid.');
    const row = batch(request.batchId, context);
    if (row.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', 'Batch version conflict.');
    const next = Number(row.quantity) + (request.direction === 'in' ? amount : -amount);
    if (next < 0) throw new AppError('VALIDATION_FAILED', 'Adjustment would create negative inventory.');
    return movement(context, row, request.expectedVersion, next, request.direction === 'in' ? 'adjustment_in' : 'adjustment_out', amount, reason, null, permission);
  }

  assertCanDeleteBatch(batchId: number, context: InventoryContext): void {
    context.requirePermission(context.actor, 'inventory_batches.view');
    const row = context.connection.prepare('SELECT code FROM biz_inventory_batch WHERE id=?').get(batchId) as { code: string } | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Batch not found.');
    const history = context.connection.prepare('SELECT COUNT(*) AS count FROM biz_inventory_transaction WHERE batch_code=?').get(row.code) as { count: number };
    if (Number(history.count) > 0) throw new AppError('INVALID_TRANSITION', 'Batch with transaction history cannot be deleted.');
  }

  readExpiryWarnings(context: InventoryContext): readonly InventoryExpiryStatus[] {
    context.requirePermission(context.actor, 'inventory_batches.view');
    const rows = context.connection.prepare('SELECT b.id,b.code,b.expires_at,m.expiry_warning_days FROM biz_inventory_batch b JOIN biz_material m ON m.code=b.material_code ORDER BY b.id').all() as unknown as Array<{ id: number; code: string; expires_at: string | null; expiry_warning_days: number }>;
    const today = context.now().toISOString().slice(0, 10), todayMs = Date.parse(`${today}T00:00:00.000Z`);
    return Object.freeze(rows.map((row) => {
      let status: InventoryExpiryStatus['status'] = 'not_applicable';
      if (row.expires_at) { if (row.expires_at <= today) status = 'expired'; else { const days = (Date.parse(`${row.expires_at}T00:00:00.000Z`) - todayMs) / 86_400_000; status = days <= Number(row.expiry_warning_days) ? 'warning' : 'normal'; } }
      return Object.freeze({ batchId: row.id, batchCode: row.code, expiresAt: row.expires_at, status });
    }));
  }

  readInventorySummary(context: InventoryContext): InventorySummary {
    context.requirePermission(context.actor, 'inventory_batches.view');
    const today = context.now().toISOString().slice(0, 10);
    const row = context.connection.prepare("SELECT (SELECT COUNT(*) FROM biz_material) AS materials,(SELECT COUNT(*) FROM biz_warehouse) AS warehouses,(SELECT COUNT(*) FROM biz_inventory_batch) AS batches,(SELECT COALESCE(SUM(quantity),0) FROM biz_inventory_batch) AS total_quantity,(SELECT COUNT(*) FROM biz_inventory_transaction) AS transactions,(SELECT COUNT(*) FROM biz_inventory_batch b JOIN biz_material m ON m.code=b.material_code WHERE b.expires_at>? AND julianday(b.expires_at)-julianday(?)<=m.expiry_warning_days) AS warning_batches,(SELECT COUNT(*) FROM biz_inventory_batch WHERE expires_at IS NOT NULL AND expires_at<=?) AS expired_batches").get(today, today, today) as Record<string, number>;
    const recentRows = context.connection.prepare('SELECT code,batch_code,transaction_type,quantity,operator_id,occurred_at FROM biz_inventory_transaction ORDER BY occurred_at DESC,id DESC LIMIT 10').all() as unknown as Array<{ code: string; batch_code: string; transaction_type: string; quantity: number; operator_id: string; occurred_at: string }>;
    const recentTransactions: readonly InventoryRecentTransaction[] = Object.freeze(recentRows.map((item) => Object.freeze({ transactionCode: item.code, batchCode: item.batch_code, transactionType: item.transaction_type, quantity: Number(item.quantity), operatorId: item.operator_id, occurredAt: item.occurred_at })));
    return Object.freeze({ materials: Number(row.materials), warehouses: Number(row.warehouses), batches: Number(row.batches), totalQuantity: Number(row.total_quantity), transactions: Number(row.transactions), warningBatches: Number(row.warning_batches), expiredBatches: Number(row.expired_batches), recentTransactions });
  }
}
