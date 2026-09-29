import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { productionPluginDescriptors } from '../../../domain-packs/src/runtime/production-catalog';
import { PluginHost } from '../../src/core/plugin-host';
import { PluginRegistry } from '../../src/core/plugin-registry';
import {
  getMaterialDescriptor,
  loadMaterialDescriptorCatalog
} from '../../src/generator/material-descriptors';
import { loadStandardTemplateCatalog } from '../../src/generator/standard-project';
import { builtTemplate } from '../helpers/standard-generation';

const expectedIds = [
  'application_approval_archive','asset_inspection_management','asset_inspection_rectification',
  'asset_work_order_operations','inspection_rectification_orders','inventory_application_approval',
  'project_delivery_archive','project_task_management'
];
const expectedStepIds: Readonly<Record<string, readonly string[]>> = Object.freeze({
  application_approval_archive:['create','submit','decide','revise','approve','archive'],
  asset_inspection_management:['asset','plan','task','execute','submit','archive'],
  asset_inspection_rectification:['asset','inspection','abnormal','work_order','close','archive'],
  asset_work_order_operations:['asset','create_order','dispatch','accept','process','resolve','close'],
  inspection_rectification_orders:['inspection','abnormal','work_order','close','archive'],
  inventory_application_approval:['material_batch','application','submit','approve','deduct','ledger'],
  project_delivery_archive:['project_task','deliverable','accept','file_archive','close'],
  project_task_management:['project','activate','milestone_task','risk','deliverable','close']
});

function activatedActionIds(templateId:string):Set<string>{
  const descriptor=loadStandardTemplateCatalog().templates.find((entry)=>entry.id===templateId)!;
  const built=builtTemplate(descriptor);
  const registry=new PluginRegistry();for(const plugin of productionPluginDescriptors)registry.register(plugin);
  const host=new PluginHost();registry.activate(built.blueprint.plugins,host);return new Set(Object.keys(host.freeze().domainActions));
}

test('loads eight sorted deeply frozen material descriptors',()=>{
  const catalog=loadMaterialDescriptorCatalog();
  assert.equal(catalog.catalogVersion,'1.0');
  assert.deepEqual(catalog.templates.map((entry)=>entry.id),expectedIds);
  assert.equal(Object.isFrozen(catalog),true);
  assert.equal(Object.isFrozen(catalog.templates[0]?.workflowSteps),true);
  for(const id of expectedIds){const descriptor=getMaterialDescriptor(id);assert.deepEqual(descriptor,catalog.templates.find((entry)=>entry.id===id));assert.equal(Object.isFrozen(descriptor),true);}
  assert.throws(()=>getMaterialDescriptor('unknown_template'),/template/i);
});

test('references only entities modules roles and actions present in each real template',()=>{
  const standard=loadStandardTemplateCatalog();
  for(const material of loadMaterialDescriptorCatalog().templates){
    const template=standard.templates.find((entry)=>entry.id===material.id)!;
    const built=builtTemplate(template),entities=new Set(built.blueprint.entities?.map((entry)=>entry.id));
    const modules=new Set(built.blueprint.modules?.map((entry)=>entry.id)),roles=new Set(built.blueprint.roles?.map((entry)=>entry.id));
    const actions=activatedActionIds(material.id);
    assert.ok(material.coreEntityIds.length>=2&&material.coreEntityIds.length<=4,material.id);
    for(const id of material.coreEntityIds)assert.equal(entities.has(id),true,`${material.id}:${id}`);
    for(const id of Object.keys(material.modulePurposes))assert.equal(modules.has(id),true,`${material.id}:${id}`);
    for(const id of material.roleProfileIds)assert.equal(roles.has(id),true,`${material.id}:${id}`);
    for(const [id,label] of Object.entries(material.operationLabels)){
      assert.equal(actions.has(id),true,`${material.id}:${id}`);
      assert.notEqual(label,id);
      assert.doesNotMatch(label,/^[a-z][a-z0-9_.]+$/);
    }
    for(const step of material.workflowSteps){
      assert.equal(modules.has(step.moduleId),true,`${material.id}:${step.id}:${step.moduleId}`);
      assert.equal(entities.has(step.entityId),true,`${material.id}:${step.id}:${step.entityId}`);
      if(step.actionId){assert.equal(actions.has(step.actionId),true,`${material.id}:${step.id}:${step.actionId}`);assert.ok(material.operationLabels[step.actionId]);}
    }
  }
});

test('defines the approved workflow order and bounded screenshot plan for every template',()=>{
  for(const descriptor of loadMaterialDescriptorCatalog().templates){
    assert.deepEqual(descriptor.workflowSteps.map((step)=>step.id),expectedStepIds[descriptor.id]);
    assert.ok(descriptor.workflowSteps.length>=4);
    assert.equal(new Set(descriptor.workflowSteps.map((step)=>step.id)).size,descriptor.workflowSteps.length);
    assert.ok(descriptor.screenshotScenarioIds.length>=12&&descriptor.screenshotScenarioIds.length<=18,descriptor.id);
    assert.equal(new Set(descriptor.screenshotScenarioIds).size,descriptor.screenshotScenarioIds.length);
    assert.ok(descriptor.validationNotes.length>=2);
    assert.ok(descriptor.unsupportedClaims.length>=2);
  }
});

test('rejects unknown properties unsafe content bad references and incomplete flows',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'material-descriptors-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const base=structuredClone(loadMaterialDescriptorCatalog()) as any;
  const cases:[string,(value:any)=>void][]=[
    ['unknown property',(value)=>{value.templates[0].execute='now';}],
    ['executable key',(value)=>{value.templates[0].modulePurposes.onClick='bad';}],
    ['raw action label',(value)=>{const key=Object.keys(value.templates[0].operationLabels)[0];value.templates[0].operationLabels[key]=key;}],
    ['unknown role',(value)=>{value.templates[0].roleProfileIds[0]='root';}],
    ['unknown module',(value)=>{value.templates[0].workflowSteps[0].moduleId='unknown_module';}],
    ['short flow',(value)=>{value.templates[0].workflowSteps=value.templates[0].workflowSteps.slice(0,3);}],
    ['duplicate step',(value)=>{value.templates[0].workflowSteps[1].id=value.templates[0].workflowSteps[0].id;}]
  ];
  for(const [name,mutate] of cases){const value=structuredClone(base);mutate(value);const filename=path.join(root,`${name}.json`);fs.writeFileSync(filename,JSON.stringify(value),'utf8');assert.throws(()=>loadMaterialDescriptorCatalog(filename),undefined,name);}
});
