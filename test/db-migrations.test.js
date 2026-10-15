'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {planDrift,digest}=require('../src/migration-intelligence');
const {parseOptions,analyzeSql,assertPlan,verifyBackup,defaultBackupPath,connectionFingerprint}=require('../src/db-migrations');
const {planMongo}=require('../src/db-introspection');

test('plans are deterministic and preserve column-level drift diagnostics',()=>{
 const desired={tables:{users:{id:{type:'text',required:true},email:{type:'text',required:true}}}};
 const actual={tables:{users:{id:{required:true,type:'text'},legacy:{type:'text'}}}};
 const plan=planDrift(desired,actual);
 assert.equal(plan.requiresApproval,true);
 assert.deepEqual(plan.changes.map(c=>c.kind),['add-column','drop-column']);
 assert.equal(plan.changes[0].risk,'review');
 assert.equal(plan.changes[1].risk,'destructive');
 assert.equal(plan.executable,false);
 assert.equal(digest({b:1,a:2}),digest({a:2,b:1}));
});

test('SQL migration parser is conservative, and provides reversible primitives',()=>{
 const sql=`
-- CreateTable
CREATE TABLE "Widgets" ("id" TEXT NOT NULL);
-- CreateIndex
CREATE UNIQUE INDEX "Widgets_id_key" ON "Widgets"("id");
-- AlterTable
ALTER TABLE "Widgets" ADD COLUMN "name" TEXT;
ALTER TABLE "Widgets" ADD COLUMN "required" TEXT NOT NULL;
DROP TABLE "OldWidgets";
ALTER TABLE "Widgets" ALTER COLUMN "id" TYPE UUID;
`;
 const steps=analyzeSql(sql);
 assert.equal(steps.length,6);
 assert.deepEqual(steps.map(s=>s.risk),
   ['review','review','low','review','destructive','manual']);
 assert.equal(steps[0].undo,'DROP TABLE IF EXISTS "Widgets";');
 assert.equal(steps[2].undo,'ALTER TABLE "Widgets" DROP COLUMN IF EXISTS "name";');
 assert.equal(steps[5].undo,null);
 assert.deepEqual(analyzeSql('-- This is an empty migration.\n'),[]);
});

test('MongoDB planner preserves extra live indexes and requires review for unique constraints',()=>{
 const target={collections:{items:{indexes:[
  {keys:{title:1},options:{}},{keys:{email:1},options:{unique:true}}
 ]}}};
 const live={collections:{items:{indexes:[{keys:{legacy:1},options:{}}],validator:null}}};
 const steps=planMongo(target,live);
 assert.equal(steps.filter(s=>s.action==='create-index').length,2);
 assert.equal(steps.find(s=>s.index&&s.index.options.unique).risk,'review');
 assert.equal(steps.find(s=>s.action==='extra-index').risk,'notice');
 target.collections.items.indexes.push({keys:{title:1},options:{}});
 assert.equal(planMongo(target,live).filter(s=>s.action==='create-index').length,2);
 const empty=planMongo(target,{collections:{}});
 assert.equal(empty[0].action,'create-collection');
});

test('apply and rollback require explicit hash approval',()=>{
 const before=process.env.J2E_P7_TEST_URI;
 process.env.J2E_P7_TEST_URI='mongodb://127.0.0.1:27017/p7-unit-test';
 try {
 const output=path.resolve('generated','test');
 assert.throws(()=>parseOptions(['apply','spec.json','--output',output]),/approve/);
 assert.throws(()=>parseOptions(['plan','spec.json']),/output/);
 assert.throws(()=>parseOptions(['plan','spec.json','--output',output,'--bad']),/Unknown/);
 const spec={database:{type:'mongodb',uriEnv:'J2E_P7_TEST_URI'}};
 const unsigned={version:1,engine:'mongodb',output,specFingerprint:digest(spec),
   connectionFingerprint:connectionFingerprint(spec),liveFingerprint:'x',
   changes:[],steps:[{action:'create-collection',collection:'x',risk:'review'}],
   requiresManual:false,requiresReview:true,requiresDestructive:false};
 const plan={...unsigned,hash:digest(unsigned)};
 const opts={output,'--approve':plan.hash};
 assert.throws(()=>assertPlan(plan,opts,spec),/allow-review/);
 assert.doesNotThrow(()=>assertPlan(plan,{...opts,'--allow-review':true},spec));
 assert.throws(()=>assertPlan({...plan,requiresManual:true},opts,spec),/checksum mismatch/);
 assert.throws(()=>assertPlan(plan,{...opts,'--approve':'wrong'},spec),/Approval hash/);
 process.env.J2E_P7_TEST_URI='mongodb://127.0.0.1:27017/another-database';
 assert.throws(()=>assertPlan(plan,{...opts,'--allow-review':true},spec),
   /Migration plan target or specification changed/);
 } finally {
   if(before===undefined)delete process.env.J2E_P7_TEST_URI;
   else process.env.J2E_P7_TEST_URI=before;
 }
});

test('MongoDB multi-host plans are bound to destination, not passwords',()=>{
  const key='J2E_P7_URI_MULTINODE';
  const original=process.env[key];
  const spec={database:{type:'mongodb',uriEnv:key}};
  try {
    process.env[key]='mongodb://alice:secret@mongo-a:27017,mongo-b:27017/inventory?replicaSet=rs';
    const one=connectionFingerprint(spec);
    process.env[key]='mongodb://alice:newpassword@mongo-a:27017,mongo-b:27017/inventory?replicaSet=rs';
    assert.equal(connectionFingerprint(spec),one);
    process.env[key]='mongodb://alice:newpassword@mongo-a:27017,mongo-b:27017/other?replicaSet=rs';
    assert.notEqual(connectionFingerprint(spec),one);
  } finally {
    if(original===undefined)delete process.env[key];
    else process.env[key]=original;
  }
});
test('backup paths are adjacent to output and shared by apply and rollback',()=>{
 const output=path.resolve('generated','demo');
 const location=defaultBackupPath({output},{hash:'a'.repeat(64),engine:'mongodb'});
 assert.equal(path.dirname(path.dirname(location)),path.dirname(output));
 assert.match(location,/\.archive$/);
 assert.match(defaultBackupPath({output},{hash:'a'.repeat(64),engine:'postgresql'}),/\.dump$/);
});
test('backup receipts reject tampering before rollback',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'j2e-p7-receipt-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'snapshot.archive');
 const data=Buffer.from('snapshot');
 fs.writeFileSync(file,data);
 const plan={hash:'42',engine:'mongodb'};
 const hash=require('node:crypto').createHash('sha256').update(data).digest('hex');
 fs.writeFileSync(file+'.j2e.json',JSON.stringify({version:1,planHash:'42',
   engine:'mongodb',bytes:data.length,sha256:hash}));
 assert.doesNotThrow(()=>verifyBackup(file,plan));
 fs.appendFileSync(file,'modified');
 assert.throws(()=>verifyBackup(file,plan),/integrity/);
});

test('CLI exposes database migration commands',()=>{
 const result=spawnSync(process.execPath,[path.join(__dirname,'../bin/json-to-express.js'),'--help'],
   {encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/j2e db apply/);
});
