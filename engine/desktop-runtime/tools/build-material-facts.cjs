'use strict';

require('tsx/cjs');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {buildMaterialFacts,canonicalMaterialFacts}=require('../src/generator/material-facts.ts');

function fail(message){process.stderr.write(`${message}\n`);process.exit(2);}
function parseArguments(){
  const names=['--resources','--source-manifest','--screenshots','--acceptance','--template','--output'],result={};
  if(process.argv.length!==2+names.length*2)fail('MATERIAL_FACTS_ARGUMENTS_INVALID');
  for(let index=2;index<process.argv.length;index+=2){const name=process.argv[index],value=process.argv[index+1];if(!names.includes(name)||result[name]||!value)fail('MATERIAL_FACTS_ARGUMENTS_INVALID');result[name]=value;}
  if(names.some((name)=>!result[name]))fail('MATERIAL_FACTS_ARGUMENTS_INVALID');return result;
}
function regular(filename,limit){if(!path.isAbsolute(filename))fail('MATERIAL_FACTS_PATH_INVALID');let stat;try{stat=fs.lstatSync(filename);}catch{fail('MATERIAL_FACTS_INPUT_MISSING');}if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)fail('MATERIAL_FACTS_INPUT_INVALID');return JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));}
function directory(filename){if(!path.isAbsolute(filename))fail('MATERIAL_FACTS_PATH_INVALID');let stat;try{stat=fs.lstatSync(filename);}catch{fail('MATERIAL_FACTS_INPUT_MISSING');}if(!stat.isDirectory()||stat.isSymbolicLink())fail('MATERIAL_FACTS_INPUT_INVALID');return path.resolve(filename);}

try{
  const args=parseArguments(),output=args['--output'];if(!path.isAbsolute(output)||fs.existsSync(output))fail('MATERIAL_FACTS_OUTPUT_EXISTS');
  const parent=path.dirname(output);if(!fs.existsSync(parent)||!fs.lstatSync(parent).isDirectory())fail('MATERIAL_FACTS_OUTPUT_PARENT_INVALID');
  const facts=buildMaterialFacts({resourcesDirectory:directory(args['--resources']),templateId:args['--template'],sourceManifest:regular(args['--source-manifest'],16*1024*1024),screenshotManifest:regular(args['--screenshots'],8*1024*1024),acceptanceReceipt:regular(args['--acceptance'],1024*1024)});
  const staging=path.join(parent,`.${path.basename(output)}.staging-${crypto.randomUUID()}`);
  try{fs.writeFileSync(staging,`${canonicalMaterialFacts(facts)}\n`,{encoding:'utf8',flag:'wx'});fs.renameSync(staging,output);}catch(error){fs.rmSync(staging,{force:true});throw error;}
  process.stdout.write(`${JSON.stringify({ok:true,output:path.basename(output)})}\n`);
}catch(error){fail(error instanceof Error?error.message:'MATERIAL_FACTS_FAILED');}
