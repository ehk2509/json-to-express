'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {planDrift,digest}=require('./migration-intelligence');
const {localRequire,localBinary,run,requireEnv,expectedPostgres,inspectPostgres,
  expectedMongo,inspectMongo,planMongo,normalizeSpec}=require('./db-introspection');

function sha(value) {return crypto.createHash('sha256').update(value).digest('hex');}
function shaFile(filename) {
  const hash=crypto.createHash('sha256'),fd=fs.openSync(filename,'r');
  const buffer=Buffer.allocUnsafe(1024*1024);
  try {let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null))>0)
    hash.update(buffer.subarray(0,size));}
  finally {fs.closeSync(fd);}
  return hash.digest('hex');
}
function readJson(filename) {return JSON.parse(fs.readFileSync(filename,'utf8'));}
function writeExclusive(filename, value) {
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  fs.writeFileSync(filename,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',
    {flag:'wx',mode:0o600});
}
function parseOptions(args) {
  const [action,specPath,...rest]=args;
  if (!['inspect','plan','status','apply','rollback'].includes(action) || !specPath || specPath.startsWith('-'))
    throw new Error('Usage: j2e db inspect|plan|status|apply|rollback <spec.json> --output <dir> [options]');
  const options={action,specPath:path.resolve(specPath)};
  for(let i=0;i<rest.length;i++) {
    const key=rest[i];
    if (!['--output','--plan','--backup','--approve','--allow-destructive','--allow-review'].includes(key))
      throw new Error('Unknown database migration option: '+key);
    if (key==='--allow-destructive'||key==='--allow-review') {
      if(options[key]) throw new Error('Duplicate option: '+key);
      options[key]=true;
    } else {
      if (options[key]!==undefined||!rest[i+1]||rest[i+1].startsWith('--'))
        throw new Error(key+' requires exactly one value');
      options[key]=rest[++i];
    }
  }
  if(!options['--output']) throw new Error('Database migration requires --output <generated-app>');
  options.output=path.resolve(options['--output']);
  options.planPath=path.resolve(options['--plan']||path.join(options.output,'.j2e-db-plan.json'));
  if(['apply','rollback'].includes(action) && !options['--approve'])
    throw new Error('Explicit --approve <plan hash> is required');
  return options;
}
function loadSpec(options) {
  const raw=readJson(options.specPath);
  if(!raw.database || !['postgresql','mongodb'].includes(raw.database.type))
    throw new Error('P7 database migrations require PostgreSQL or MongoDB');
  return normalizeSpec(raw);
}
function analyzeSql(sql) {
  const steps=[];
  for(const raw of sql.replace(/^\s*--[^\n]*$/gm,'').split(';')) {
    const statement=raw.trim();
    if(!statement)continue;
    let risk='manual',undo=null;
    let match;
    if((match=/^CREATE TABLE\s+("(?:[^"]|"")+"|[a-zA-Z_][\w]*)\s*\(/i.exec(statement))) {
      risk='review';undo='DROP TABLE IF EXISTS '+match[1]+';';
    } else if((match=/^CREATE\s+(UNIQUE\s+)?INDEX\s+("(?:[^"]|"")+"|[a-zA-Z_][\w]*)\s+ON\s+/i.exec(statement))) {
      risk=match[1]?'review':'low';undo='DROP INDEX IF EXISTS '+match[2]+';';
    } else if((match=/^ALTER TABLE\s+("(?:[^"]|"")+"|[\w]+)\s+ADD COLUMN\s+("(?:[^"]|"")+"|[\w]+)\s+/i.exec(statement))) {
      risk=/\bNOT NULL\b/i.test(statement)?'review':'low';
      undo='ALTER TABLE '+match[1]+' DROP COLUMN IF EXISTS '+match[2]+';';
    } else if(/\bDROP\b|\bTRUNCATE\b/i.test(statement)) {
      risk='destructive';
    }
    steps.push({action:'sql',statement:statement+';',risk,undo});
  }
  return steps;
}
async function inspect(spec,output) {
  if(spec.database.type==='postgresql') return inspectPostgres(spec,output);
  return inspectMongo(spec,output);
}
async function buildPlan(spec,output) {
  const live=await inspect(spec,output);
  let steps, comparison;
  if(spec.database.type==='postgresql') {
    steps=analyzeSql(live.sql);
    const desired=expectedPostgres(spec);
    // Entity-level drift view is advisory; Prisma's full SQL diff drives deployment.
    const knownTables={};
    for(const table of Object.keys(desired.tables))
      if(live.schema.tables[table])knownTables[table]=live.schema.tables[table];
    comparison=planDrift(desired,{tables:knownTables});
  } else {
    comparison={changes:planMongo(expectedMongo(spec,output),live.schema)};
    steps=comparison.changes.filter(step=>step.action==='create-index'||step.action==='create-collection');
  }
  const plan={
    version:1,engine:spec.database.type,output:path.resolve(output),
    specFingerprint:digest(spec),liveFingerprint:live.fingerprint,
    changes:comparison.changes,steps,
    sql:spec.database.type==='postgresql'?live.sql:undefined,
    // Plans are intentionally limited to supported DDL. Unsupported statements
    // never become executable with --allow-destructive.
    requiresManual:steps.some(s=>s.risk==='manual'),
    requiresReview:steps.some(s=>s.risk==='review'),
    requiresDestructive:steps.some(s=>s.risk==='destructive')
  };
  return {...plan,hash:digest(plan)};
}
function assertPlan(plan, options, spec) {
  const {hash,...unsigned}=plan;
  if(!hash || digest(unsigned)!==hash)throw new Error('Migration plan checksum mismatch');
  if(plan.version!==1 || plan.engine!==spec.database.type ||
      plan.output!==options.output || plan.specFingerprint!==digest(spec))
    throw new Error('Migration plan target or specification changed');
  if(options['--approve']!==hash)throw new Error('Approval hash does not match reviewed migration plan');
  if(plan.requiresManual)throw new Error('Unsupported/manual migration detected: handle outside automated apply');
  if(plan.requiresDestructive && !options['--allow-destructive'])
    throw new Error('Destructive changes require --allow-destructive and an audited backup');
  if(plan.requiresReview && !options['--allow-review'])
    throw new Error('Reviewed changes require --allow-review');
}
function backupEnvironment(uri, engine) {
  if(engine!=='postgresql')return process.env;
  const url=new URL(uri);
  const env={...process.env, PGHOST:decodeURIComponent(url.hostname),
    PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),
    PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1))};
  if(url.searchParams.has('sslmode')) env.PGSSLMODE=url.searchParams.get('sslmode');
  return env;
}
function backupDatabase(spec,options,plan) {
  const filename=path.resolve(options['--backup']||path.join(options.output,
    '..',path.basename(options.output)+'.j2e-backups','j2e-'+plan.hash.slice(0,14)+(plan.engine==='postgresql'?'.dump':'.archive')));
  if(fs.existsSync(filename)||fs.existsSync(filename+'.j2e.json'))
    throw new Error('Backup already exists: '+filename);
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const tmp=filename+'.part-'+process.pid;
  if(fs.existsSync(tmp))throw new Error('Temporary backup already exists');
  let config=null;
  try {
    const uri=requireEnv(spec);
    if(plan.engine==='postgresql') {
      run('pg_dump',['--format=custom','--no-owner','--no-acl','--file',tmp],
        {env:backupEnvironment(uri,'postgresql'),timeout:300000});
    } else {
      const dir=fs.mkdtempSync(path.join(os.tmpdir(),'j2e-db-backup-'));
      config=path.join(dir,'config.yaml');
      // Pass credentials via a short-lived 0600 config, not process arguments.
      fs.writeFileSync(config,'uri: '+JSON.stringify(uri)+'\n',{mode:0o600});
      run('mongodump',['--config',config,'--archive='+tmp],
        {timeout:300000});
    }
    if(!fs.existsSync(tmp)||!fs.statSync(tmp).size)
      throw new Error('Database backup was empty');
    fs.chmodSync(tmp,0o600);
    const receipt={version:1,engine:plan.engine,planHash:plan.hash,
      bytes:fs.statSync(tmp).size,sha256:shaFile(tmp),
      createdAt:new Date().toISOString()};
    fs.renameSync(tmp,filename);
    writeExclusive(filename+'.j2e.json',receipt);
    return {filename,receipt};
  } finally {
    if(fs.existsSync(tmp))fs.rmSync(tmp,{force:true});
    if(config)fs.rmSync(path.dirname(config),{recursive:true,force:true});
  }
}
function verifyBackup(filename,plan) {
  const receipt=readJson(filename+'.j2e.json');
  if(receipt.version!==1||receipt.planHash!==plan.hash||receipt.engine!==plan.engine||
      receipt.sha256!==shaFile(filename) ||
      receipt.bytes!==fs.statSync(filename).size)
    throw new Error('Backup integrity verification failed');
  return receipt;
}
function acquireLocalLock(output) {
  const file=path.join(output,'.j2e-db-migration.lock');
  const fd=fs.openSync(file,'wx',0o600);
  fs.writeFileSync(fd,JSON.stringify({pid:process.pid,host:os.hostname()})+'\n');
  return ()=>{fs.closeSync(fd);fs.rmSync(file,{force:true});};
}
async function applyPostgres(spec,options,plan,backup) {
  // Prisma Migrate owns PostgreSQL migration history and its advisory lock.
  // SQL goes into Prisma's versioned migration directory, never executed ad hoc.
  const schemaDir=path.dirname(path.resolve(options.output,spec.database.prisma.schemaPath));
  const migrations=path.join(schemaDir,'migrations');
  const verifier=path.join(options.output,'scripts','verify-migration-history.js');
  run(process.execPath,[verifier],{cwd:options.output});
  run(localBinary(options.output,'prisma'),
    ['migrate','status','--schema',spec.database.prisma.schemaPath],{cwd:options.output});
  if(!fs.existsSync(path.join(migrations,'migration_lock.toml')))
    throw new Error('Initialize and deploy Prisma migrations before P7 apply');
  const dirname=new Date().toISOString().replace(/\D/g,'').slice(0,14)+'_j2e_'+plan.hash.slice(0,8);
  const dest=path.join(migrations,dirname);
  let made=false;
  try {
    fs.mkdirSync(dest);made=true;
    writeExclusive(path.join(dest,'migration.sql'),plan.sql);
    // Record an independently reviewable inverse, but never run it automatically
    // because dropping new tables/columns may discard data created since apply.
    const undo=plan.steps.map(s=>s.undo).filter(Boolean).reverse();
    if(undo.length===plan.steps.length)
      writeExclusive(path.join(dest,'rollback.review.sql'),undo.join('\n')+'\n');
    run(localBinary(options.output,'prisma'),
      ['migrate','deploy','--schema',spec.database.prisma.schemaPath],
      {cwd:options.output,timeout:300000});
    run(process.execPath,[verifier,'--record'],{cwd:options.output});
    return {migration:dirname,backup:backup.filename,
      rollback:'Restore verified backup to an isolated database, then perform a reviewed cutover.'};
  } catch(error) {
    if(made) {
      // A failed deployment may have partially committed. Preserve SQL and
      // backup for inspection; do not silently remove migration files.
      error.message+=' (migration kept at '+dest+'; backup: '+backup.filename+')';
    }
    throw error;
  }
}
async function withMongoLock(db,fn) {
  const collection=db.collection('_j2e_migration_lock');
  const token=crypto.randomUUID();
  try {
    await collection.insertOne({_id:'schema',token,createdAt:new Date()});
  } catch(error) {
    if(error.code===11000)throw new Error('Another MongoDB migration lock exists; manual inspection required');
    throw error;
  }
  try{return await fn();}
  finally{await collection.deleteOne({_id:'schema',token});}
}
async function applyMongo(spec,options,plan,backup) {
  const mongoose=localRequire(options.output)('mongoose');
  await mongoose.connect(requireEnv(spec));
  try{
    return await withMongoLock(mongoose.connection.db,async()=>{
      const executed=[];
      try{
        for(const step of plan.steps) {
          if(step.action==='create-collection') {
            await mongoose.connection.db.createCollection(step.collection);
            executed.push(step);
          } else if(step.action==='create-index') {
            await mongoose.connection.db.collection(step.collection).createIndex(
              step.index.keys,step.index.options);
            executed.push(step);
          } else throw new Error('Unsupported MongoDB change: '+step.action);
        }
        await mongoose.connection.db.collection('_j2e_migration_history').insertOne({
          _id:plan.hash,appliedAt:new Date(),backup:backup.filename,steps:executed});
        return {migration:plan.hash,backup:backup.filename};
      }catch(error){
        error.message+=' (backup retained at '+backup.filename+
          '; inspect database state before retrying)';
        throw error;
      }
    });
  }finally{await mongoose.disconnect();}
}
async function rollbackMongo(spec,options,plan) {
  const filename=path.resolve(options['--backup']||path.join(options.output,'backups',
    '..',path.basename(options.output)+'.j2e-backups','j2e-'+plan.hash.slice(0,14)+'.archive'));
  verifyBackup(filename,plan);
  const mongoose=localRequire(options.output)('mongoose');
  await mongoose.connect(requireEnv(spec));
  try{
    return await withMongoLock(mongoose.connection.db,async()=>{
      const history=mongoose.connection.db.collection('_j2e_migration_history');
      const record=await history.findOne({_id:plan.hash});
      if(!record)throw new Error('Migration history not found');
      for(const step of [...record.steps].reverse()) {
        if(step.action==='create-index') {
          const indexes=await mongoose.connection.db.collection(step.collection).indexes();
          const found=indexes.find(index=>digest({keys:index.key,options:
            Object.fromEntries(['unique','sparse','expireAfterSeconds','partialFilterExpression','collation']
              .filter(k=>index[k]!==undefined).map(k=>[k,index[k]]))})===digest(step.index));
          if(!found)throw new Error('Applied index changed; manual recovery required');
          await mongoose.connection.db.collection(step.collection).dropIndex(found.name);
        }else if(step.action==='create-collection'){
          const count=await mongoose.connection.db.collection(step.collection).countDocuments({}, {limit:1});
          if(count)throw new Error('Collection now contains data; refusing destructive rollback');
          await mongoose.connection.db.dropCollection(step.collection);
        }
      }
      await history.deleteOne({_id:plan.hash});
      return {status:'rolled-back',migration:plan.hash};
    });
  }finally{await mongoose.disconnect();}
}
async function executeDb(args) {
  const options=parseOptions(args);
  const spec=loadSpec(options);
  if(options.action==='inspect') {
    const current=await inspect(spec,options.output);
    delete current.sql;
    return current;
  }
  if(options.action==='plan'||options.action==='status') {
    const plan=await buildPlan(spec,options.output);
    if(options.action==='plan')writeExclusive(options.planPath,plan);
    return options.action==='plan'?{plan:options.planPath,...plan}:plan;
  }
  const saved=readJson(options.planPath);
  assertPlan(saved,options,spec);
  const unlock=acquireLocalLock(options.output);
  try {
    if(options.action==='rollback') {
      if(spec.database.type!=='mongodb')
        throw new Error('PostgreSQL rollback requires reviewed restoration from backup; Prisma has no automatic down migrations');
      return await rollbackMongo(spec,options,saved);
    }
    const current=await buildPlan(spec,options.output);
    if(current.hash!==saved.hash)throw new Error('Live schema drifted since plan review; generate a fresh plan');
    if(!saved.steps.length)return {status:'no-changes'};
    const backup=backupDatabase(spec,options,saved);
    verifyBackup(backup.filename,saved);
    return spec.database.type==='postgresql'
      ?applyPostgres(spec,options,saved,backup)
      :applyMongo(spec,options,saved,backup);
  }finally{unlock();}
}
module.exports={executeDb,parseOptions,analyzeSql,buildPlan,assertPlan,backupDatabase,verifyBackup};
