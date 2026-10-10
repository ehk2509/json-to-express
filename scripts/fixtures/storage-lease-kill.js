'use strict';
// Copied into a generated app. Exercises cross-process DB lease ownership and SIGKILL expiry.
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const db=require('./src/config/database');
const lease=require('./src/config/storage-lease');

async function child() {
  await db();
  const token=await lease.acquire('killed-holder',1800);
  assert.ok(token,'child must acquire distributed reconciliation lease');
  process.kill(process.pid,'SIGKILL');
}
async function main(){
  await db();
  try{
    const childProcess=spawnSync(process.execPath,[__filename,'child'],{
      cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:30000
    });
    assert.equal(childProcess.signal,'SIGKILL','child must die by real SIGKILL: '+childProcess.stderr);
    const blocked=await lease.acquire('competing-process',1800);
    assert.equal(blocked,null,'second process must not take active lease');
    await new Promise(resolve=>setTimeout(resolve,2300));
    const recovered=await lease.acquire('new-holder',10000);
    assert.ok(recovered,'expired lease must recover after SIGKILL');
    assert.ok(recovered.generation>=2,'recovery must increase generation');
    const stale={owner:'killed-holder',generation:recovered.generation-1};
    assert.equal(await lease.valid(stale),false,'old holder must be fenced out');
    assert.equal(await lease.renew(stale,10000),false,'old holder cannot renew');
    await lease.release(stale);
    assert.equal(await lease.valid(recovered),true,'stale release must not revoke new lease');
    assert.equal(await lease.renew(recovered,10000),true);
    await lease.release(recovered);
    assert.equal(await lease.valid(recovered),false,'released token is invalid');
    console.log('Lease crash/reacquisition fencing checks passed');
  } finally {await db.disconnect();}
}
if(process.argv[2]==='child')child().catch(e=>{console.error(e);process.exitCode=1;});
else main().catch(e=>{console.error(e);process.exitCode=1;});
