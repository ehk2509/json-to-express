'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {normalizeSpec,validateSpec}=require('../src');
const {buildFiles}=require('../src/generators');

const base={
 specVersion:'1.0',app:{name:'migration-relational',framework:'express'},
 database:{type:'postgresql',prisma:{schemaPath:'config/db/schema.prisma'}},
 entities:{
  Folder:{fields:{slug:{type:'string',unique:true},parent:{type:'reference',ref:'Folder',onDelete:'nullify'}}},
  Label:{fields:{name:{type:'string',unique:true}}},
  Doc:{fields:{code:{type:'string',unique:true},folder:{type:'reference',ref:'Folder',onDelete:'restrict'},labels:{type:'reference',ref:'Label',many:true,onDelete:'nullify'}}}
 },
 fixtures:{
  Folder:[{where:{slug:'child'},data:{parent:{where:{slug:'root'}}}},{where:{slug:'root'},data:{}}],
  Label:[{where:{name:'topic'},data:{}}],
  Doc:[{where:{code:'doc-1'},data:{folder:{where:{slug:'root'}},labels:[{where:{name:'topic'}}]}}]
 },
 factories:{Doc:{count:2,uniqueBy:'code',onConflict:'update',
   template:{code:'factory-{{index}}',folder:{where:{slug:'root'}},labels:[{where:{name:'topic'}}]}}}
};

test('versioned migration history is generated next to schema overrides and guards deploy',()=>{
 const spec=normalizeSpec(base); const files=buildFiles(spec);
 assert.ok(files.has('config/db/schema.prisma'));
 const pkg=JSON.parse(files.get('package.json'));
 assert.match(pkg.scripts['db:migrate:deploy'],/verify-migration-history\.js/);
 assert.match(pkg.scripts['db:migrate:dev'],/--allow-new/);
 assert.match(pkg.scripts['db:migrate:record'],/--record/);
 assert.match(pkg.scripts['db:migrate:verify'],/verify-migration-history/);
 const init=files.get('scripts/create-initial-migration.js');
 const verifier=files.get('scripts/verify-migration-history.js');
 assert.match(init,/verify-migration-history/);
 assert.match(verifier,/migration-history\.json/);
 assert.match(verifier,/Applied or reviewed migration changed/);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'j2e-migrations-'));
 try {
   const src=path.join(root,'scripts');fs.mkdirSync(src);
   fs.writeFileSync(path.join(src,'verify-migration-history.js'),verifier);
   const migrationDir=path.join(root,'config/db/migrations');
   fs.mkdirSync(path.join(migrationDir,'00000000000000_init'),{recursive:true});
   fs.writeFileSync(path.join(root,'config/db/schema.prisma'),files.get('config/db/schema.prisma'));
   const sql=path.join(migrationDir,'00000000000000_init/migration.sql');
   fs.writeFileSync(sql,'CREATE TABLE baseline(id text);\n');
   fs.writeFileSync(path.join(migrationDir,'migration_lock.toml'),'provider = "postgresql"\n');
   const {verify}=require(path.join(src,'verify-migration-history.js'));
   assert.throws(()=>verify(),/manifest missing/);
   assert.equal(verify({record:true}),true);
   assert.equal(verify(),true);
   const manifest=JSON.parse(fs.readFileSync(path.join(root,'config/db/migration-history.json'),'utf8'));
   assert.equal(Object.keys(manifest.migrations).length,1);
   fs.writeFileSync(sql,'CREATE TABLE changed(id text);\n');
   assert.throws(()=>verify({record:true}),/migration changed/);
   fs.writeFileSync(sql,'CREATE TABLE baseline(id text);\n');
   fs.mkdirSync(path.join(migrationDir,'20261014120000_added'),{recursive:true});
   fs.writeFileSync(path.join(migrationDir,'20261014120000_added/migration.sql'),'CREATE TABLE upgrade(id text);\n');
   assert.throws(()=>verify(),/Untracked SQL migrations/);
   assert.equal(verify({allowNew:true}),true);
   assert.equal(verify({record:true}),true);
   assert.equal(verify(),true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('relational fixtures support two-pass self and many-to-many links plus stable-key factories',()=>{
 validateSpec(base);
 const spec=normalizeSpec(base);
 const generated=buildFiles(spec).get('prisma/seed.js');
 assert.match(generated,/const deferred=\[\]/);
 assert.match(generated,/relations/);
 assert.match(generated,/set:await Promise\.all/);
 assert.match(generated,/Unresolvable required fixture dependency/);
 assert.match(generated,/factory-1/);
 assert.match(generated,/factory-2/);
 assert.match(generated,/onConflict/);
 new Function(generated);
});

test('fixture validation rejects required cycles, ambiguous keys and non-deterministic factories',()=>{
 const copy=()=>JSON.parse(JSON.stringify(base));
 const required=copy();
 required.entities.Folder.fields.parent.required=true;
 assert.throws(()=>validateSpec(required),/required dependency cycle/);
 const key=copy();
 key.fixtures.Doc[0].where={code:'doc-1',slug:'invalid'};
 assert.throws(()=>validateSpec(key),/unique scalar field/);
 const many=copy();
 many.fixtures.Doc[0].data.labels={where:{name:'topic'}};
 assert.throws(()=>validateSpec(many),/requires an array/);
 const factory=copy();
 factory.factories.Doc.template.code='duplicated-key';
 assert.throws(()=>validateSpec(factory),/requires \{\{index\}\}/);
});
