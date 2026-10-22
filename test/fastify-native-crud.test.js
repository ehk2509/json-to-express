'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {normalizeSpec} = require('../src');
const {buildFiles} = require('../src/generators');

function spec(database = 'mongodb') {
  return {
    specVersion: '1.0',
    app: {name: 'native-fastify-crud', framework: 'fastify'},
    database: {type: database},
    entities: {Todo: {fields: {title: {type: 'string', required: true}}}}
  };
}

test('native Fastify CRUD is generated and registered for simple Mongo entities', () => {
  const files = buildFiles(normalizeSpec(spec()));
  const source = files.get('src/fastify-crud.js');
  assert.ok(source);
  assert.match(source, /fastify.route/);
  assert.match(source, /model.findOneAndUpdate/);
  assert.match(files.get('src/app.js'), /register1\(fastify\)/);
  assert.doesNotMatch(files.get('src/server.js'), /fastifyExpress/);
  new vm.Script(source);
});

test('Prisma variant uses native Prisma methods', () => {
  const files = buildFiles(normalizeSpec(spec('postgresql')));
  const source = files.get('src/fastify-crud.js');
  assert.match(source, /model.findMany/);
  assert.match(source, /connectDatabase.client/);
  new vm.Script(source);
});

test('Mongo relational entity receives native handlers', () => {
  const input = spec();
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User'};
  input.entities.User = {fields: {name: {type: 'string'}}};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /"name":"Todo"/);
});

test('native Fastify CRUD honors API key authentication and RBAC without Express controller middleware', () => {
  const input = spec();
  input.auth = {enabled: true, strategies: ['apiKey'], apiKey: {header: 'x-api-key', keys: [
    {env: 'TEST_ADMIN_KEY', userId: 'admin', roles: ['admin']},
    {env: 'TEST_VIEWER_KEY', userId: 'viewer', roles: ['viewer']}
  ]}};
  input.entities.Todo.operations = {
    list: {auth: {required: true, strategies: ['apiKey'], roles: ['viewer']}},
    create: {auth: {required: true, strategies: ['apiKey'], roles: ['admin']}}
  };
  const files = buildFiles(normalizeSpec(input));
  const source = files.get('src/fastify-crud.js');
  assert.match(source, /auth.readAuth\(request.raw, op.auth\)/);
  assert.match(source, /request.raw.auth/);
  assert.match(source, /model.findOneAndUpdate/);
  new vm.Script(source);
});

test('read-only relational entity uses native Fastify routes without mutation semantics', () => {
  const input = spec('postgresql');
  input.entities.User = {fields: {name: {type: 'string'}}};
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User'};
  input.entities.Todo.operations = {create: false, update: false, delete: false};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /"name":"Todo"/);
  assert.match(source, /model.findMany/);
  assert.match(source, /model.findFirst/);
  new vm.Script(source);
});

test('mutating MongoDB relational entity uses native routes', () => {
  const input = spec('mongodb');
  input.entities.User = {fields: {name: {type: 'string'}}};
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User'};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /"name":"Todo"/);
});

test('relational entity with populate uses native Fastify when read-only', () => {
  const input = spec('mongodb');
  input.entities.User = {fields: {name: {type: 'string'}}};
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User'};
  input.entities.Todo.operations = {create: false, update: false, delete: false, list: {populate: ['owner']}};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /"name":"Todo"/);
});

test('native Prisma create and update transform single relation IDs safely', () => {
  const input = spec('postgresql');
  input.entities.User = {fields: {name: {type: 'string'}}};
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User'};
  input.entities.Todo.operations = {delete: false};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /"name":"Todo"/);
  assert.match(source, /writeData\(entry, data, "create"\)/);
  assert.match(source, /writeData\(entry, data, "update"\)/);
  assert.match(source, /connect: \{id: reference\}/);
  new vm.Script(source);
});

test('native Prisma delete respects FK restriction handling', () => {
  const input = spec('postgresql');
  input.entities.User = {fields: {name: {type: 'string'}}};
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User'};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /"name":"Todo"/);
  assert.match(source, /"name":"User"/);
  assert.match(source, /P2003/);
  assert.match(source, /Delete restricted by related records/);
  new vm.Script(source);
});

test('native Prisma delete supports inbound many-to-many relations', () => {
  const input = spec('postgresql');
  input.entities.User = {fields: {name: {type: 'string'}}};
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User', many: true};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /"name":"User"/);
});

test('native Fastify local storage routes use multipart parser and cleanup', () => {
  const input = spec('mongodb');
  input.entities.Todo.fields.photo = {type: 'file', upload: {mimeTypes: ['image/png'], maxBytes: 1024}};
  input.storage = {enabled: true, provider: 'local'};
  const files = buildFiles(normalizeSpec(input));
  const native = files.get('src/fastify-crud.js');
  assert.match(native, /storage.parseFastifyMultipart/);
  assert.match(native, /storage.cleanupReplaced/);
  assert.match(native, /storage.enqueueCleanupIntent\(affected/);
  assert.match(files.get('src/app.js'), /@fastify\/multipart/);
  assert.ok(JSON.parse(files.get('package.json')).dependencies['@fastify/multipart']);
  assert.match(files.get('src/config/storage.js'), /async function parseFastifyMultipart/);
  new vm.Script(native);
  new vm.Script(files.get('src/config/storage.js'));
});

test('native Fastify cache reuses shared key/version engine and invalidates mutations', () => {
  const input = spec('mongodb');
  input.cache = {enabled: true, provider: 'memory'};
  input.entities.Todo.operations = {list: {cache: {enabled: true, ttlSeconds: 120}}, get: {cache: {enabled: true, ttlSeconds: 120}}};
  const files = buildFiles(normalizeSpec(input));
  const native = files.get('src/fastify-crud.js');
  const cacheSource = files.get('src/config/cache.js');
  assert.match(native, /cache.nativeRead/);
  assert.match(native, /cache.nativeWrite/);
  assert.match(native, /cache.invalidateEntity/);
  assert.match(cacheSource, /async function nativeRead/);
  assert.match(cacheSource, /async function nativeWrite/);
  new vm.Script(native);
  new vm.Script(cacheSource);
});

test('native signed local downloads use authenticated token path', () => {
  const input = spec('mongodb');
  input.storage = {enabled:true, provider:'local', signedUrls:{enabled:true}};
  input.entities.Todo.fields.photo = {type:'file',upload:{mimeTypes:['image/png'],maxBytes:1024}};
  const files = buildFiles(normalizeSpec(input));
  assert.match(files.get('src/fastify-native.js'), /storage.fastifyDownload/);
  assert.match(files.get('src/config/storage.js'), /verifyLocalToken\(request.params.token\)/);
  new vm.Script(files.get('src/fastify-native.js'));
});

test('MongoDB native Fastify supports transactional create, update and soft delete with audit fields', () => {
  const input = spec('mongodb');
  input.entities.Todo.softDelete = {enabled: true, field: 'deletedAt'};
  input.entities.Todo.audit = {enabled: true, createdBy: 'createdBy', updatedBy: 'updatedBy'};
  input.entities.Todo.operations = {create: {transaction: true}, update: {transaction: true}, delete: {transaction: true}};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /mongoose.startSession/);
  assert.match(source, /session.withTransaction/);
  assert.match(source, /liveFilter\(entry/);
  assert.match(source, /entry.audit.createdBy/);
  assert.match(source, /entry.audit.updatedBy/);
  assert.match(source, /entry.softDelete.field/);
  new vm.Script(source);
});

test('native Mongo deletion generates transactional inbound restrict, nullify and cascade rules', () => {
  const input = spec('mongodb');
  input.entities.Reviewer = {fields: {name:{type:'string'}, todo:{type:'reference',ref:'Todo',onDelete:'restrict'}}};
  input.entities.Watcher = {fields: {todo:{type:'reference',ref:'Todo',onDelete:'nullify'}}};
  input.entities.Archive = {fields: {todo:{type:'reference',ref:'Todo',onDelete:'cascade'}}};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /"onDelete":"restrict"/);
  assert.match(source, /"onDelete":"nullify"/);
  assert.match(source, /"onDelete":"cascade"/);
  const planner = buildFiles(normalizeSpec(input)).get('src/fastify-mongo-delete.js');
  assert.match(planner, /child.countDocuments/);
  assert.match(planner, /child.updateMany/);
  assert.match(planner, /await remove\(relation.model, dependent._id/);
  assert.match(source, /mongoDelete\(relationModels, entry.name, id, session\)/);
  assert.match(source, /entry.inbound.length > 0/);
  new vm.Script(planner);
  new vm.Script(source);
});

test('Mongo native Fastify generates lifecycle hooks alongside audit, soft-delete and transactions', () => {
  const input = spec('mongodb');
  input.entities.Todo.audit = {enabled:true};
  input.entities.Todo.softDelete = {enabled:true};
  input.entities.Todo.hooks = {module:'./hooks/todo.js', before:{create:'onCreate'}, after:{delete:'onDelete'}};
  input.entities.Todo.operations = {delete:{transaction:true}};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source,/hookModules/);
  assert.match(source,/callHook\(entry, "before"/);
  assert.match(source,/callHook\(entry, "after"/);
  assert.match(source,/session.withTransaction/);
  assert.match(source,/liveFilter/);
  new vm.Script(source);
});

test('simple Fastify generators run without Express runtime dependencies', () => {
  for (const database of ['mongodb', 'postgresql']) {
    const files = buildFiles(normalizeSpec(spec(database)));
    const pkg = JSON.parse(files.get('package.json'));
    assert.ok(pkg.dependencies.fastify);
    assert.equal(pkg.dependencies.express, undefined);
    assert.equal(pkg.dependencies['@fastify/express'], undefined);
    assert.equal(pkg.devDependencies.supertest, undefined);
    assert.doesNotMatch(files.get('src/server.js'), /fastify\.use\(/);
    assert.doesNotMatch(files.get('src/app.js'), /require\('express'\)/);
    assert.equal([...files.keys()].some(name => /\/routes\//.test(name)),false);
    assert.match(files.get('src/app.js'), /module\.exports = fastify/);
    assert.match(files.get('test/contract.test.js'), /app\.inject/);
    assert.doesNotMatch(files.get('test/contract.test.js'), /supertest/);
    new vm.Script(files.get('src/server.js'));
    new vm.Script(files.get('src/app.js'));
  }
});

test('PostgreSQL many-to-many deletes can use native Fastify', () => {
  const input = spec('postgresql');
  input.entities.Todo.fields.owner = {type:'reference', ref:'User', many:true};
  input.entities.User = {fields:{name:{type:'string'}}};
  const files = buildFiles(normalizeSpec(input));
  assert.doesNotMatch(files.get('src/server.js'), /fastifyExpress/);
  assert.equal(JSON.parse(files.get('package.json')).dependencies['@fastify/express'],undefined);
  assert.match(files.get('src/fastify-postgres-delete.js'), /relation.many/);
});

test('stateless API-key authorization and Redis caching remain adapter-free', () => {
  const input = spec();
  input.auth = {enabled: true, strategies: ['apiKey'], apiKey: {keys: [
    {env: 'NATIVE_API_KEY', userId:'test', roles:['writer']}
  ]}};
  input.cache = {enabled:true, provider:'redis'};
  input.entities.Todo.operations = {
    get: {auth:{required:true,strategies:['apiKey']},cache:{enabled:true,ttlSeconds:30}}
  };
  const files = buildFiles(normalizeSpec(input));
  const pkg = JSON.parse(files.get('package.json'));
  assert.equal(pkg.dependencies.express, undefined);
  assert.equal(pkg.dependencies['@fastify/express'], undefined);
  assert.ok(pkg.dependencies.redis);
  assert.match(files.get('src/fastify-crud.js'), /auth.readAuth/);
  assert.match(files.get('src/fastify-crud.js'), /cache.nativeRead/);
  assert.doesNotMatch(files.get('src/server.js'), /fastifyExpress/);
});

test('native auth endpoints and GraphQL workflows can run without Express adapter', () => {
  const input = spec();
  input.auth = {
    enabled:true,strategies:['jwt'],
    jwt:{secretEnv:'TEST_NATIVE_JWT'},
    local:{enabled:true,allowRegistration:true}
  };
  input.api = {graphql:{enabled:true}};
  input.workflows = {ping:{steps:[{name:'response',action:'respond',body:{ok:true}}]}};
  input.endpoints = {ping:{method:'post',path:'/ping',workflow:'ping'}};
  const files=buildFiles(normalizeSpec(input));
  const pkg=JSON.parse(files.get('package.json'));
  assert.equal(pkg.dependencies.express,undefined);
  assert.equal(pkg.dependencies['@fastify/express'],undefined);
  assert.match(files.get('src/app.js'), /register3\(fastify\)/);
  assert.match(files.get('src/fastify-auth.js'), /fastify.post/);
  assert.match(files.get('src/fastify-native.js'), /graphqlApi.fastifyHandler/);
  assert.match(files.get('src/fastify-endpoints.js'), /workflows.execute/);
  new vm.Script(files.get('src/app.js'));
});

test('native supported relations and hooks can be adapter-free', () => {
  const input=spec('mongodb');
  input.entities.Todo.fields.owner={type:'reference',ref:'User',onDelete:'nullify'};
  input.entities.Todo.softDelete={enabled:true};
  input.entities.Todo.audit={enabled:true};
  input.entities.Todo.hooks={module:'src/hooks/todo.js',before:{create:'preCreate'}};
  input.entities.User={fields:{name:{type:'string'}}};
  const files=buildFiles(normalizeSpec(input));
  assert.equal(JSON.parse(files.get('package.json')).dependencies.express,undefined);
  assert.doesNotMatch(files.get('src/server.js'),/fastifyExpress/);
  assert.match(files.get('src/fastify-crud.js'),/hookModules/);
});

test('advanced Fastify native runtime retains observability, embedded jobs and production plugins', () => {
  const spec = normalizeSpec({
    specVersion:'1.0',
    app:{name:'advanced-fastify-direct',framework:'fastify',production:{
      rateLimit:{enabled:true,max:10,windowMs:60000},compression:true
    }},
    database:{type:'mongodb'},
    observability:{enabled:true,metrics:{enabled:true}},
    events:{'ci.event':{webhooks:[]}},
    outbox:{worker:'embedded'},
    entities:{Todo:{fields:{title:{type:'string'}}}}
  });
  const files=buildFiles(spec);
  const pkg=JSON.parse(files.get('package.json'));
  assert.equal(pkg.dependencies.express,undefined);
  assert.equal(pkg.dependencies['@fastify/express'],undefined);
  assert.ok(files.get('src/app.js').includes('@fastify/rate-limit'));
  assert.ok(files.get('src/app.js').includes('@fastify/compress'));
  assert.match(files.get('src/app.js'), /observability.requestMiddleware/);
  assert.match(files.get('src/server.js'), /outboxWorker.startWorker/);
  assert.doesNotMatch(files.get('src/server.js'), /fastifyExpress/);
  new vm.Script(files.get('src/app.js'));
  new vm.Script(files.get('src/server.js'));
});

test('explicit native-only custom lifecycle modules do not require Express', () => {
  const input=spec();
  input.app.middlewareModules=['src/middleware/tenant.js'];
  const files=buildFiles(normalizeSpec(input));
  assert.equal(JSON.parse(files.get('package.json')).dependencies.express,undefined);
  const app=files.get('src/app.js');
  assert.match(app,/fastifyOnRequest/);
  assert.match(app,/fastifyPreHandler/);
  assert.match(app,/fastifyOnResponse/);
  assert.match(app,/Native Fastify middleware exports are required/);
  new vm.Script(app);
  input.api = {rest:false, graphql:{enabled:true}};
  const graphqlOnly=buildFiles(normalizeSpec(input));
  assert.equal(JSON.parse(graphqlOnly.get('package.json')).dependencies['@fastify/express'],undefined);
  assert.match(graphqlOnly.get('src/app.js'),/fastifyOnRequest/);
});

test('Mongo recursive delete planner includes nested cascades and many-to-many unlinking', () => {
  const input=spec('mongodb');
  input.entities.Child={fields:{todo:{type:'reference',ref:'Todo',onDelete:'cascade'}}};
  input.entities.Grandchild={fields:{child:{type:'reference',ref:'Child',onDelete:'cascade'}}};
  input.entities.Watchlist={fields:{todos:{type:'reference',ref:'Todo',many:true,onDelete:'nullify'}}};
  const files=buildFiles(normalizeSpec(input));
  const planner=files.get('src/fastify-mongo-delete.js');
  assert.match(planner, /"model":"Child"/);
  assert.match(planner, /"model":"Grandchild"/);
  assert.match(planner, /"many":true/);
  assert.match(planner, /\$pull/);
  assert.match(planner, /Cyclic relationship cascade/);
  new vm.Script(planner);
});

test('native Fastify supports mutation population on both persistence targets', () => {
  for (const database of ['mongodb','postgresql']) {
    const input=spec(database);
    input.entities.User={fields:{name:{type:'string'}}};
    input.entities.Todo.fields.owner={type:'reference',ref:'User'};
    input.entities.Todo.operations={
      create:{populate:['owner'],transaction:true},
      update:{populate:['owner'],transaction:true},
      delete:{populate:['owner'],status:200}
    };
    const files=buildFiles(normalizeSpec(input));
    const generated=files.get('src/fastify-crud.js');
    const pkg=JSON.parse(files.get('package.json'));
    assert.equal(pkg.dependencies.express,undefined);
    assert.equal(pkg.dependencies['@fastify/express'],undefined);
    assert.match(generated,/populateRecord\(entry, record, op.populate\)/);
    assert.match(generated,/deleteResponse/);
    assert.match(generated,/findUnique\({where: {id: record.id}, ...pgInclude\(entry, fields\)}\)/);
    new vm.Script(generated);
  }
});

test('transactional Fastify multipart mutations no longer require compatibility adapter', () => {
  for (const database of ['mongodb','postgresql']) {
    const input=spec(database);
    input.storage={enabled:true,provider:'local'};
    input.entities.Todo.fields.photo={type:'file',upload:{mimeTypes:['image/png'],maxBytes:2048}};
    input.entities.Todo.operations={create:{transaction:true},update:{transaction:true}};
    const files=buildFiles(normalizeSpec(input));
    assert.equal(JSON.parse(files.get('package.json')).dependencies['@fastify/express'],undefined);
    assert.match(files.get('src/fastify-crud.js'),/storage.parseFastifyMultipart/);
    assert.match(files.get('src/fastify-crud.js'),/storage.cleanup\(storedUploads\)/);
    new vm.Script(files.get('src/server.js'));
  }
});

test('invalid relation population fails native Fastify generation instead of falling back', () => {
  const input=spec('postgresql');
  input.entities.Todo.operations={create:{populate:['not_a_reference']}};
  assert.throws(()=>buildFiles(normalizeSpec(input)),/populate references non-reference field/);
});

test('native Fastify storage only compensates uploads before commit and retries cleanup afterward', () => {
  const input=spec('mongodb');
  input.storage={enabled:true,provider:'local'};
  input.entities.Todo.fields.photo={type:'file',upload:{mimeTypes:['image/png'],maxBytes:1024}};
  input.entities.Todo.operations={create:{transaction:true},update:{transaction:true},delete:{transaction:true}};
  const files=buildFiles(normalizeSpec(input));
  const source=files.get('src/fastify-crud.js');
  const storage=files.get('src/config/storage.js');
  assert.match(source,/storedUploads = \[\]; \/\/ Database has committed/);
  assert.match(source,/storedUploads = \[\]; \/\/ Never compensate a committed database write/);
  assert.match(source,/storage.enqueueCleanupIntent\(storage.planReplaced/);
  assert.match(source,/storage.enqueueCleanupIntent\(affected/);
  assert.match(source,/storage.finishCleanupIntent\(cleanupIntent\)/);
  assert.match(source,/storage.finishCleanupIntent\(deleteCleanupIntent\)/);
  assert.match(storage,/async function enqueueCleanupIntent\(values, tx = null\)/);
  assert.match(storage,/async function cleanupAfterCommit/);
  assert.match(storage,/attempt < 3/);
  new vm.Script(source);
  new vm.Script(storage);
});

test('full native Fastify spec retains generated deployment, SDK, admin and OpenAPI artifacts', () => {
  const fs=require('node:fs');
  const path=require('node:path');
  const input=JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/e2e.json'),'utf8'));
  input.app.framework='fastify';
  const files=buildFiles(normalizeSpec(input));
  const keys=[...files.keys()];
  const pkg=JSON.parse(files.get('package.json'));
  assert.equal(pkg.dependencies.express,undefined);
  assert.equal(pkg.dependencies['@fastify/express'],undefined);
  assert.ok(keys.some(key=>/Dockerfile$/i.test(key)));
  assert.ok(keys.some(key=>/compose.*\.ya?ml$/.test(key)));
  assert.ok(keys.some(key=>key.startsWith('deploy/k8s/')));
  assert.ok(keys.some(key=>key.startsWith('sdk/') && key.endsWith('.ts')));
  assert.ok(keys.some(key=>key.startsWith('admin/') && /\.(jsx?|tsx?)$/.test(key)));
  assert.ok(keys.some(key=>key.endsWith('openapi.json')));
  assert.match(files.get('src/server.js'),/server.close\(\)/);
  assert.doesNotMatch(files.get('src/server.js'),/fastifyExpress|fastify.use/);
});

test('native Fastify validation enforces min/max and length bounds', () => {
  const input = spec();
  input.entities.Todo.fields.title = {type: 'string', required: true, minLength: 3, maxLength: 10};
  input.entities.Todo.fields.priority = {type: 'number', min: 1, max: 5};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  const config = source.match(/^const config = (.*);$/m)[1];
  const validateSource = source.slice(source.indexOf('function validate('), source.indexOf('async function populateRecord'));
  const context = {};
  vm.runInNewContext(validateSource + '\nthis.validate = validate; this.config = ' + config + ';', context);
  const fields = context.config[0].fields;
  assert.deepEqual(Array.from(context.validate(fields, {title: 'ab', priority: 9}, false)), [
    'title must be at least 3 characters',
    'priority must be at most 5'
  ]);
  assert.deepEqual(Array.from(context.validate(fields, {title: 'abc', priority: 3}, false)), []);
});

function loadListHelpers(database) {
  const input = spec(database);
  input.entities.User = {fields: {name: {type: 'string', unique: true}}};
  input.entities.Todo.fields.priority = {type: 'number'};
  input.entities.Todo.fields.done = {type: 'boolean'};
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User'};
  input.entities.Todo.operations = {list: {query: {filters: ['priority', 'done', 'owner'], operators: ['eq', 'gte', 'lte', 'in']}}};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  const config = source.match(/^const config = (.*);$/m)[1];
  const helpers = source.slice(source.indexOf('function validId('), source.indexOf('async function populateRecord'));
  const context = {};
  vm.runInNewContext('const postgres = ' + (database === 'postgresql') + ';\n' + helpers + '\nthis.listConditions = listConditions; this.validate = validate; this.config = ' + config + ';', context);
  const entry = context.config.find(item => item.name === 'Todo');
  return {source, entry, context, list: values => context.listConditions(entry, {config: entry.operations.list.query, values}, {})};
}

test('native Fastify list filters coerce values and apply operators like the Express target', () => {
  const ownerMongo = 'a'.repeat(24);
  const mongo = loadListHelpers('mongodb');
  let result = mongo.list({priority__gte: '2', priority__lte: '5', done: 'true', owner: ownerMongo});
  assert.deepEqual(JSON.parse(JSON.stringify(result.conditions)), {priority: {$gte: 2, $lte: 5}, done: true, owner: ownerMongo});
  assert.deepEqual(Array.from(result.invalid), []);
  result = mongo.list({priority__gte: 'abc', done: 'maybe', owner: 'nope', priority__in: '1,x'});
  assert.deepEqual(Array.from(result.invalid).sort(), ['done', 'owner', 'priority__gte', 'priority__in']);

  const ownerUuid = '00000000-0000-4000-8000-000000000000';
  const postgres = loadListHelpers('postgresql');
  result = postgres.list({priority__in: '1,3', owner: ownerUuid});
  assert.deepEqual(JSON.parse(JSON.stringify(result.conditions)), {priority: {in: [1, 3]}, ownerId: ownerUuid});
});

test('native Fastify validates references and maps unique, relation and cast errors', () => {
  const {source, entry, context} = loadListHelpers('mongodb');
  assert.deepEqual(Array.from(context.validate(entry.fields, {title: 'ok', owner: 'not-an-id'}, false)), ['owner has an invalid value']);
  assert.deepEqual(Array.from(context.validate(entry.fields, {title: 'ok', owner: 'a'.repeat(24)}, false)), []);
  assert.match(source, /postgres \? error.code === "P2002" : error.code === 11000\) return reply.code\(409\)/);
  assert.match(source, /error.code === "P2003"\) return reply.code\(409\)/);
  assert.match(source, /error.name === "CastError"\) return reply.code\(400\)/);
});

test('native Fastify Mongo deletes only open transactions when the server supports them', () => {
  const input = spec();
  input.entities.Archive = {fields: {todo: {type: 'reference', ref: 'Todo', onDelete: 'restrict'}}};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.match(source, /transactional\(op.transaction \|\| \(\(entry.inbound.length > 0 \|\| storageEnabled\) && await mongoCanTransact\(\)\)/);
});

test('native Fastify applies bodyLimit, drops undeclared fields and allowlists sort fields', () => {
  const input = spec();
  input.app.bodyLimit = '10kb';
  input.entities.Todo.fields.secret = {type: 'string', options: {select: false}};
  input.entities.Todo.operations = {list: {query: {sortParam: 'sort'}}};
  const files = buildFiles(normalizeSpec(input));
  assert.match(files.get('src/app.js'), /require\('fastify'\)\(\{logger: false, bodyLimit: 10240/);
  const source = files.get('src/fastify-crud.js');
  const config = JSON.parse(source.match(/^const config = (.*);$/m)[1]);
  assert.deepEqual(config[0].sortable, ['_id', 'createdAt', 'updatedAt', 'title']);
  assert.match(source, /entry\.sortable\.includes\(field\.replace/);
  assert.match(source, /request\.body = Object\.fromEntries\(Object\.entries\(request\.body\)\.filter\(\(\[name\]\) => Object\.prototype\.hasOwnProperty\.call\(entry\.fields, name\)\)\)/);
  new vm.Script(source);
});
