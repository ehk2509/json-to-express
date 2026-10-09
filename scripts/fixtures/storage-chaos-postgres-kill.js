'use strict';

// Runs inside a generated Prisma application; verifies real OS SIGKILL recovery.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const connect=require('./src/config/database');
const prisma=connect.client;
const outbox=require('./src/workflows/outbox');
const storage=require('./src/config/storage');

function createPhoto(label){
  const key='assets/photo/chaos-'+label+'.png';
  const file=path.join('uploads',key);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,'committed-file');
  return {key,file,provider:'local',mimeType:'image/png',originalName:label+'.png',size:14};
}
async function child(stage,id,key){
  await connect();
  await prisma.$transaction(async tx=>{
    await tx.asset.update({where:{id},data:{photo:null}});
    await outbox.enqueueJob('__j2e_storage_cleanup__',{values:[{key,provider:'local'}]},{
      db:tx,config:{queue:'storage',maxAttempts:8,backoffMs:10}
    });
    if(stage==='before-commit')process.kill(process.pid,'SIGKILL');
  });
  if(stage==='after-commit')process.kill(process.pid,'SIGKILL');
  throw new Error('Expected SIGKILL at PostgreSQL transaction boundary');
}
async function main(){
  await connect();
  try {
    for(const stage of ['before-commit','after-commit']){
      const metadata=createPhoto(stage);
      const asset=await prisma.asset.create({data:{title:'Crash '+stage,photo:metadata}});
      const subprocess=spawnSync(process.execPath,[__filename,'child',stage,asset.id,metadata.key],{
        cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:30000
      });
      assert.equal(subprocess.signal,'SIGKILL','expected real process termination: '+subprocess.stderr);
      await new Promise(resolve=>setTimeout(resolve,300));
      const current=await prisma.asset.findUnique({where:{id:asset.id}});
      const intents=await prisma.j2EOutbox.findMany({where:{name:'__j2e_storage_cleanup__'}});
      const job=intents.find(row=>Array.isArray(row.payload.values) && row.payload.values.some(x=>x.key===metadata.key));
      assert.ok(fs.existsSync(metadata.file));
      if(stage==='before-commit'){
        assert.equal(current.photo.key,metadata.key,'uncommitted mutation rolls back');
        assert.equal(job,undefined,'uncommitted cleanup intent rolls back');
      } else {
        assert.equal(current.photo,null,'committed update survives SIGKILL');
        assert.ok(job,'cleanup intent is in same transaction as mutation');
        await prisma.j2EOutbox.update({where:{id:job.id},data:{availableAt:new Date(Date.now()-1000)}});
        execFileSync(process.execPath,['src/workflows/worker.js','--once'],{
          cwd:process.cwd(),env:{...process.env,J2E_WORKER_QUEUES:'storage'},timeout:30000
        });
        const completed=await prisma.j2EOutbox.findUnique({where:{id:job.id}});
        assert.equal(completed.status,'done');
        assert.equal(fs.existsSync(metadata.file),false);
        await storage.cleanup([{key:metadata.key,provider:'local'}]);
      }
      await prisma.asset.delete({where:{id:asset.id}});
    }
  } finally {await connect.disconnect();}
}
if(process.argv[2]==='child'){
  child(process.argv[3],process.argv[4],process.argv[5])
    .catch(error=>{console.error(error);process.exitCode=1;});
}else{
  main().catch(error=>{console.error(error);process.exitCode=1;});
}
