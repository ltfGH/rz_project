import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { z } from 'zod';

import type { RuntimeBlueprint } from '../shared/blueprint';
import type { MaterialDescriptor } from './material-descriptors';

const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const captureSchema=z.object({
  scenarioId:id,stepId:id,workflowStepId:id.nullable(),roleId:id,moduleId:id.nullable(),actionId:z.string().nullable(),stateBefore:z.string().min(1).max(500),stateAfter:z.string().min(1).max(500),
  executableSha256:sha,blueprintSha256:sha,imageSha256:sha,fileName:z.string().regex(/^[a-z0-9][a-z0-9_-]*\.png$/),
  width:z.number().int().min(320).max(10_000),height:z.number().int().min(240).max(10_000),
  perceptualDigest:z.string().regex(/^[a-f0-9]{64}$/),controlVerified:z.boolean()
}).strict();
const manifestSchema=z.object({manifestVersion:z.literal('2.0'),templateId:id,executableSha256:sha,blueprintSha256:sha,captures:z.array(captureSchema).min(12).max(18)}).strict();
const qualitySchema=z.object({qualityVersion:z.literal('1.0'),minimumLuminanceVariance:z.number().positive(),minimumDistinctSampleColors:z.number().int().min(2),maximumPerceptualHammingDistance:z.number().int().positive(),minimumChangedPixelRatio:z.number().positive().max(0.1),maximumPngBytes:z.number().int().positive(),maximumPixels:z.number().int().positive()}).strict();

export interface ScreenshotEvidenceFacts{readonly templateId:string;readonly executableSha256:string;readonly blueprintSha256:string;readonly screenshotScenarioIds:readonly string[];}
export interface PngInspection{readonly width:number;readonly height:number;readonly perceptualDigest:string;readonly luminanceVariance:number;readonly distinctSampleColors:number;}
interface DecodedPng{readonly width:number;readonly height:number;readonly rgba:Buffer;}
export interface StandardScreenshotPlanItem{
  readonly scenarioId:string;readonly stepId:string;readonly workflowStepId:string|null;
  readonly kind:'login'|'dashboard'|'list'|'detail'|'action'|'state'|'backup'|'minimum';
  readonly moduleId:string|null;readonly actionId:string|null;readonly actionLabel:string|null;
  readonly roleId:string;readonly viewport:'desktop'|'minimum';readonly fileName:string;
  readonly stateBefore:string;readonly stateAfter:string;
}

function fail(code:string):never{throw new Error(`SCREENSHOT_EVIDENCE_${code}`);}
function quality(){const candidates=[path.resolve(__dirname,'..','..','standard-materials','screenshot-quality.json'),path.resolve(__dirname,'..','..','..','standard-materials','screenshot-quality.json')],filename=candidates.find((candidate)=>fs.existsSync(candidate));if(!filename)return fail('QUALITY_CONFIG_MISSING');const parsed=qualitySchema.safeParse(JSON.parse(fs.readFileSync(filename,'utf8')));if(!parsed.success)return fail('QUALITY_CONFIG_INVALID');return parsed.data;}
function paeth(a:number,b:number,c:number){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
function decodePng(bytes:Buffer):DecodedPng{
  if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return fail('PNG_INVALID');
  let offset=8,width=0,height=0,bitDepth=0,colorType=-1,interlace=0;const compressed:Buffer[]=[];
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),start=offset+8,end=start+length;if(end+4>bytes.length)return fail('PNG_INVALID');const data=bytes.subarray(start,end);offset=end+4;
    if(type==='IHDR'){if(length!==13)return fail('PNG_INVALID');width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8]!;colorType=data[9]!;interlace=data[12]!;}
    else if(type==='IDAT')compressed.push(data);else if(type==='IEND')break;
  }
  const channels=colorType===6?4:colorType===2?3:colorType===4?2:colorType===0?1:0,limits=quality();if(!width||!height||width*height>limits.maximumPixels||bitDepth!==8||!channels||interlace!==0||compressed.length===0)return fail('PNG_UNSUPPORTED');
  const stride=width*channels,expectedLength=height*(stride+1),inflated=zlib.inflateSync(Buffer.concat(compressed),{maxOutputLength:expectedLength});if(inflated.length!==expectedLength)return fail('PNG_INVALID');
  const decoded=Buffer.alloc(height*stride);for(let y=0;y<height;y++){const source=y*(stride+1),filter=inflated[source]!,row=y*stride,previous=(y-1)*stride;for(let x=0;x<stride;x++){const raw=inflated[source+1+x]!,left=x>=channels?decoded[row+x-channels]!:0,up=y>0?decoded[previous+x]!:0,upperLeft=y>0&&x>=channels?decoded[previous+x-channels]!:0;let value;if(filter===0)value=raw;else if(filter===1)value=raw+left;else if(filter===2)value=raw+up;else if(filter===3)value=raw+Math.floor((left+up)/2);else if(filter===4)value=raw+paeth(left,up,upperLeft);else return fail('PNG_FILTER_INVALID');decoded[row+x]=value&255;}}
  const rgba=Buffer.alloc(width*height*4);for(let pixel=0;pixel<width*height;pixel++){const source=pixel*channels,target=pixel*4;if(colorType===6){rgba[target]=decoded[source]!;rgba[target+1]=decoded[source+1]!;rgba[target+2]=decoded[source+2]!;rgba[target+3]=decoded[source+3]!;}else if(colorType===2){rgba[target]=decoded[source]!;rgba[target+1]=decoded[source+1]!;rgba[target+2]=decoded[source+2]!;rgba[target+3]=255;}else if(colorType===4){rgba[target]=decoded[source]!;rgba[target+1]=decoded[source]!;rgba[target+2]=decoded[source]!;rgba[target+3]=decoded[source+1]!;}else{rgba[target]=decoded[source]!;rgba[target+1]=decoded[source]!;rgba[target+2]=decoded[source]!;rgba[target+3]=255;}}
  return{width,height,rgba};
}
function visibleChannel(rgba:Buffer,offset:number,channel:number){const alpha=rgba[offset+3]!/255;return rgba[offset+channel]!*alpha+255*(1-alpha);}
function luminance(rgba:Buffer,pixel:number){const offset=pixel*4;return visibleChannel(rgba,offset,0)*0.2126+visibleChannel(rgba,offset,1)*0.7152+visibleChannel(rgba,offset,2)*0.0722;}
function differenceHash(image:DecodedPng){let bits='';for(let y=0;y<16;y++){const sampleY=Math.min(image.height-1,Math.floor((y+0.5)*image.height/16));for(let x=0;x<16;x++){const leftX=Math.min(image.width-1,Math.floor((x+0.25)*image.width/17)),rightX=Math.min(image.width-1,Math.floor((x+1.25)*image.width/17));bits+=luminance(image.rgba,sampleY*image.width+leftX)>luminance(image.rgba,sampleY*image.width+rightX)?'1':'0';}}
  let output='';for(let index=0;index<bits.length;index+=4)output+=Number.parseInt(bits.slice(index,index+4),2).toString(16);return output;
}
function hamming(left:string,right:string){let distance=0;for(let index=0;index<left.length;index++){let value=Number.parseInt(left[index]!,16)^Number.parseInt(right[index]!,16);while(value){distance+=value&1;value>>>=1;}}return distance;}
function changedPixelRatio(leftFile:string,rightFile:string){const left=decodePng(fs.readFileSync(leftFile)),right=decodePng(fs.readFileSync(rightFile)),width=256,height=144;let changed=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const leftOffset=(Math.min(left.height-1,Math.floor(y*left.height/height))*left.width+Math.min(left.width-1,Math.floor(x*left.width/width)))*4,rightOffset=(Math.min(right.height-1,Math.floor(y*right.height/height))*right.width+Math.min(right.width-1,Math.floor(x*right.width/width)))*4;if(Math.max(Math.abs(visibleChannel(left.rgba,leftOffset,0)-visibleChannel(right.rgba,rightOffset,0)),Math.abs(visibleChannel(left.rgba,leftOffset,1)-visibleChannel(right.rgba,rightOffset,1)),Math.abs(visibleChannel(left.rgba,leftOffset,2)-visibleChannel(right.rgba,rightOffset,2)))>=8)changed++;}return changed/(width*height);}

function scenarioKind(value:string):StandardScreenshotPlanItem['kind']{
  if(value.includes('login'))return'login';if(value.includes('dashboard'))return'dashboard';if(value.includes('backup'))return'backup';
  if(value.includes('minimum')||value.includes('mobile'))return'minimum';if(value.includes('form'))return'action';
  if(value.includes('detail'))return'detail';if(value.includes('list')||value.includes('ledger'))return'list';return'state';
}
const ACTION_MODULES:Readonly<Record<string,string>>=Object.freeze({
  'application.create':'applications','application.submit':'applications','application.reject':'applications','application.revise':'applications','application.approve':'applications','application.archive':'applications',
  'asset.inspection.plan.create':'assets','asset.inspection.task.create':'inspection_plans','asset.work_order.create':'assets',
  'inspection.start':'inspection_tasks','inspection.record':'inspection_tasks','inspection.submit':'inspection_tasks','inspection.archive':'inspection_tasks',
  'work_order.dispatch':'work_orders','work_order.accept':'work_orders','work_order.add_processing_record':'work_orders','work_order.submit_resolution':'work_orders','work_order.approve_close':'work_orders',
  'inventory.material.create':'materials','inventory.batch.receive_new':'inventory_batches','inventory.application.create':'inventory_batches',
  'project.create':'projects','project.activate':'projects','project.milestone.create':'projects','project.task.create':'projects','project.risk.create':'projects','project.deliverable.submit':'projects','project.deliverable.review':'deliverables','project.delivery.archive':'projects','project.request_close':'projects'
});
const SCENARIO_MODULES:Readonly<Record<string,string>>=Object.freeze({inventory_ledger:'inventory_transactions'});
export function moduleForMaterialAction(actionId:string,fallbackModuleId:string):string{return ACTION_MODULES[actionId]??fallbackModuleId;}
const SCENARIO_ACTIONS:Readonly<Record<string,Readonly<{id:string;label:string}>>>=Object.freeze({
  application_create_form:Object.freeze({id:'application.create',label:'创建申请'}),material_create_form:Object.freeze({id:'inventory.material.create',label:'创建物料'}),batch_receive_form:Object.freeze({id:'inventory.batch.receive_new',label:'新批次入库'}),
  inspection_plan_form:Object.freeze({id:'asset.inspection.plan.create',label:'创建巡检计划'}),inspection_task_form:Object.freeze({id:'asset.inspection.task.create',label:'创建巡检任务'}),inspection_record_form:Object.freeze({id:'inspection.record',label:'记录检查结果'}),inspection_abnormal_form:Object.freeze({id:'inspection.record',label:'记录检查结果'}),
  work_order_create_form:Object.freeze({id:'asset.work_order.create',label:'创建工单'}),work_order_dispatch_form:Object.freeze({id:'work_order.dispatch',label:'分派工单'}),work_order_processing_form:Object.freeze({id:'work_order.add_processing_record',label:'填写处理记录'}),
  project_create_form:Object.freeze({id:'project.create',label:'创建项目'}),milestone_create_form:Object.freeze({id:'project.milestone.create',label:'创建里程碑'}),task_create_form:Object.freeze({id:'project.task.create',label:'创建任务'}),risk_create_form:Object.freeze({id:'project.risk.create',label:'登记风险'}),deliverable_submit_form:Object.freeze({id:'project.deliverable.submit',label:'提交交付成果'}),file_archive_form:Object.freeze({id:'project.delivery.archive',label:'归档交付物'})
});
function actionForScenario(descriptor:MaterialDescriptor,scenarioId:string){
  const score=(step:MaterialDescriptor['workflowSteps'][number])=>{let value=0;for(const token of step.id.split('_'))if(token.length>3&&scenarioId.includes(token))value+=10;for(const token of(step.actionId??'').split('.'))if(token.length>3&&scenarioId.includes(token))value+=5;for(const token of step.entityId.split('_'))if(token.length>3&&scenarioId.includes(token))value+=3;return value;};
  return descriptor.workflowSteps.filter((step)=>step.actionId).sort((left,right)=>score(right)-score(left))[0];
}

export function buildStandardScreenshotPlan(descriptor:MaterialDescriptor,blueprint:RuntimeBlueprint):readonly StandardScreenshotPlanItem[]{
  const modules=blueprint.modules??[],businessModules=modules.filter((module)=>module.id!=='maintenance');if(businessModules.length===0)return fail('PLAN_MODULES_MISSING');
  const moduleFor=(scenarioId:string,fallback:string)=>{
    const explicit=SCENARIO_MODULES[scenarioId];if(explicit&&modules.some((module)=>module.id===explicit))return explicit;
    const score=(entityId:string)=>scenarioId.includes(entityId)?100+entityId.length:entityId.split('_').filter((token)=>token.length>3&&scenarioId.includes(token)).reduce((sum,token)=>sum+token.length,0),matched=[...businessModules].sort((left,right)=>score(right.entity)-score(left.entity))[0];
    if(matched&&score(matched.entity)===0)return modules.find((module)=>module.id===fallback)?.id??businessModules[0]!.id;
    return matched?.id??(modules.some((module)=>module.id===fallback)?fallback:businessModules[0]!.id);
  };
  const plan=descriptor.screenshotScenarioIds.map((scenarioId,index):StandardScreenshotPlanItem=>{
    const kind=scenarioKind(scenarioId),flowIndex=Math.min(descriptor.workflowSteps.length-1,Math.floor(Math.max(0,index-2)*descriptor.workflowSteps.length/Math.max(1,descriptor.screenshotScenarioIds.length-2))),flow=descriptor.workflowSteps[flowIndex]!;
    let moduleId:string|null=moduleFor(scenarioId,flow.moduleId);if(kind==='login'||kind==='dashboard')moduleId=null;else if(kind==='backup')moduleId=modules.some((module)=>module.id==='maintenance')?'maintenance':businessModules[0]!.id;else if(kind==='minimum')moduleId=businessModules[0]!.id;
    const explicit=kind==='action'?SCENARIO_ACTIONS[scenarioId]:undefined,actionFlow=kind==='action'?(explicit?descriptor.workflowSteps.find((step)=>step.actionId===explicit.id):actionForScenario(descriptor,scenarioId)):undefined,actionId=explicit?.id??actionFlow?.actionId??null;
    if(actionId)moduleId=moduleForMaterialAction(actionId,actionFlow?.moduleId??moduleId!);
    return Object.freeze({
      scenarioId,stepId:`capture_${String(index+1).padStart(2,'0')}`,workflowStepId:actionFlow?.id??null,kind,moduleId,
      actionId,actionLabel:actionId?(descriptor.operationLabels[actionId]??explicit?.label??null):null,
      roleId:'operations_admin',viewport:kind==='minimum'?'minimum':'desktop',fileName:`${String(index+1).padStart(2,'0')}-${scenarioId}.png`,
      stateBefore:actionFlow?.prerequisite??`准备展示${scenarioId}`,stateAfter:actionFlow?.result??`已展示${scenarioId}`
    });
  });
  return Object.freeze(plan);
}

export function inspectPng(filename:string):PngInspection{
  const limits=quality(),bytes=fs.readFileSync(filename);if(bytes.length>limits.maximumPngBytes)return fail('PNG_TOO_LARGE');const image=decodePng(bytes),count=image.width*image.height,step=Math.max(1,Math.floor(count/4096));let samples=0,sum=0,sumSquares=0;const colors=new Set<number>();
  for(let pixel=0;pixel<count;pixel+=step){const offset=pixel*4,light=luminance(image.rgba,pixel),red=Math.round(visibleChannel(image.rgba,offset,0)),green=Math.round(visibleChannel(image.rgba,offset,1)),blue=Math.round(visibleChannel(image.rgba,offset,2));sum+=light;sumSquares+=light*light;samples++;colors.add((red<<16)|(green<<8)|blue);}
  const mean=sum/samples,variance=Math.max(0,sumSquares/samples-mean*mean);return Object.freeze({width:image.width,height:image.height,perceptualDigest:differenceHash(image),luminanceVariance:variance,distinctSampleColors:colors.size});
}

export function assertWorkflowCaptureBinding(value:unknown,executableSha256:string,blueprintSha256:string):void{
  if(!value||typeof value!=='object')return fail('WORKFLOW_BINDING_INVALID');const candidate=value as Record<string,unknown>;
  if(typeof candidate.executableSha256!=='string'||typeof candidate.blueprintSha256!=='string'||!sha.safeParse(candidate.executableSha256).success||!sha.safeParse(candidate.blueprintSha256).success||candidate.executableSha256!==executableSha256||candidate.blueprintSha256!==blueprintSha256)return fail('WORKFLOW_BINDING_MISMATCH');
}

export function assertWorkflowCaptureMetadata(value:unknown,plan:StandardScreenshotPlanItem,descriptor:MaterialDescriptor,blueprint:RuntimeBlueprint,permissionByAction:ReadonlyMap<string,string>):void{
  if(!value||typeof value!=='object')return fail('WORKFLOW_METADATA_INVALID');const capture=value as Record<string,unknown>;
  if(capture.scenarioId!==plan.scenarioId||(capture.stepId!==undefined&&capture.stepId!==plan.stepId)||typeof capture.roleId!=='string'||typeof capture.stateBefore!=='string'||!capture.stateBefore.trim()||typeof capture.stateAfter!=='string'||!capture.stateAfter.trim())return fail('WORKFLOW_METADATA_MISMATCH');
  const moduleId=capture.moduleId===null?null:typeof capture.moduleId==='string'?capture.moduleId:returnFail(),actionId=capture.actionId===null?null:typeof capture.actionId==='string'?capture.actionId:returnFail(),workflowStepId=capture.workflowStepId===null?null:typeof capture.workflowStepId==='string'?capture.workflowStepId:returnFail();
  if(moduleId!==null&&!(blueprint.modules??[]).some((module)=>module.id===moduleId))return fail('WORKFLOW_MODULE_INVALID');const role=(blueprint.roles??[]).find((candidate)=>candidate.id===capture.roleId);if(!role)return fail('WORKFLOW_ROLE_INVALID');
  const workflowStep=workflowStepId===null?undefined:descriptor.workflowSteps.find((step)=>step.id===workflowStepId);if(workflowStepId!==null&&!workflowStep)return fail('WORKFLOW_STEP_INVALID');
  if(workflowStep){const owner=workflowStep.actionId?ACTION_MODULES[workflowStep.actionId]??workflowStep.moduleId:workflowStep.moduleId;if(moduleId!==owner||(actionId!==null&&actionId!==(workflowStep.actionId??null)))return fail('WORKFLOW_STEP_MISMATCH');}
  else if(actionId!==plan.actionId||moduleId!==plan.moduleId)return fail('WORKFLOW_PLAN_MISMATCH');
  if(actionId!==null){const permission=permissionByAction.get(actionId);if(!permission||!role.permissions.includes(permission)||capture.controlVerified!==true)return fail('WORKFLOW_ACTION_INVALID');}
  function returnFail():never{return fail('WORKFLOW_METADATA_INVALID');}
}

export function assertScreenshotEvidence(manifestValue:unknown,facts:ScreenshotEvidenceFacts,imageRoot:string):void{
  const parsed=manifestSchema.safeParse(manifestValue);if(!parsed.success)return fail('MANIFEST_INVALID');const manifest=parsed.data,limits=quality();
  if(manifest.templateId!==facts.templateId||manifest.executableSha256!==facts.executableSha256||manifest.blueprintSha256!==facts.blueprintSha256)return fail('FACT_HASH_MISMATCH');
  const scenarios=manifest.captures.map((capture)=>capture.scenarioId),steps=manifest.captures.map((capture)=>capture.stepId);
  if(new Set(scenarios).size!==scenarios.length||new Set(steps).size!==steps.length||scenarios.join()!==facts.screenshotScenarioIds.join())return fail('PLAN_MISMATCH');
  const root=path.resolve(imageRoot),images:Array<{digest:string;filename:string}>=[];
  for(const capture of manifest.captures){
    if(capture.executableSha256!==manifest.executableSha256||capture.blueprintSha256!==manifest.blueprintSha256||(capture.actionId!==null&&!capture.controlVerified))return fail('CAPTURE_BINDING_INVALID');
    const filename=path.resolve(root,capture.fileName);if(path.dirname(filename)!==root)return fail('IMAGE_PATH_INVALID');let stat:fs.Stats;try{stat=fs.lstatSync(filename);}catch{return fail('IMAGE_MISSING');}if(!stat.isFile()||stat.isSymbolicLink())return fail('IMAGE_INVALID');
    const imageHash=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');if(imageHash!==capture.imageSha256)return fail('IMAGE_HASH_MISMATCH');
    const inspection=inspectPng(filename);if(inspection.width!==capture.width||inspection.height!==capture.height||inspection.perceptualDigest!==capture.perceptualDigest)return fail('IMAGE_METADATA_MISMATCH');
    if(inspection.luminanceVariance<limits.minimumLuminanceVariance||inspection.distinctSampleColors<limits.minimumDistinctSampleColors)return fail('IMAGE_BLANK');images.push({digest:inspection.perceptualDigest,filename});
  }
  for(let left=0;left<images.length;left++)for(let right=left+1;right<images.length;right++)if(hamming(images[left]!.digest,images[right]!.digest)<limits.maximumPerceptualHammingDistance&&changedPixelRatio(images[left]!.filename,images[right]!.filename)<limits.minimumChangedPixelRatio)return fail('IMAGE_NEAR_DUPLICATE');
}
