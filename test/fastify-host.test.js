'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {normalizeSpec} = require('../src');
const {buildFiles} = require('../src/generators');

function spec(framework) {
  return {
    specVersion: '1.0',
    app: {name: 'host-test', ...(framework ? {framework} : {})},
    database: {type: 'mongodb'},
    entities: {Todo: {fields: {title: {type: 'string', required: true}}}}
  };
}

test('Express remains the default and keeps existing server startup', () => {
  const files = buildFiles(normalizeSpec(spec()));
  const pkg = JSON.parse(files.get('package.json'));
  assert.equal(pkg.dependencies.fastify, undefined);
  assert.match(files.get('src/server.js'), /app.listen\(port, host/);
  new vm.Script(files.get('src/server.js'));
});

test('Fastify GraphQL-only startup is native with no Express adapter or CRUD routes', () => {
  const input=spec('fastify');
  input.api={rest:false,graphql:{enabled:true}};
  const files=buildFiles(normalizeSpec(input));
  const pkg=JSON.parse(files.get('package.json'));
  assert.ok(pkg.dependencies.fastify);
  assert.equal(pkg.dependencies.express,undefined);
  assert.equal(pkg.dependencies['@fastify/express'],undefined);
  assert.match(files.get('src/server.js'),/const fastify = app/);
  assert.doesNotMatch(files.get('src/server.js'),/fastifyExpress|fastify.use/);
  assert.doesNotMatch(files.get('src/fastify-crud.js'),/"name":"Todo"/);
  assert.match(files.get('src/app.js'),/register0\(fastify\)/);
  assert.match(files.get('src/server.js'),/await fastify.listen/);
  assert.match(files.get('src/server.js'),/await server.close/);
  new vm.Script(files.get('src/server.js'));
});
