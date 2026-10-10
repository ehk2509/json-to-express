'use strict';
// Real OS-kill after storage deletion, before outbox markDone.
// Run inside a generated MongoDB project with storage enabled.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync,execFileSync}=require('node:child_process');
const db=require('./src/config/database');
const outbox=require('./src/workflows/outbox');
const storage=require('./src/config/storage');
const worker=require('./src/workflows/worker');
const provider=process.argv[2] || 'local';
const key='assets/files/reclaim-after-worker-kill-'+provider+'.txt';

async function exists() {
  if(provider==='local')return fs.existsSync(path.resolve('uploaded-files',key));
  const {S3Client,HeadObjectCommand}=require('@aws-sdk/client-s3');
  const c=new S3Client({region:process.env.AWS_REGION,endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,
    credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}});
  try {await c.send(new HeadObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));return true;}
  catch(e) {if(e.$metadata&&e.$metadata.httpStatusCode===404)return false;throw e;}
  finally{c.destroy();}
}
async function put() {
  if(provider==='local') {
    const target=path.resolve('uploaded-files',key);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,'physical-delete');
  } else {
    const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
    const c=new S3Client({region:process.env.AWS_REGION,endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,
      credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}});
    try{await c.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:'physical-delete'}));}
    finally{c.destroy();}
  }
}
async function child() {
  process.env.J2E_WORKER_QUEUES='storage';
  await db();
  // Kill only after physical deletion succeeds, before marking the outbox item done.
  outbox.markDone=async()=>process.kill(process.pid,'SIGKILL');
  await worker.processBatch();
  throw new Error('Expected SIGKILL between physical deletion and outbox acknowledgement');
}
async function main() {
  await db();
  try {
    await put();
    const job=await outbox.enqueueJob('__j2e_storage_cleanup__',{
      values:[{key,provider}]
    },{config:{queue:'storage',maxAttempts:5,backoffMs:10}});
    const killed=spawnSync(process.execPath,[__filename,provider,'child'],{
      cwd:process.cwd(),env:{...process.env,J2E_WORKER_QUEUES:'storage'},encoding:'utf8',timeout:45000
    });
    assert.equal(killed.signal,'SIGKILL','expect real SIGKILL after delete: '+killed.stderr);
    assert.equal(await exists(),false,'physical object must already have been deleted');
    const claimed=await outbox.Outbox.findById(job._id);
    assert.equal(claimed.status,'processing','job acknowledgement interrupted');
    // Simulate lock lease expiry before worker restart, not sleeping for a full production timeout.
    await outbox.Outbox.updateOne({_id:job._id},{$set:{lockedAt:new Date(0)}});
    execFileSync(process.execPath,['src/workflows/worker.js','--once'],{
      cwd:process.cwd(),env:{...process.env,J2E_WORKER_QUEUES:'storage'},timeout:45000
    });
    const done=await outbox.Outbox.findById(job._id);
    assert.equal(done.status,'done','stale claim recovered and idempotently completed');
    assert.equal(await exists(),false,'repeat delete does not resurrect object');
  } finally {await db.disconnect();}
}
if(process.argv[3]==='child')child().catch(e=>{console.error(e);process.exitCode=1;});
else main().catch(e=>{console.error(e);process.exitCode=1;});
