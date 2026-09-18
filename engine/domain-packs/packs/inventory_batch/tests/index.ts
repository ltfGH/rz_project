import type { DatabaseSync } from 'node:sqlite';
import type { RuntimeDatabase } from '../../../../desktop-runtime/src/core/database';
import type { EntityRepository } from '../../../../desktop-runtime/src/core/entity-repository';
import type { ActorDto } from '../../../../desktop-runtime/src/shared/dto';
import type { InventoryContext } from '../runtime/types';
import type { InventoryService } from '../runtime/inventory-service';

export interface InventoryAcceptanceDependencies {
  readonly database: RuntimeDatabase;
  readonly repository: EntityRepository;
  readonly service: InventoryService;
  readonly actors: Record<string, ActorDto>;
  readonly context: (connection: DatabaseSync, actor: ActorDto) => InventoryContext;
}

export function runInventoryAcceptanceScenario(dependencies: InventoryAcceptanceDependencies) {
  const { database, service, actors } = dependencies;
  const admin = actors.admin!;
  const keeper = actors.keeper!;
  const requester = actors.requester!;
  const material = database.transaction((connection) => service.createMaterial({ name: '验收耗材', unit: '件', expiryWarningDays: 30, active: true }, dependencies.context(connection, admin)));
  const warehouse = database.transaction((connection) => service.createWarehouse({ name: '验收仓库', active: true }, dependencies.context(connection, admin)));
  let current = database.transaction((connection) => service.receiveNewBatch({ materialCode: material.materialCode, warehouseCode: warehouse.warehouseCode, batchNo: 'LOT-ACCEPT-001', quantity: 10, producedAt: '2026-09-01', receivedAt: '2026-09-18', expiresAt: '2027-09-18', reason: '验收入库' }, dependencies.context(connection, keeper)));
  const issue = database.transaction((connection) => service.issueStock({ batchId: current.batchId, expectedVersion: current.version, quantity: 4, reason: '验收领用' }, dependencies.context(connection, requester)));
  current = database.transaction((connection) => service.returnStock({ batchId: issue.batchId, expectedVersion: issue.version, issueTransactionId: issue.transactionId, quantity: 1, reason: '验收退库' }, dependencies.context(connection, requester)));
  current = database.transaction((connection) => service.adjustStock({ batchId: current.batchId, expectedVersion: current.version, direction: 'in', quantity: 2, reason: '验收盘盈' }, dependencies.context(connection, keeper)));
  const transactions = database.prepare('SELECT COUNT(*) AS count FROM biz_inventory_transaction').get() as { count: number };
  const audits = database.prepare('SELECT COUNT(*) AS count FROM sys_audit_event').get() as { count: number };
  return Object.freeze({ quantity: current.quantity, version: current.version, transactions: Number(transactions.count), audits: Number(audits.count) });
}

export const inventoryAcceptanceDescriptor = Object.freeze({ id: 'inventory_batch', version: '1.0.0', scenarios: Object.freeze(['inventory.lifecycle.acceptance']) });
