'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const {normalizeSpec} = require('../src');
const {buildFiles} = require('../src/generators');

function makeSpec(database = 'mongodb', provider = 'local') {
  return normalizeSpec({
    specVersion: '1.0',
    app: {name: 'durable-storage', framework: 'fastify'},
    database: {type: database},
    storage: {enabled: true, provider},
    entities: {Asset: {fields: {
      name: {type: 'string', required: true},
      file: {type: 'file', upload: {mimeTypes: ['text/plain'], maxBytes: 1024}}
    }}}
  });
}

test('storage always provisions durable outbox, worker and safe reconcile CLI', () => {
  for (const database of ['mongodb', 'postgresql']) {
    for (const provider of ['local', 's3']) {
      const files = buildFiles(makeSpec(database, provider));
      const pkg = JSON.parse(files.get('package.json'));
      for (const name of ['worker', 'worker:once', 'storage:stats', 'storage:dead', 'storage:retry-dead', 'storage:reconcile']) {
        assert.ok(pkg.scripts[name], name);
      }
      const reconciliation = files.get('scripts/storage-reconcile.js');
      const storage = files.get('src/config/storage.js');
      const outbox = files.get('src/workflows/outbox.js');
      const worker = files.get('src/workflows/worker.js');
      assert.match(storage, /outbox.enqueueJob\("__j2e_storage_cleanup__"/);
      assert.match(storage, /await outbox.markDone\(record\)/);
      assert.match(storage, /await outbox.markFailed\(record, error\)/);
      assert.match(worker, /record.name === "__j2e_storage_cleanup__"/);
      assert.match(outbox, /async function storageStats\(\)/);
      assert.match(outbox, /async function retryDeadStorage\(\)/);
      assert.match(outbox, /async function storageDead\(limit = 20\)/);
      assert.match(outbox, /retryDeadStorage, storageDead, stats, storageStats\};/);
      assert.match(reconciliation, /function safePrefix\(prefix\)/);
      assert.match(reconciliation, /const referenced = await referencedKeys\(\)/);
      assert.match(reconciliation, /mode: options.execute \? 'execute' : 'dry-run'/);
      for (const source of [storage, outbox, worker, reconciliation]) new vm.Script(source);
      if (database === 'postgresql') assert.match(files.get('prisma/schema.prisma'), /model J2EOutbox/);
    }
  }
});

test('reconciliation rejects unsafe paths, young objects and unbounded scans', () => {
  const source = buildFiles(makeSpec()).get('scripts/storage-reconcile.js');
  const module = {exports: {}};
  const mockRequire = name => {
    if (name === 'dotenv') return {config() {}};
    if (name === 'node:fs/promises') return {};
    if (name === 'node:path') return path;
    return {};
  };
  vm.runInNewContext(source, {require: mockRequire, module, process: {argv: []}}, {filename: 'storage-reconcile.js'});
  const {args, safePrefix} = module.exports;
  assert.equal(args([]).execute, false);
  assert.equal(args(['--execute']).execute, true);
  assert.throws(() => args(['--older-than-hours', '1']), /minimum/);
  assert.throws(() => args(['--limit', '101']), /limit/);
  assert.throws(() => args(['--max-scan', '50001']), /max-scan/);
  for (const bad of ['', '.', '../private', '/etc/passwd']) assert.throws(() => safePrefix(bad));
  assert.equal(safePrefix('asset/file'), 'asset/file/');
});

test('post-commit deletion records intent before physical IO and releases failed jobs', async () => {
  const source = buildFiles(makeSpec()).get('src/config/storage.js');
  const events = [];
  const record = {id:'job1',attempts:0,maxAttempts:8};
  const outbox = {
    enqueueJob: async (name, payload, options) => {events.push('enqueue'); assert.equal(name,'__j2e_storage_cleanup__'); assert.equal(options.config.queue,'storage'); return {...record,payload};},
    markDone: async () => {events.push('done');},
    markFailed: async () => {events.push('failed');}
  };
  const stubRequire = name => {
    if (name === 'node:crypto') return require('node:crypto');
    if (name === 'node:path') return path;
    if (name === 'node:fs') return require('node:fs');
    if (name === 'node:fs/promises') return {...require('node:fs/promises'), unlink: async () => {events.push('unlink'); throw new Error('storage outage');}};
    if (name === 'multer') return Object.assign(() => ({}), {memoryStorage: () => ({})});
    if (name.endsWith('/outbox')) return outbox;
    throw new Error('Unexpected require: ' + name);
  };
  const module = {exports: {}};
  vm.runInNewContext(source, {module, require: stubRequire, process, console: {error() {}}, Buffer, setTimeout}, {filename:'storage.js'});
  const ok = await module.exports.cleanupAfterCommit([{key:'asset/file/test.txt',provider:'local'}]);
  assert.equal(ok,false);
  assert.equal(events[0],'enqueue');
  assert.equal(events.filter(x => x === 'unlink').length,3);
  assert.equal(events.at(-1),'failed');
});

test('storage observability includes queue backlog metrics and Prometheus alerts', () => {
  const raw={specVersion:'1.0',app:{name:'storage-alerts',framework:'fastify'},database:{type:'mongodb'},
    storage:{enabled:true,provider:'local'},observability:{enabled:true,metrics:{enabled:true,prefix:'svc_'}},
    entities:{Asset:{fields:{file:{type:'file',upload:{mimeTypes:['text/plain'],maxBytes:1024}}}}}};
  const files=buildFiles(normalizeSpec(raw));
  const alerts=files.get('deploy/prometheus/storage-cleanup-alerts.yml');
  const metrics=files.get('src/config/observability.js');
  assert.match(alerts,/svc_storage_cleanup_dead > 0/);
  assert.match(alerts,/svc_storage_cleanup_pending > 100/);
  assert.match(metrics,/storage_cleanup_dead/);
  assert.match(metrics,/storage_cleanup_pending/);
});

test('transactional storage cleanup inserts job through Prisma tx and Mongo session', async () => {
  for (const database of ['mongodb', 'postgresql']) {
    const source = buildFiles(makeSpec(database)).get('src/config/storage.js');
    const queued = [];
    const outbox = {
      enqueueJob: async (name, payload, options) => {
        queued.push({name, payload, options});
        return {payload, id:'intent', attempts:0, maxAttempts:8};
      },
      markDone:async () => {},
      markFailed:async () => {}
    };
    const dependencies = name => {
      if (name === 'node:crypto') return require('node:crypto');
      if (name === 'node:path') return path;
      if (name === 'node:fs') return require('node:fs');
      if (name === 'node:fs/promises') return require('node:fs/promises');
      if (name === 'multer') return Object.assign(() => ({}), {memoryStorage:() => ({})});
      if (name.endsWith('/outbox')) return outbox;
      throw new Error('Unexpected require ' + name);
    };
    const module={exports:{}};
    vm.runInNewContext(source,{module,require:dependencies,process,console,Buffer,setTimeout});
    const tx={transactionId:'active'};
    const pending=await module.exports.enqueueCleanupIntent([{key:'asset/file/old.txt',provider:'local'}],tx);
    assert.equal(queued.length,1);
    assert.equal(queued[0].name,'__j2e_storage_cleanup__');
    assert.equal(queued[0].options.config.queue,'storage');
    assert.equal(queued[0].options[database==='postgresql'?'db':'session'],tx);
    assert.equal(pending.payload.values[0].key,'asset/file/old.txt');
    assert.equal(await module.exports.enqueueCleanupIntent([],tx),null);
    assert.equal(queued.length,1);
  }
});

test('atomic cleanup planner only schedules unreferenced old fields', () => {
  const source=buildFiles(makeSpec()).get('src/config/storage.js');
  const module={exports:{}};
  const dependencies=name=>{
    if (name === 'node:crypto') return require('node:crypto');
    if (name === 'node:path') return path;
    if (name === 'node:fs') return require('node:fs');
    if (name === 'node:fs/promises') return require('node:fs/promises');
    if (name === 'multer') return Object.assign(() => ({}), {memoryStorage:() => ({})});
    if (name.endsWith('/outbox')) return {};
    throw new Error('Unexpected require '+name);
  };
  vm.runInNewContext(source,{module,require:dependencies,process,console,Buffer,setTimeout});
  const a={key:'asset/file/previous.txt',provider:'local'},b={key:'asset/file/current.txt',provider:'local'};
  assert.deepEqual(Array.from(module.exports.planReplaced('Asset',{file:a},{file:b})).map(x=>x.key),[a.key]);
  assert.equal(module.exports.planReplaced('Asset',{file:a},{name:'unchanged'}).length,0);
  assert.deepEqual(Array.from(module.exports.planEntity('Asset',{file:b})).map(x=>x.key),[b.key]);
});

test('Express PostgreSQL and MongoDB controllers use transactional cleanup intents', () => {
  for (const database of ['mongodb','postgresql']) {
    const raw = {
      specVersion:'1.0',app:{name:'legacy-atomic',framework:'express'},database:{type:database},
      storage:{enabled:true,provider:'local'},
      entities:{Asset:{
        fields:{name:{type:'string'},file:{type:'file',upload:{mimeTypes:['image/png'],maxBytes:1024}}},
        operations:{update:{transaction:true},delete:{transaction:true}}
      }}
    };
    const files=buildFiles(normalizeSpec(raw));
    const source=files.get('src/controllers/AssetController.js');
    assert.match(source,/storage.enqueueCleanupIntent\(storage.planReplaced/);
    assert.match(source,/storage.enqueueCleanupIntent\(storage.planEntity/);
    assert.match(source,/storage.finishCleanupIntent/);
    assert.match(source,/withTransaction\(/);
    if (database === 'mongodb') assert.match(source,/mongoCanTransact\(\)/);
    new vm.Script(source);
  }
});

test('recursive delete planners collect file references from cascaded descendants', () => {
  for(const database of ['mongodb','postgresql']) {
    const spec=normalizeSpec({
      specVersion:'1.0',app:{name:'cascade-intents',framework:'fastify'},
      database:{type:database},storage:{enabled:true,provider:'local'},
      entities:{
        Parent:{fields:{title:{type:'string'}},softDelete:{enabled:true}},
        Child:{fields:{parent:{type:'reference',ref:'Parent',onDelete:'cascade'},
          attachment:{type:'file',upload:{mimeTypes:['image/png'],maxBytes:1024}}}}
      }
    });
    const files=buildFiles(spec);
    const planner=files.get(database==='mongodb'?'src/fastify-mongo-delete.js':'src/fastify-postgres-delete.js');
    const crud=files.get('src/fastify-crud.js');
    assert.match(planner,/fileFields/);
    assert.match(planner,/values.push/);
    assert.match(planner,/return values/);
    assert.match(crud,/storage.enqueueCleanupIntent\(affected, (session|tx)\)/);
    new vm.Script(planner);
  }
});


test('reconcile rechecks each candidate after a writer races in and refuses changed files', async () => {
  const source = buildFiles(makeSpec()).get('scripts/storage-reconcile.js');
  const now = new Date();
  const old = new Date(now.getTime() - 49*3600000);
  const names=['referenced.txt','changed.txt','orphan.txt'];
  const rows=[];
  const removed=[];
  const modified=new Set();
  const root=path.resolve(process.cwd(), 'uploads');
  const fakeFs={
    readdir:async folder => folder===path.join(root,'asset','file')
      ? names.map(name=>({name,isDirectory:()=>false,isFile:()=>true})) : [],
    stat:async()=>({mtime:old,size:7,ino:42}),
    lstat:async file=>({isFile:()=>true,mtime:modified.has(path.basename(file))?now:old,size:7,ino:42})
  };
  const model={find:()=>({lean:()=>({cursor:async function*(){yield* rows;}})})};
  const connect=async()=>{}; connect.disconnect=async()=>{};
  const mod={exports:{}};
  const fakeRequire=name=>{
    if(name==='dotenv')return {config(){}};
    if(name==='node:path')return path;
    if(name==='node:fs/promises')return fakeFs;
    if(name.includes('database'))return connect;
    if(name.includes('storage'))return {cleanup:async values=>removed.push(...values.map(v=>v.key))};
    return model;
  };
  vm.runInNewContext(source,{module:mod,require:fakeRequire,process:{argv:[],cwd:()=>process.cwd()},Date});
  const report=await mod.exports.reconcile(mod.exports.args(['--execute']),{
    async beforeCandidate(item){
      if(item.key.endsWith('/referenced.txt')) rows.push({file:{key:item.key}});
      if(item.key.endsWith('/changed.txt')) modified.add('changed.txt');
    }
  });
  assert.equal(report.removed,1);
  assert.equal(report.skippedReferenced,1);
  assert.equal(report.skippedModified,1);
  assert.deepEqual(removed,['asset/file/orphan.txt']);
});

test('reconciliation holds configured prefix and per-object age guards', () => {
  const generated=buildFiles(makeSpec()).get('scripts/storage-reconcile.js');
  assert.match(generated,/fs\.lstat\(target\)/);
  assert.match(generated,/currentReferences = await referencedKeys\(\)/);
  assert.match(generated,/HeadObjectCommand/);
  assert.match(generated,/cursor: \{id: cursor\}/);
  assert.match(generated,/skippedReferenced/);
  assert.match(generated,/skippedModified/);
  new vm.Script(generated);
});
