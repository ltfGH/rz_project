import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

test('allows a registered dependent pack to extend inspection containers', () => {
  const base = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'inspection_rectification'));
  const bridge = loadPack(path.resolve(__dirname, '..', 'fixtures', 'packs', 'inspection-asset-bridge'));
  const registry=new PackRegistry(); registry.register(base); registry.register(bridge);
  const result=composeDomainPacks({blueprintSchemaVersion:'1.0',runtimeVersion:'1.0.0',software:{id:'inspection_extended',name:'资产巡检软件',version:'1.0.0',purpose:'验证扩展',targetUsers:['巡检岗位'],boundaries:['离线'],loginMode:'required'},selections:[{id:'inspection_rectification',version:'1.0.0',config:{}},{id:'asset_registry',version:'1.0.0',config:{}}],coverage:{supported:['巡检扩展'],unsupported:[]},materials:{developmentPurpose:'验证扩展',industry:'运维',technicalFeatures:['离线']}},registry);
  assert.equal(result.canGenerate,true,result.summary);
  const entities=(result.blueprint as any).entities; const task=entities.find((x:any)=>x.id==='inspection_task'); const item=entities.find((x:any)=>x.id==='inspection_item');
  assert.deepEqual(task.detailTabs,[{id:'asset_context',name:'关联资产',viewId:'asset_context'}]);
  assert.deepEqual(task.createSources,[{id:'asset_source',name:'资产发起巡检'}]);
  assert.ok(item.fields.some((field:any)=>field.id==='asset_note'));
  assert.ok(task.fields.some((field:any)=>field.id==='asset_code'));
  assert.ok(task.relations.some((relation:any)=>relation.id==='task_asset'));
  assert.ok(item.relations.some((relation:any)=>relation.id==='item_asset'));
  assert.ok((result.blueprint as any).workflows[0].transitions.some((x:any)=>x.id==='bridge_reopen'));
});
