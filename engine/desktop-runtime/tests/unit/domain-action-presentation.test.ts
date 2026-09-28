import test from 'node:test';
import assert from 'node:assert/strict';

import { selectPresentableActions } from '../../src/renderer/domain/action-presentation';

const action = (id:string,entityId:string,scope:'module'|'record') => ({id,entityId,scope,label:id,order:10});
const record = {id:1,version:1,values:{}} as any;

test('separates module and record project actions', () => {
  const actions = [
    action('project.create','project','module'),
    action('project.update','project','record'),
    action('project.activate','project','record'),
    action('project.request_close','project','record'),
    action('project.task.start','project_task','record')
  ];
  assert.deepEqual(selectPresentableActions(actions,'project','module',undefined).map((item)=>item.id),['project.create']);
  assert.deepEqual(selectPresentableActions(actions,'project','record',record).map((item)=>item.id),[
    'project.update','project.activate','project.request_close'
  ]);
  assert.deepEqual(selectPresentableActions(actions,'project','record',undefined),[]);
});

test('preserves supported legacy record actions and rejects unknown actions', () => {
  const actions = [
    action('asset.change_status','asset','record'),
    action('inspection.start','inspection_task','record'),
    action('work_order.accept','work_order','record'),
    action('asset.unknown','asset','record'),
    action('asset.change_status','asset','module')
  ];
  assert.deepEqual(selectPresentableActions(actions,'asset','record',record).map((item)=>item.id),['asset.change_status']);
  assert.deepEqual(selectPresentableActions(actions,'inspection_task','record',record).map((item)=>item.id),['inspection.start']);
  assert.deepEqual(selectPresentableActions(actions,'work_order','record',record).map((item)=>item.id),['work_order.accept']);
  assert.deepEqual(selectPresentableActions(actions,'asset','module',undefined),[]);
});
