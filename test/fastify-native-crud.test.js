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
