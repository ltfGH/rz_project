import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { assertScreenshotEvidence, assertWorkflowCaptureBinding, assertWorkflowCaptureMetadata, buildStandardScreenshotPlan, inspectPng } from '../../src/generator/screenshot-evidence';
import { getMaterialDescriptor } from '../../src/generator/material-descriptors';
import { loadStandardTemplateCatalog } from '../../src/generator/standard-project';
import { builtTemplate } from '../helpers/standard-generation';

const CRC_TABLE=Array.from({length:256},(_,entry)=>{let value=entry;for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes:Buffer){let value=0xffffffff;for(const byte of bytes)value=CRC_TABLE[(value^byte)&0xff]!^(value>>>8);return(value^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const name=Buffer.from(type,'ascii'),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
function png(width:number,height:number,pixel:(x:number,y:number)=>readonly[number,number,number,number]){
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc(height*(1+width*4));for(let y=0;y<height;y++){const row=y*(1+width*4);raw[row]=0;for(let x=0;x<width;x++){const value=pixel(x,y),offset=row+1+x*4;raw[offset]=value[0];raw[offset+1]=value[1];raw[offset+2]=value[2];raw[offset+3]=value[3];}}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const hash=(filename:string)=>crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');

function fixture(t:test.TestContext){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'screenshot-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const executableSha256='e'.repeat(64),blueprintSha256='b'.repeat(64),captures=[];
  for(let index=0;index<12;index++){
    const fileName=`scene-${index}.png`,filename=path.join(root,fileName);
    fs.writeFileSync(filename,png(320,240,(x,y)=>[(x*(index+3)+y*7)%256,(y*(index+5)+x*11)%256,((x^y)*(index+9))%256,255]));
    const inspected=inspectPng(filename);captures.push({
      scenarioId:`scene_${index}`,stepId:`step_${index}`,workflowStepId:index<3?'project':null,roleId:'operations_admin',moduleId:'projects',actionId:index===3?'project.create':null,
      stateBefore:`before-${index}`,stateAfter:`after-${index}`,executableSha256,blueprintSha256,imageSha256:hash(filename),
      fileName,width:320,height:240,perceptualDigest:inspected.perceptualDigest,controlVerified:index===3
    });
  }
  const manifest={manifestVersion:'2.0',templateId:'project_task_management',executableSha256,blueprintSha256,captures};
  manifest.captures[0]!.moduleId=null as any;
  const facts={templateId:manifest.templateId,executableSha256,blueprintSha256,screenshotScenarioIds:captures.map((capture)=>capture.scenarioId)};
  assert.ok(captures.every((capture)=>capture.perceptualDigest.length===64));return{root,manifest,facts};
}

test('accepts twelve distinct nonblank hash-bound screenshots',t=>{const value=fixture(t);assert.doesNotThrow(()=>assertScreenshotEvidence(value.manifest,value.facts,value.root));});

test('accepts a meaningful localized state change even when the coarse digest is unchanged',t=>{
  const value=fixture(t),capture=value.manifest.captures[1]!,filename=path.join(value.root,capture.fileName);
  fs.writeFileSync(filename,png(320,240,(x,y)=>x>=1&&x<41&&y>=1&&y<7?[12,110,92,255]:[(x*3+y*7)%256,(y*5+x*11)%256,((x^y)*9)%256,255]));
  capture.imageSha256=hash(filename);capture.perceptualDigest=inspectPng(filename).perceptualDigest;
  assert.doesNotThrow(()=>assertScreenshotEvidence(value.manifest,value.facts,value.root));
});

test('rejects count identity hash dimension control blank and duplicate failures',t=>{
  const base=fixture(t),cases:[string,(manifest:any,root:string)=>void][]=[
    ['too few',(manifest)=>{manifest.captures.pop();}],
    ['duplicate scenario',(manifest)=>{manifest.captures[1].scenarioId=manifest.captures[0].scenarioId;}],
    ['duplicate step',(manifest)=>{manifest.captures[1].stepId=manifest.captures[0].stepId;}],
    ['wrong executable',(manifest)=>{manifest.captures[0].executableSha256='9'.repeat(64);}],
    ['wrong blueprint',(manifest)=>{manifest.blueprintSha256='9'.repeat(64);}],
    ['wrong image hash',(manifest)=>{manifest.captures[0].imageSha256='9'.repeat(64);}],
    ['wrong dimensions',(manifest)=>{manifest.captures[0].width=321;}],
    ['missing control',(manifest)=>{manifest.captures[3].controlVerified=false;}],
    ['blank image',(manifest,root)=>{const filename=path.join(root,manifest.captures[0].fileName);fs.writeFileSync(filename,png(320,240,()=>[240,240,240,255]));manifest.captures[0].imageSha256=hash(filename);manifest.captures[0].perceptualDigest=inspectPng(filename).perceptualDigest;}],
    ['transparent image',(manifest,root)=>{const filename=path.join(root,manifest.captures[0].fileName);fs.writeFileSync(filename,png(320,240,(x,y)=>[(x*17)%256,(y*19)%256,((x+y)*23)%256,0]));manifest.captures[0].imageSha256=hash(filename);manifest.captures[0].perceptualDigest=inspectPng(filename).perceptualDigest;}],
    ['resized duplicate',(manifest,root)=>{const filename=path.join(root,manifest.captures[1].fileName);fs.writeFileSync(filename,png(640,480,(x,y)=>{const sx=Math.floor(x/2),sy=Math.floor(y/2);return[(sx*3+sy*7)%256,(sy*5+sx*11)%256,((sx^sy)*9)%256,255];}));manifest.captures[1].imageSha256=hash(filename);manifest.captures[1].width=640;manifest.captures[1].height=480;manifest.captures[1].perceptualDigest=inspectPng(filename).perceptualDigest;}],
    ['duplicate image',(manifest,root)=>{const source=path.join(root,manifest.captures[0].fileName),target=path.join(root,manifest.captures[1].fileName);fs.copyFileSync(source,target);manifest.captures[1].imageSha256=hash(target);manifest.captures[1].perceptualDigest=inspectPng(target).perceptualDigest;}]
  ];
  for(const[name,mutate]of cases){const manifest=structuredClone(base.manifest);mutate(manifest,base.root);assert.throws(()=>assertScreenshotEvidence(manifest,base.facts,base.root),undefined,name);}
});

test('rejects a scenario plan or image path that is not bound to the facts',t=>{
  const value=fixture(t),missing={...value.facts,screenshotScenarioIds:value.facts.screenshotScenarioIds.slice(1)};
  assert.throws(()=>assertScreenshotEvidence(value.manifest,missing,value.root));
  const escaped=structuredClone(value.manifest);escaped.captures[0].fileName='../outside.png';assert.throws(()=>assertScreenshotEvidence(escaped,value.facts,value.root));
});

test('maps the catalog scenarios to a truthful executable capture plan',()=>{
  const template=loadStandardTemplateCatalog().templates.find((entry)=>entry.id==='project_task_management')!;
  const blueprint=builtTemplate(template).blueprint,descriptor=getMaterialDescriptor(template.id),plan=buildStandardScreenshotPlan(descriptor,blueprint);
  assert.deepEqual(plan.map((item)=>item.scenarioId),descriptor.screenshotScenarioIds);
  assert.equal(new Set(plan.map((item)=>item.stepId)).size,plan.length);
  assert.equal(plan[0]?.kind,'login');assert.equal(plan[0]?.moduleId,null);
  assert.equal(plan[1]?.kind,'dashboard');assert.equal(plan[1]?.moduleId,null);
  const modules=new Set(blueprint.modules?.map((module)=>module.id));
  for(const item of plan)if(item.moduleId!==null)assert.equal(modules.has(item.moduleId),true,item.scenarioId);
  for(const item of plan)if(item.actionId!==null){assert.ok(item.actionLabel);assert.notEqual(item.actionLabel,item.actionId);}
  const minimum=plan.find((item)=>item.scenarioId==='minimum_width');assert.equal(minimum?.viewport,'minimum');
});

test('maps distinct inventory form scenarios to distinct real commands',()=>{
  const template=loadStandardTemplateCatalog().templates.find((entry)=>entry.id==='inventory_application_approval')!,plan=buildStandardScreenshotPlan(getMaterialDescriptor(template.id),builtTemplate(template).blueprint);
  assert.equal(plan.find((item)=>item.scenarioId==='material_create_form')?.actionId,'inventory.material.create');
  assert.equal(plan.find((item)=>item.scenarioId==='batch_receive_form')?.actionId,'inventory.batch.receive_new');
});

test('rejects workflow captures produced by another executable or blueprint',()=>{
  const executableSha256='e'.repeat(64),blueprintSha256='b'.repeat(64),entry={executableSha256,blueprintSha256};
  assert.doesNotThrow(()=>assertWorkflowCaptureBinding(entry,executableSha256,blueprintSha256));
  assert.throws(()=>assertWorkflowCaptureBinding({...entry,executableSha256:'9'.repeat(64)},executableSha256,blueprintSha256));
  assert.throws(()=>assertWorkflowCaptureBinding({...entry,blueprintSha256:'8'.repeat(64)},executableSha256,blueprintSha256));
});

test('keeps all eight plans executable and reserves state scenes for representative workflow capture',()=>{
  const workflowScenes:Readonly<Record<string,readonly string[]>>={
    asset_inspection_rectification:['work_order_close','inspection_archive'],
    inventory_application_approval:['application_draft','application_review','batch_deducted'],
    project_delivery_archive:['project_activate'],
    project_task_management:['project_activate','task_start','task_progress','task_submit','task_review','risk_process','deliverable_submit','deliverable_review','project_close_request','project_close_review']
  };
  for(const template of loadStandardTemplateCatalog().templates){const blueprint=builtTemplate(template).blueprint,plan=buildStandardScreenshotPlan(getMaterialDescriptor(template.id),blueprint),modules=new Set(blueprint.modules?.map((module)=>module.id));assert.ok(plan.length>=12&&plan.length<=18,template.id);for(const item of plan){if(item.moduleId!==null)assert.equal(modules.has(item.moduleId),true,`${template.id}:${item.scenarioId}`);if(item.kind==='state')assert.equal(workflowScenes[template.id]?.includes(item.scenarioId)??false,true,`${template.id}:${item.scenarioId}`);}}
});

test('cross-checks supplied workflow metadata against plan steps modules actions and role permissions',()=>{
  const template=loadStandardTemplateCatalog().templates.find((entry)=>entry.id==='project_task_management')!,blueprint=builtTemplate(template).blueprint,descriptor=getMaterialDescriptor(template.id),plan=buildStandardScreenshotPlan(descriptor,blueprint),item=plan.find((entry)=>entry.scenarioId==='project_create_form')!;
  const entry={scenarioId:item.scenarioId,stepId:item.stepId,workflowStepId:item.workflowStepId,roleId:'operations_dispatcher',moduleId:item.moduleId,actionId:item.actionId,stateBefore:item.stateBefore,stateAfter:item.stateAfter,controlVerified:true};
  const permissions=new Map([['project.create','projects.create_project']]);
  assert.doesNotThrow(()=>assertWorkflowCaptureMetadata(entry,item,descriptor,blueprint,permissions));
  const producerEntry={...entry} as Record<string,unknown>;delete producerEntry.stepId;assert.doesNotThrow(()=>assertWorkflowCaptureMetadata(producerEntry,item,descriptor,blueprint,permissions));
  assert.throws(()=>assertWorkflowCaptureMetadata({...entry,roleId:'operations_reviewer'},item,descriptor,blueprint,permissions));
  assert.throws(()=>assertWorkflowCaptureMetadata({...entry,moduleId:'project_tasks'},item,descriptor,blueprint,permissions));
  assert.throws(()=>assertWorkflowCaptureMetadata({...entry,actionId:'project.activate'},item,descriptor,blueprint,permissions));
});
