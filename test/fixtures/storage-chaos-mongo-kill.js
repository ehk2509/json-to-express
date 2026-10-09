'use strict';

// Copied into a generated MongoDB replica-set app by the CI chaos job.
// Kills a real OS process on both sides of the MongoDB commit boundary.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const mongoose=require('mongoose');
const connect=require('./src/config/database');
const Owner=require('./src/models/Owner');
const outbox=require('./src/workflows/outbox');
const storage=require('./src/config/storage');

const directory=path.resolve('uploads');
function fileFor(label) {
  const key='owners/portrait/chaos-'+label+'.png';
  const file=path.join(directory,key);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,'object-still-referenced');
  return {key,file,provider:'local',originalName:label+'.png',mimeType:'image/png',size:23};
}
async function child(stage,id,key) {
  await connect();
  const session=await mongoose.startSession();
  await session.withTransaction(async () => {
    await Owner.updateOne({_id:id},{$set:{portrait:null}},{session});
    await outbox.enqueueJob('__j2e_storage_cleanup__',{values:[{key,provider:'local'}]},{
      session,config:{queue:'storage',maxAttempts:8,backoffMs:10}
    });
    if(stage==='before-commit')process.kill(process.pid,'SIGKILL');
  });
  if(stage==='after-commit')process.kill(process.pid,'SIGKILL');
  throw new Error('Crash boundary did not kill the child process');
}
async function main() {
  await connect();
  try {
    for(const stage of ['before-commit','after-commit']){
      const meta=fileFor(stage);
      const owner=await Owner.create({name:'Crash boundary '+stage,portrait:meta});
      const subprocess=spawnSync(process.execPath,[__filename,'child',stage,String(owner._id),meta.key],{
        cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:30000
      });
      assert.equal(subprocess.signal,'SIGKILL',
        stage+' must stop by real OS SIGKILL, not a thrown JavaScript exception: '+subprocess.stderr);
      await new Promise(resolve=>setTimeout(resolve,500));
      const current=await Owner.findById(owner._id).lean();
      const job=await outbox.Outbox.findOne({name:'__j2e_storage_cleanup__','payload.values.key':meta.key});
      assert.ok(fs.existsSync(meta.file),'physical object cannot disappear before worker recovery');
      if(stage==='before-commit'){
        assert.equal(current.portrait.key,meta.key,'database mutation rolled back on SIGKILL');
        assert.equal(job,null,'uncommitted deletion intent rolled back on SIGKILL');
      }else{
        assert.equal(current.portrait,null,'committed mutation survives process SIGKILL');
        assert.ok(job,'cleanup intent committed in same transaction');
        assert.equal(job.status,'pending');
        await outbox.Outbox.updateOne({_id:job._id},{$set:{availableAt:new Date(Date.now()-1000)}});
        execFileSync(process.execPath,['src/workflows/worker.js','--once'],{
          cwd:process.cwd(),env:{...process.env,J2E_WORKER_QUEUES:'storage'},timeout:30000
        });
        assert.equal(fs.existsSync(meta.file),false,'fresh worker must delete after crash');
        const recovered=await outbox.Outbox.findById(job._id);
        assert.equal(recovered.status,'done');
        await storage.cleanup([{key:meta.key,provider:'local'}]);
        assert.equal(fs.existsSync(meta.file),false,'repeated physical delete is idempotent');
      }
      await Owner.deleteOne({_id:owner._id});
    }
  } finally {await connect.disconnect();}
}
if(process.argv[2]==='child'){
  child(process.argv[3],process.argv[4],process.argv[5])
    .catch(error=>{console.error(error);process.exitCode=1;});
}else{
  main().catch(error=>{console.error(error);process.exitCode=1;});
}
