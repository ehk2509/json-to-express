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

test('Fastify compatibility mode preserves adapter startup and shutdown', () => {
  const input = spec('fastify');
  input.api = {rest: false, graphql: {enabled: true}};
  const files = buildFiles(normalizeSpec(input));
  const pkg = JSON.parse(files.get('package.json'));
  assert.ok(pkg.dependencies.fastify);
  assert.ok(pkg.dependencies['@fastify/express']);
  assert.match(files.get('src/server.js'), /fastify.register\(fastifyExpress\)/);
  assert.match(files.get('src/server.js'), /registerNativeCrud.matches/);
  assert.match(files.get('src/server.js'), /app\(req, res, next\)/);
  assert.match(files.get('src/server.js'), /await fastify.listen/);
  assert.match(files.get('src/server.js'), /await server.close/);
  new vm.Script(files.get('src/server.js'));
});
