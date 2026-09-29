import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadRuntimeBlueprint } from '../../src/core/blueprint-loader';
import { loadProductionPluginCatalog } from '../../src/core/production-plugin-loader';
import { verifyProjectResources } from '../../src/core/project-lock';
import { PluginRegistry } from '../../src/core/plugin-registry';
import { compileSchema } from '../../src/core/schema-compiler';
import { buildMaterialFacts } from '../../src/generator/material-facts';
import { createMaterialFactsFixture } from '../helpers/material-facts-fixture';

const quoted=(name:string)=>`"${name.replaceAll('"','""')}"`;

test('derives every table column foreign key and index from migrated SQLite',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'material-facts-db-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const fixture=createMaterialFactsFixture(root,'asset_inspection_rectification'),facts=buildMaterialFacts(fixture);
  const verified=verifyProjectResources(fixture.resourcesDirectory),registry=new PluginRegistry();
  for(const descriptor of loadProductionPluginCatalog(verified.productionCatalogPath))registry.register(descriptor);
  const blueprint=loadRuntimeBlueprint(verified.blueprintText,verified.blueprintSha256,registry),schema=compileSchema(blueprint),database=new DatabaseSync(':memory:');
  t.after(()=>database.close());database.exec('PRAGMA foreign_keys = ON;');for(const migration of schema.migrations)for(const statement of migration.statements)database.exec(statement);
  const actualTables=(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()as unknown as Array<{name:string}>).map((row)=>row.name);
  assert.deepEqual(facts.database.tables.map((table)=>table.name),actualTables);
  for(const table of facts.database.tables){
    const columns=database.prepare(`PRAGMA table_info(${quoted(table.name)})`).all()as unknown as Array<{name:string}>;
    const foreignKeys=database.prepare(`PRAGMA foreign_key_list(${quoted(table.name)})`).all()as unknown as unknown[];
    const indexes=database.prepare(`PRAGMA index_list(${quoted(table.name)})`).all()as unknown as unknown[];
    assert.deepEqual(table.columns.map((column)=>column.name),columns.map((column)=>column.name),table.name);
    assert.equal(table.foreignKeys.length,foreignKeys.length,table.name);
    assert.equal(table.indexes.length,indexes.length,table.name);
  }
  assert.equal(facts.database.tables.some((table)=>table.name==='biz_ghost_claim'),false);
  assert.ok(facts.database.tables.find((table)=>table.name==='biz_inspection_task')!.foreignKeys.length>0);
  assert.ok(facts.database.tables.find((table)=>table.name==='biz_work_order')!.indexes.length>0);
});
