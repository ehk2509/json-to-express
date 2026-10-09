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
  assert.match(source, /model.findByIdAndUpdate/);
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
  assert.match(source, /model.findByIdAndUpdate/);
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

test('mutating MongoDB relational entity remains on Express compatibility path', () => {
  const input = spec('mongodb');
  input.entities.User = {fields: {name: {type: 'string'}}};
  input.entities.Todo.fields.owner = {type: 'reference', ref: 'User'};
  const source = buildFiles(normalizeSpec(input)).get('src/fastify-crud.js');
  assert.doesNotMatch(source, /"name":"Todo"/);
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
  assert.match(source, /writeData\(entry, request.body, "create"\)/);
  assert.match(source, /writeData\(entry, request.body, "update"\)/);
  assert.match(source, /connect: \{id: reference\}/);
  new vm.Script(source);
});
