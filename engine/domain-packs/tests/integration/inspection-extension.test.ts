import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import type { LoadedPack } from '../../src/shared/types';

test('allows a registered dependent pack to extend inspection containers', () => {
  const base = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'inspection_rectification'));
  const bridge: LoadedPack = {
    root: 'C:\\packs\\asset_registry', digest: 'a'.repeat(64), fragmentDigest: 'b'.repeat(64),
    entrypointDigests: { fragment:'1'.repeat(64),runtime:'2'.repeat(64),ui:'3'.repeat(64),seed:'4'.repeat(64),tests:'5'.repeat(64) },
    catalog: { catalogVersion:'1.0',id:'asset_registry',version:'1.0.0',name:'资产巡检桥接',description:'追加资产巡检关系',blueprintSchemaVersions:['1.0'],runtimeVersions:['1.0.0'],provides:['asset.bridge'],requires:['inspection.core'],allowedDependencies:['inspection_rectification'],migrationsVersion:1,entrypoints:{fragment:'blueprint.json',runtime:'runtime/index.ts',ui:'ui/index.ts',seed:'seed/index.ts',tests:'tests/index.ts'},uiSlots:['entity.detail.tabs'] },
    fragment: { fragmentVersion:'1.0',pack:{id:'asset_registry',version:'1.0.0'},owns:{entities:[],modules:[],workflows:[],roles:[]},publicExtensionPoints:[],extensions:[
      {point:'inspection_task.detail.tabs',operation:'append',path:'/detailTabs',value:{id:'asset_context',name:'关联资产',viewId:'asset_context'}},
      {point:'inspection_task.create.sources',operation:'append',path:'/createSources',value:{id:'asset_source',name:'资产发起巡检'}},
      {point:'inspection_item.fields',operation:'append',path:'/fields',value:{id:'asset_note',name:'资产补充说明',type:'text',required:false,unique:false}}
    ],blueprint:{entities:[],modules:[],workflows:[],roles:[],dashboards:[]},seed:{records:{}} }
  };
  const registry=new PackRegistry(); registry.register(base); registry.register(bridge);
  const result=composeDomainPacks({blueprintSchemaVersion:'1.0',runtimeVersion:'1.0.0',software:{id:'inspection_extended',name:'资产巡检软件',version:'1.0.0',purpose:'验证扩展',targetUsers:['巡检岗位'],boundaries:['离线'],loginMode:'required'},selections:[{id:'inspection_rectification',version:'1.0.0',config:{}},{id:'asset_registry',version:'1.0.0',config:{}}],coverage:{supported:['巡检扩展'],unsupported:[]},materials:{developmentPurpose:'验证扩展',industry:'运维',technicalFeatures:['离线']}},registry);
  assert.equal(result.canGenerate,true,result.summary);
  const entities=(result.blueprint as any).entities; const task=entities.find((x:any)=>x.id==='inspection_task'); const item=entities.find((x:any)=>x.id==='inspection_item');
  assert.deepEqual(task.detailTabs,[{id:'asset_context',name:'关联资产',viewId:'asset_context'}]);
  assert.deepEqual(task.createSources,[{id:'asset_source',name:'资产发起巡检'}]);
  assert.ok(item.fields.some((field:any)=>field.id==='asset_note'));
});
