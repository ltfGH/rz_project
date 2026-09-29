'use strict';
require('tsx/cjs');
const fs=require('node:fs');
const path=require('node:path');
const{buildMaterialFacts,canonicalMaterialFacts}=require('../../src/generator/material-facts.ts');
const{loadStandardTemplateCatalog}=require('../../src/generator/standard-project.ts');
const{createMaterialFactsFixture}=require('./material-facts-fixture.ts');

const output=process.argv[2];
if(!output||!path.isAbsolute(output)||fs.existsSync(output))throw new Error('Fixture output must be a new absolute directory.');
fs.mkdirSync(output,{recursive:true});
for(const template of loadStandardTemplateCatalog().templates){const fixture=createMaterialFactsFixture(path.join(output,`${template.id}-workspace`),template.id),facts=buildMaterialFacts(fixture);fs.writeFileSync(path.join(output,`${template.id}.json`),`${canonicalMaterialFacts(facts)}\n`,'utf8');}
process.stdout.write(`${JSON.stringify({ok:true,count:8})}\n`);
