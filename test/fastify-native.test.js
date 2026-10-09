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
  assert.match(files.get('src/app.js'), /register0\(fastify\)/);
  new vm.Script(native);
  const routes = [];
  const module = {exports: null};
  vm.runInNewContext(native, {module, require});
  module.exports({addHook: () => {}, setErrorHandler: () => {}, get: (path, handler) => routes.push({path, handler})});
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

test('Fastify CORS preflight enforces configured origin and sends empty 204', async () => {
  const input = spec();
  input.app.production = {cors: {enabled: true, origin: 'https://allowed.example'}};
  const generated = buildFiles(normalizeSpec(input)).get('src/fastify-native.js');
  const module = {exports: null};
  vm.runInNewContext(generated, {module, require});
  let onRequest;
  let errorHandler;
  module.exports({addHook: (name, fn) => {if (name === 'onRequest') onRequest = fn;}, setErrorHandler: fn => {errorHandler = fn;}, get() {}});
  assert.ok(onRequest);
  assert.ok(errorHandler);
  function reply() { return {headers: {}, codeValue: 200, header(k,v) {this.headers[k]=v; return this;}, code(c) {this.codeValue=c; return this;}, send(body) {this.payload=body; return this;}}; }
  const ok = reply();
  await onRequest({raw:{}, method:'OPTIONS', headers:{origin:'https://allowed.example', 'access-control-request-method':'POST', 'access-control-request-headers':'X-API-Key'}}, ok);
  assert.equal(ok.codeValue, 204);
  assert.equal(ok.headers['Access-Control-Allow-Origin'], 'https://allowed.example');
  assert.equal(ok.headers['Access-Control-Allow-Headers'], 'X-API-Key');
  const denied = reply();
  await onRequest({raw:{}, method:'OPTIONS', headers:{origin:'https://evil.example', 'access-control-request-method':'POST'}}, denied);
  assert.equal(denied.codeValue, 403);
  const internal = reply();
  errorHandler(new Error('secret internal details'), {}, internal);
  assert.equal(internal.codeValue, 500);
  assert.deepEqual(JSON.parse(JSON.stringify(internal.payload)), {error:'Internal server error'});
});
