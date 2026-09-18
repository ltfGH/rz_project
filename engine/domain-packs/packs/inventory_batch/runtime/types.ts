import type { DatabaseSync } from 'node:sqlite';
export interface InventoryActor{readonly userId:number;readonly username:string;readonly displayName:string;readonly roleId:string}
export interface InventoryAuditEntry{readonly actor:InventoryActor;readonly permission:string;readonly entityId:'material'|'warehouse'|'inventory_batch';readonly recordId:number;readonly result:'success';readonly details:Readonly<Record<string,unknown>>}
export interface InventoryContext{readonly connection:DatabaseSync;readonly actor:InventoryActor;readonly quantityScale:number;readonly requirePermission:(actor:InventoryActor,permission:string)=>void;readonly appendAudit:(connection:DatabaseSync,event:InventoryAuditEntry)=>void;readonly identityHasRole:(identityId:string,roleId:string,connection:DatabaseSync)=>boolean;readonly now:()=>Date;readonly materialCode:()=>string;readonly warehouseCode:()=>string;readonly batchCode:()=>string;readonly transactionCode:()=>string}
export interface MaterialInput{readonly name:string;readonly unit:string;readonly expiryWarningDays:number;readonly active:boolean}
export interface UpdateMaterialRequest extends MaterialInput{readonly materialId:number;readonly expectedVersion:number}
export interface MaterialResult{readonly materialId:number;readonly materialCode:string;readonly version:number;readonly expiryWarningDays:number;readonly active:boolean}
export interface WarehouseInput{readonly name:string;readonly active:boolean}
export interface UpdateWarehouseRequest extends WarehouseInput{readonly warehouseId:number;readonly expectedVersion:number}
export interface WarehouseResult{readonly warehouseId:number;readonly warehouseCode:string;readonly version:number;readonly active:boolean}
export interface ReceiveNewBatchRequest{readonly materialCode:string;readonly warehouseCode:string;readonly batchNo:string;readonly quantity:number;readonly producedAt:string|null;readonly receivedAt:string;readonly expiresAt:string|null;readonly reason:string}
export interface ReceiveExistingBatchRequest{readonly batchId:number;readonly expectedVersion:number;readonly quantity:number;readonly reason:string}
export interface InventoryBatchResult{readonly batchId:number;readonly batchCode:string;readonly version:number;readonly quantity:number}
export interface IssueStockRequest{readonly batchId:number;readonly expectedVersion:number;readonly quantity:number;readonly reason:string}
export interface ReturnStockRequest extends IssueStockRequest{readonly issueTransactionId:number}
export interface AdjustStockRequest extends IssueStockRequest{readonly direction:'in'|'out'}
export interface InventoryMovementResult extends InventoryBatchResult{readonly transactionId:number;readonly transactionCode:string}
export interface InventoryExpiryStatus{readonly batchId:number;readonly batchCode:string;readonly expiresAt:string|null;readonly status:'not_applicable'|'normal'|'warning'|'expired'}
export interface InventorySummary{readonly materials:number;readonly warehouses:number;readonly batches:number;readonly totalQuantity:number;readonly transactions:number}
