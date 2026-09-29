import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { assembleStandardResources } from '../../src/generator/resource-assembler';
import { getMaterialDescriptor } from '../../src/generator/material-descriptors';
import { standardRequest } from './standard-generation';

const hash=(value:Buffer|string)=>crypto.createHash('sha256').update(value).digest('hex');
export const fixtureExecutableSha256='e'.repeat(64);

export function createMaterialFactsFixture(root:string,templateId:string){
  const resources=path.join(root,'resources');assembleStandardResources(standardRequest(templateId),resources);
  const blueprintBytes=fs.readFileSync(path.join(resources,'blueprint.json'));
  const blueprintSha256=hash(blueprintBytes),resourceManifestSha256=hash(fs.readFileSync(path.join(resources,'resource-manifest.json')));
  const sourceFiles=[
    {path:'engine/desktop-runtime/src/main/index.ts',lines:120,bytes:4000,sha256:'1'.repeat(64)},
    {path:'engine/domain-packs/src/runtime/types.ts',lines:80,bytes:2400,sha256:'2'.repeat(64)}
  ];
  const sourceCanonical=sourceFiles.map((file)=>`${file.path}|${file.lines}|${file.bytes}|${file.sha256}`).join('\n');
  const sourceManifest={manifestVersion:'1.0',templateId,totalFiles:2,totalLines:200,sha256:hash(sourceCanonical),files:sourceFiles};
  const descriptor=getMaterialDescriptor(templateId);
  const captures=descriptor.screenshotScenarioIds.map((scenarioId,index)=>{
    const step=descriptor.workflowSteps[index%descriptor.workflowSteps.length]!;
    return {
      scenarioId,stepId:step.id,roleId:descriptor.roleProfileIds[index%4]!,moduleId:step.moduleId,
      actionId:step.actionId??null,stateBefore:`before-${index}`,stateAfter:`after-${index}`,
      executableSha256:fixtureExecutableSha256,blueprintSha256,imageSha256:index.toString(16).padStart(64,'0'),
      fileName:`${scenarioId}.png`,width:1440,height:960,perceptualDigest:(index+1).toString(16).padStart(16,'0'),controlVerified:true
    };
  });
  const screenshotManifest={manifestVersion:'2.0',templateId,executableSha256:fixtureExecutableSha256,blueprintSha256,captures};
  const acceptanceReceipt={
    receiptVersion:'1.0',status:'passed',templateId,businessRows:1000,executableSha256:fixtureExecutableSha256,
    blueprintSha256,resourceManifestSha256,checks:{package:'passed',workflow:'passed',persistence:'passed'}
  };
  return {resourcesDirectory:resources,templateId,sourceManifest,screenshotManifest,acceptanceReceipt};
}

export function writeEvidenceFiles(root:string,fixture:ReturnType<typeof createMaterialFactsFixture>){
  const paths={source:path.join(root,'source-manifest.json'),screenshots:path.join(root,'screenshot-manifest.json'),acceptance:path.join(root,'acceptance.json')};
  fs.writeFileSync(paths.source,JSON.stringify(fixture.sourceManifest),'utf8');
  fs.writeFileSync(paths.screenshots,JSON.stringify(fixture.screenshotManifest),'utf8');
  fs.writeFileSync(paths.acceptance,JSON.stringify(fixture.acceptanceReceipt),'utf8');return paths;
}
