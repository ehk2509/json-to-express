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
  assert.match(files.get('src/server.js'), /registerNativeCrud\(fastify\)/);
  new vm.Script(source);
});

test('Prisma variant uses native Prisma methods', () => {
  const files = buildFiles(normalizeSpec(spec('postgresql')));
  const source = files.get('src/fastify-crud.js');
  assert.match(source, /model.findMany/);
  assert.match(source, /connectDatabase.client/);
  new vm.Script(source);
});

test('advanced relational entities stay on compatibility path', () => {
  const input = spec();
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User'};
  input.entities.User = {fields: {name: {type: 'string'}}};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.doesNotMatch(source, /"name":"Todo"/);
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
  assert.match(source, /model.findUnique/);
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

test('native Prisma delete is gated for inbound many-to-many relations', () => {
  const input = spec('postgresql');
  input.entities.User = {fields: {name: {type: 'string'}}};
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User', many: true};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.doesNotMatch(source, /"name":"User"/);
});

test('native Fastify local storage routes use multipart parser and cleanup', () => {
  const input = spec('mongodb');
  input.entities.Todo.fields.photo = {type: 'file', upload: {mimeTypes: ['image/png'], maxBytes: 1024}};
  input.storage = {enabled: true, provider: 'local'};
  const files = buildFiles(normalizeSpec(input));
  const native = files.get('src/fastify-crud.js');
  assert.match(native, /storage.parseFastifyMultipart/);
  assert.match(native, /storage.cleanupReplaced/);
  assert.match(native, /storage.cleanupEntity/);
  assert.match(files.get('src/server.js'), /@fastify\/multipart/);
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
  assert.match(source, /related.countDocuments/);
  assert.match(source, /related.updateMany/);
  assert.match(source, /related.deleteMany/);
  assert.match(source, /entry.inbound.length > 0/);
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
