'use strict';
// Generated-app integration: two API instances, shared Mongo and S3, independent reconciler.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {S3Client,PutObjectCommand,HeadObjectCommand}=require('@aws-sdk/client-s3');
const db=require('./src/config/database');
const audit=require('./scripts/storage-reconcile');
const sleep=n=>new Promise(r=>setTimeout(r,n));
const base='http://127.0.0.1:3495',second='http://127.0.0.1:3497';
const mode=process.argv[2]||'parent';
const s3=new S3Client({region:process.env.AWS_REGION,endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,
  credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}});
const bucket=process.env.S3_BUCKET;
async function wait(test,label) {
  for(let i=0;i<300;i++){if(await test())return;await sleep(50);}
  throw new Error('Timeout: '+label);
}
function launch(args,env={}){
  const child=spawn(process.execPath,args,{cwd:process.cwd(),env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  let stderr='';
  child.stderr.on('data',chunk=>{stderr+=String(chunk);});
  child.stdout.on('data',()=>{});
  return {child,done:new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal,stderr})))};
}
async function has(key) {
  try{await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key}));return true;}
  catch(e){if(e.$metadata&&e.$metadata.httpStatusCode===404)return false;throw e;}
}
async function create(endpoint,label) {
  const form=new FormData();
  form.set('name',label);
  form.set('file',new Blob(['safe-upload-'+label],{type:'text/plain'}),label+'.txt');
  const res=await fetch(endpoint+'/api/assets',{method:'POST',body:form});
  if(res.status!==201)throw new Error('Upload failed: '+res.status+' '+await res.text());
  return res.json();
}
async function child(){
  await db();
  const realNow=Date.now;
  // Simulate age passage without waiting 24 hours; production cutoff is unchanged.
  Date.now=()=>realNow()+49*3600000;
  try{
    const all=await audit.inventory(['assets/files/'],new Date(Date.now()-24*3600000),1000);
    console.error('S3 chaos inventory',JSON.stringify({target:process.env.J2E_TARGET_KEY,listed:all.items.map(x=>x.key),scanned:all.scanned}));
    await audit.reconcile(audit.args(['--execute','--s3-verified-conditional-delete']),{
      async beforeCandidate(item){
        const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:item.key}));
        const unchanged=await audit.objectUnchanged(item,new Date(Date.now()-24*3600000));
        console.error('S3 chaos candidate',JSON.stringify({item,
          head:{etag:head.ETag,size:head.ContentLength,modifiedAt:head.LastModified?.toISOString()},
          unchanged}));
      },
      async beforeDelete(item) {
        if(item.key!==process.env.J2E_TARGET_KEY)return;
        fs.writeFileSync('.j2e-s3-chaos-ready','ready');
        await wait(()=>fs.existsSync('.j2e-s3-chaos-resume'),'parent release');
      }
    });
  }finally{Date.now=realNow;await db.disconnect();s3.destroy();}
}
async function parent(){
  const server=launch(['src/server.js'],{PORT:'3497',HOST:'127.0.0.1'});
  try{
    await wait(async()=>{try{return (await fetch(second+'/health')).ok;}catch{return false;}},'S3 API replica');
    const a=await create(base,'s3-first');
    const b=await create(second,'s3-second');
    assert.notEqual(a.file.key,b.file.key);
    assert.equal((await fetch(base+'/api/assets/'+(b._id||b.id))).status,200,'shared database');
    const oldKey=a.file.key.replace(/[^/]+$/,'orphan-dual-s3-'+process.pid+'.txt');
    await s3.send(new PutObjectCommand({Bucket:bucket,Key:oldKey,Body:'previously-orphaned',IfNoneMatch:'*'}));
    for(const marker of ['.j2e-s3-chaos-ready','.j2e-s3-chaos-resume'])fs.rmSync(marker,{force:true});
    const reconciler=launch([__filename,'reconcile'],{J2E_TARGET_KEY:oldKey});
    await Promise.race([
      wait(()=>fs.existsSync('.j2e-s3-chaos-ready'),'reconcile final-check barrier'),
      reconciler.done.then(result=>{throw new Error('Reconciler exited before barrier: '+JSON.stringify(result));})
    ]);
    const forged=new FormData();
    forged.set('name','reusing-an-existing-key');
    forged.set('file',oldKey);
    const denied=await fetch(second+'/api/assets',{method:'POST',body:forged});
    assert.equal(denied.status,400,'API must reject externally supplied object key');
    const fresh=await create(second,'S3-during-reconcile');
    assert.ok(await has(fresh.file.key),'new referenced S3 object exists');
    fs.writeFileSync('.j2e-s3-chaos-resume','go');
    const result=await reconciler.done;
    assert.equal(result.code,0,'reconciler failed: '+result.stderr);
    assert.equal(await has(oldKey),false,'conditional deletion removes orphan');
    assert.equal(await has(fresh.file.key),true,'new reference survives parallel reconciliation');
    console.log('Two real S3-backed API replicas and conditional reconciler passed');
  }finally{
    server.child.kill('SIGTERM');
    await Promise.race([server.done,sleep(3000)]);
    s3.destroy();
  }
}
if(mode==='reconcile')child().catch(error=>{console.error(error);process.exitCode=1;});
else parent().catch(error=>{console.error(error);process.exitCode=1;});
