import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInventoryActionInput,
  getInventoryActionForm,
  getInventoryActionInitialValues,
  inventoryActionFormIds
} from '../../src/renderer/domain/inventory-action-forms';

const record = (id = 17, version = 4, values: Record<string, unknown> = {}) => ({ id, version, values } as any);

test('declares exact inventory mutations and excludes query and guard actions', () => {
  assert.deepEqual(inventoryActionFormIds, [
    'inventory.material.create','inventory.warehouse.create','inventory.batch.receive_new',
    'inventory.material.update','inventory.warehouse.update','inventory.batch.receive_existing',
    'inventory.batch.issue','inventory.batch.return','inventory.batch.adjust','inventory.application.create'
  ]);
  assert.equal(getInventoryActionForm('inventory.material.create')?.scope,'module');
  assert.equal(getInventoryActionForm('inventory.warehouse.create')?.entityId,'warehouse');
  assert.equal(getInventoryActionForm('inventory.batch.receive_new')?.scope,'module');
  assert.equal(getInventoryActionForm('inventory.batch.delete_guard'),undefined);
  assert.equal(getInventoryActionForm('inventory.dashboard_summary'),undefined);
});

test('builds typed material, batch movement, and selected-batch application requests', () => {
  assert.deepEqual(buildInventoryActionInput(getInventoryActionForm('inventory.material.create')!, {
    name:'Filter',unit:'piece',expiryWarningDays:'30',active:true
  }), {name:'Filter',unit:'piece',expiryWarningDays:30,active:true});
  assert.deepEqual(buildInventoryActionInput(getInventoryActionForm('inventory.batch.issue')!, {
    quantity:'3',reason:'Approved use'
  },record()), {batchId:17,expectedVersion:4,quantity:3,reason:'Approved use'});
  assert.deepEqual(buildInventoryActionInput(getInventoryActionForm('inventory.batch.return')!, {
    quantity:'2',reason:'Unused',issueTransactionId:'81'
  },record()), {batchId:17,expectedVersion:4,quantity:2,reason:'Unused',issueTransactionId:81});
  assert.deepEqual(buildInventoryActionInput(getInventoryActionForm('inventory.application.create')!, {
    quantity:'5',purpose:'Maintenance',title:'Filter request',content:'Quarterly maintenance'
  },record(17,4,{code:'BATCH-001'})), {
    batchCode:'BATCH-001',quantity:5,purpose:'Maintenance',title:'Filter request',content:'Quarterly maintenance'
  });
});

test('prefills editable inventory records and normalizes optional dates', () => {
  assert.deepEqual(getInventoryActionInitialValues(getInventoryActionForm('inventory.material.update')!, record(2,3,{
    name:'Filter',unit:'piece',expiry_warning_days:30,active:true
  })), {name:'Filter',unit:'piece',expiryWarningDays:'30',active:true});
  assert.deepEqual(buildInventoryActionInput(getInventoryActionForm('inventory.batch.receive_new')!, {
    materialCode:'MAT-1',warehouseCode:'WH-1',batchNo:'LOT-1',quantity:'10',producedAt:'',
    receivedAt:'2026-09-29',expiresAt:'',reason:'Initial receipt'
  }), {
    materialCode:'MAT-1',warehouseCode:'WH-1',batchNo:'LOT-1',quantity:10,producedAt:null,
    receivedAt:'2026-09-29',expiresAt:null,reason:'Initial receipt'
  });
});

test('rejects invalid inventory values, unknown keys, and records without batch code', () => {
  assert.throws(() => buildInventoryActionInput(getInventoryActionForm('inventory.batch.issue')!, {
    quantity:'0',reason:'No quantity'
  },record()), /form input/i);
  assert.throws(() => buildInventoryActionInput(getInventoryActionForm('inventory.batch.adjust')!, {
    quantity:'1',reason:'Count',direction:'sideways'
  },record()), /form input/i);
  assert.throws(() => buildInventoryActionInput(getInventoryActionForm('inventory.material.create')!, {
    name:'Filter',unit:'piece',expiryWarningDays:'30',active:true,secret:'do-not-echo'
  } as any), (error:Error) => !error.message.includes('do-not-echo'));
  assert.throws(() => buildInventoryActionInput(getInventoryActionForm('inventory.application.create')!, {
    quantity:'1',purpose:'Use',title:'Request',content:'Body'
  },record()), /record/i);
});
