'use strict';
// Execute from a generated application with a primary server already running.
// Starts a separate API process, a separate reconciler, and deterministic crash barriers.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const db=require('./src/config/database');
const audit=require('./scripts/storage-reconcile');
const lease=require('./src/config/storage-lease');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const target=process.argv[2] || 'mongo';
const mode=process.argv[3] || 'parent';
const basePort=target==='postgres'?3498:3494;
const secondaryPort=target==='postgres'?3499:3496;
const prefixUrl=port=>'http://127.0.0.1:'+port;
const storageRoot=target==='postgres'?'uploads':'uploaded-files';
const field=target==='postgres'?'photo':'file';
const nameField=target==='postgres'?'title':'name';
const mime=target==='postgres'?'image/png':'text/plain';
async function waitFor(check,label) {
  for(let n=0;n<200;n++){if(await check())return;await sleep(50);}
  throw new Error('Timed out waiting for '+label);
}
const exists=name=>fs.existsSync(path.resolve(name));
function oldObject(key){
  const file=path.resolve(storageRoot,key);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,'aged-not-referenced');
  const old=new Date(Date.now()-49*3600000);
  fs.utimesSync(file,old,old);
  return file;
}
async function make(port,name) {
  const form=new FormData();
  form.set(nameField,name);
  form.set(field,new Blob([target==='postgres'?new Uint8Array([137,80,78,71]):'content'],{type:mime}),name+'.txt');
  const res=await fetch(prefixUrl(port)+'/api/assets',{method:'POST',body:form});
  assert.equal(res.status,201,await res.text());
  return res.json();
}
function spawnChild(args,env={}){
  const child=spawn(process.execPath,args,{cwd:process.cwd(),env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  let errors='';
  child.stderr.on('data',chunk=>{errors+=String(chunk);});
  child.stdout.on('data',()=>{});
  return {child,result:new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal,errors})))};
}
async function child() {
  await db();
  try{
    const key=process.env.J2E_CHAOS_TARGET_KEY;
    await audit.reconcile(audit.args(['--execute']),{
      async beforeDelete(item){
        if(item.key!==key)return;
        if(mode==='crash')process.kill(process.pid,'SIGKILL');
        fs.writeFileSync('.j2e-chaos-ready','ready');
        await waitFor(()=>exists('.j2e-chaos-resume'),'parent resume');
      }
    });
  }finally{await db.disconnect();}
}
async function parent(){
  const replica=spawnChild(['src/server.js'],{PORT:String(secondaryPort),HOST:'127.0.0.1'});
  try{
    await waitFor(async()=>{
      try{const res=await fetch(prefixUrl(secondaryPort)+'/health');return res.ok;}
      catch{return false;}
    },'secondary server health');
    const original=await make(basePort,'primary-instance');
    assert.ok(original[field] && original[field].key);
    const secondary=await make(secondaryPort,'second-instance');
    const cross=await fetch(prefixUrl(basePort)+'/api/assets/'+(secondary.id||secondary._id));
    assert.equal(cross.status,200,'both replicas must read same DB');
    const keyPrefix=path.posix.dirname(original[field].key);
    const orphanKey=keyPrefix+'/orphan-writer-race.txt';
    const orphan=oldObject(orphanKey);
    for(const file of ['.j2e-chaos-ready','.j2e-chaos-resume'])fs.rmSync(file,{force:true});
    const rec=spawnChild([__filename,target,'reconcile'],{J2E_CHAOS_TARGET_KEY:orphanKey});
    await waitFor(()=>exists('.j2e-chaos-ready'),'reconciler after final DB and identity check');
    const forged=new FormData();
    forged.set(nameField,'forged-referenced-object');
    forged.set(field,orphanKey);
    const reject=await fetch(prefixUrl(secondaryPort)+'/api/assets',{method:'POST',body:forged});
    assert.equal(reject.status,400,'second writer may never reattach an old object key');
    const newAsset=await make(secondaryPort,'parallel-fresh-upload');
    assert.notEqual(newAsset[field].key,orphanKey,'writer always generates a new key');
    fs.writeFileSync('.j2e-chaos-resume','go');
    const result=await rec.result;
    assert.equal(result.code,0,'independent reconciler failed: '+result.errors);
    assert.equal(exists(orphan),false,'unreferenced old object removed');
    assert.equal(exists(path.resolve(storageRoot,newAsset[field].key)),true,'newly referenced object untouched');
    assert.equal((await fetch(prefixUrl(basePort)+'/api/assets/'+(newAsset.id||newAsset._id))).status,200);
    for(const file of ['.j2e-chaos-ready','.j2e-chaos-resume'])fs.rmSync(file,{force:true});
    // SIGKILL at the exact DB/identity-check -> physical-delete boundary.
    const crashKey=keyPrefix+'/orphan-crash-boundary.txt';
    const crashedFile=oldObject(crashKey);
    const killed=spawnChild([__filename,target,'crash'],{J2E_CHAOS_TARGET_KEY:crashKey});
    const killedResult=await killed.result;
    assert.equal(killedResult.signal,'SIGKILL','real process crash required: '+killedResult.errors);
    assert.equal(exists(crashedFile),true,'crash before deletion leaves file intact');
    await db();
    try{
      if(target==='postgres'){
        await db.client.j2EStorageLease.updateMany({data:{expiresAt:new Date(0)},where:{id:'global-storage-reconciliation'}});
      }else{
        await lease.Lease.updateOne({_id:'global-storage-reconciliation'},{$set:{expiresAt:new Date(0)}});
      }
      const after=await audit.reconcile(audit.args(['--execute']));
      assert.ok(after.removed>=1,'expired lease takeover must reclaim orphan');
      assert.equal(exists(crashedFile),false);
    }finally{await db.disconnect();}
    console.log('Two independent API replicas and external reconciler passed '+target+' barriers');
  }finally{
    replica.child.kill('SIGTERM');
    await Promise.race([replica.result,sleep(3000)]);
  }
}
if(mode==='reconcile'||mode==='crash')child().catch(error=>{console.error(error);process.exitCode=1;});
else parent().catch(error=>{console.error(error);process.exitCode=1;});
