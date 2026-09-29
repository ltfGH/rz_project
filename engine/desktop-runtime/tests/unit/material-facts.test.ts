import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildMaterialFacts } from '../../src/generator/material-facts';
import { getMaterialDescriptor } from '../../src/generator/material-descriptors';
import { loadStandardTemplateCatalog } from '../../src/generator/standard-project';
import { createMaterialFactsFixture, writeEvidenceFiles } from '../helpers/material-facts-fixture';

test('builds deeply frozen evidence-bound facts for every standard template',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'material-facts-all-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const template of loadStandardTemplateCatalog().templates){
    const fixture=createMaterialFactsFixture(path.join(root,template.id),template.id),facts=buildMaterialFacts(fixture);
    const descriptor=getMaterialDescriptor(template.id),serialized=JSON.stringify(facts);
    assert.equal(facts.factVersion,'1.0');assert.equal(facts.templateId,template.id);
    assert.equal(facts.software.buildDate,'2026-09-21');assert.equal(facts.software.materialGeneratedOn,'2026-09-29');assert.ok(facts.constraints.validationNotes.length>=2);assert.ok(facts.constraints.unsupportedClaims.length>=2);
    assert.deepEqual(facts.modules.map((item)=>item.id),Object.keys(descriptor.modulePurposes));
    for(const entityId of descriptor.coreEntityIds)assert.equal(facts.entities.some((item)=>item.id===entityId&&item.isCore),true,`${template.id}:${entityId}`);
    for(const module of facts.modules)assert.equal(facts.entities.some((item)=>item.id===module.entityId),true,`${template.id}:${module.id}`);
    assert.deepEqual(facts.roles.map((item)=>item.id),descriptor.roleProfileIds);
    assert.deepEqual(facts.commands.map((item)=>item.id),Object.keys(descriptor.operationLabels));
    for(const command of facts.commands){assert.ok(command.moduleId,`${template.id}:${command.id}:module`);assert.ok(Array.isArray(command.inputLabels),`${template.id}:${command.id}:inputs`);assert.ok(command.precondition&&command.result&&command.failure,`${template.id}:${command.id}:behavior`);assert.equal(facts.modules.find((module)=>module.id===command.moduleId)?.operations.includes(command.id),true,`${template.id}:${command.id}:ownership`);}
    assert.deepEqual(facts.workflows[0]?.steps.map((item)=>item.id),descriptor.workflowSteps.map((item)=>item.id));
    assert.ok(facts.workflows[0]!.steps.length>=4,template.id);
    assert.equal(facts.screenshots.captures.length,descriptor.screenshotScenarioIds.length);
    assert.equal(facts.source.totalLines,200);assert.equal(facts.evidence.status,'passed');
    assert.equal(Object.isFrozen(facts),true);assert.equal(Object.isFrozen(facts.database.tables),true);
    assert.doesNotMatch(serialized,new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
    assert.doesNotMatch(serialized,/scrypt\$16384\$|StrongPass123!|ghp_|github_pat_/i);
  }
});

test('rejects mismatched evidence unsafe paths credentials and unknown receipt data without echoing secrets',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'material-facts-hostile-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const base=createMaterialFactsFixture(root,'project_task_management');
  const cases:[string,(value:any)=>void][]=[
    ['screenshot hash mismatch',(value)=>{value.screenshotManifest.blueprintSha256='9'.repeat(64);}],
    ['acceptance hash mismatch',(value)=>{value.acceptanceReceipt.executableSha256='8'.repeat(64);}],
    ['absolute source path',(value)=>{value.sourceManifest.files[0].path='C:/secret/source.ts';}],
    ['duplicate source path',(value)=>{value.sourceManifest.files[1].path=value.sourceManifest.files[0].path;const canonical=value.sourceManifest.files.map((file:any)=>`${file.path}|${file.lines}|${file.bytes}|${file.sha256}`).join('\n');value.sourceManifest.sha256=crypto.createHash('sha256').update(canonical).digest('hex');}],
    ['wrong step action',(value)=>{const target=value.screenshotManifest.captures.find((capture:any)=>capture.workflowStepId);target.actionId='project.activate';}],
    ['credential field',(value)=>{value.acceptanceReceipt.password='StrongPass123!';}],
    ['failed receipt',(value)=>{value.acceptanceReceipt.status='failed';}],
    ['wrong template',(value)=>{value.sourceManifest.templateId='asset_inspection_management';}]
  ];
  for(const[name,mutate]of cases){const value=structuredClone(base);mutate(value);assert.throws(()=>buildMaterialFacts(value),error=>error instanceof Error&&!error.message.includes('StrongPass123!'),name);}
});

test('publishes canonical facts through a strict atomic CLI',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'material-facts-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const fixture=createMaterialFactsFixture(root,'project_task_management'),paths=writeEvidenceFiles(root,fixture),output=path.join(root,'material-facts.json');
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'..','..','tools','build-material-facts.cjs'),'--resources',fixture.resourcesDirectory,'--source-manifest',paths.source,'--screenshots',paths.screenshots,'--acceptance',paths.acceptance,'--template',fixture.templateId,'--output',output],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{ok:true,output:'material-facts.json'});
  const first=fs.readFileSync(output,'utf8');assert.equal(JSON.parse(first).factVersion,'1.0');
  const repeated=spawnSync(process.execPath,[path.resolve(__dirname,'..','..','tools','build-material-facts.cjs'),'--resources',fixture.resourcesDirectory,'--source-manifest',paths.source,'--screenshots',paths.screenshots,'--acceptance',paths.acceptance,'--template',fixture.templateId,'--output',output],{encoding:'utf8',windowsHide:true});
  assert.notEqual(repeated.status,0);assert.equal(fs.readFileSync(output,'utf8'),first);
});
