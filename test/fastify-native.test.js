'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const {normalizeSpec} = require('../src');
const {buildFiles} = require('../src/generators');

function spec(framework = 'fastify', enabled = true) {
  return {specVersion: '1.0', app: {name: 'fastify-health', framework, health: {enabled, path: '/probe', status: 202, response: {ready: true}}}, database: {type: 'mongodb'}, entities: {Todo: {fields: {name: {type: 'string'}}}}};
}

test('Fastify produces a native configurable health route and register call', async () => {
  const files = buildFiles(normalizeSpec(spec()));
  const native = files.get('src/fastify-native.js');
  assert.match(files.get('src/server.js'), /registerNativeRoutes\(fastify\)/);
  new vm.Script(native);
  const routes = [];
  const module = {exports: null};
  vm.runInNewContext(native, {module});
  module.exports({get: (path, handler) => routes.push({path, handler})});
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, '/probe');
  const reply = {code(status) {this.status = status; return this;}, send(value) {this.payload = value; return this;}};
  await routes[0].handler({}, reply);
  assert.equal(reply.status, 202);
  assert.deepEqual(JSON.parse(JSON.stringify(reply.payload)), {ready: true});
});

test('Fastify native health route is omitted when disabled', () => {
  const files = buildFiles(normalizeSpec(spec('fastify', false)));
  assert.doesNotMatch(files.get('src/fastify-native.js'), /fastify.get/);
});

test('Express remains unchanged without native file', () => {
  const files = buildFiles(normalizeSpec(spec('express')));
  assert.equal(files.has('src/fastify-native.js'), false);
  assert.doesNotMatch(files.get('src/server.js'), /registerNativeRoutes/);
});

test('Fastify generates native operational routes and correlation hooks', async () => {
  const input = spec();
  input.observability = {enabled: true, health: {liveness: {enabled: true, path: '/live'}, readiness: {enabled: true, path: '/ready'}}, metrics: {enabled: true, path: '/metrics'}};
  const files = buildFiles(normalizeSpec(input));
  const generated = files.get('src/fastify-native.js');
  assert.ok(generated.includes('fastify.get("/live"'));
  assert.ok(generated.includes('fastify.get("/ready"'));
  assert.ok(generated.includes('fastify.get("/metrics"'));
  assert.match(generated, /X-Request-Id/);
  assert.match(generated, /X-Content-Type-Options/);
  new vm.Script(generated);
});
