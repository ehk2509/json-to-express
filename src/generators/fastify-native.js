'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

module.exports = function fastifyNativeSource(spec) {
  const nativePath = require('node:path').posix.join(spec.generation.paths.source, 'fastify-native.js');
  const lines = [
    "'use strict';",
    '',
    ...(spec.app.production.requestId ? ["const crypto = require('node:crypto');"] : []),
    ...(spec.observability.enabled ? ['const observability = require(' + js(relativeRequire(nativePath, filePaths(spec).observability)) + ');'] : []),
    '',
    'module.exports = function registerNativeRoutes(fastify) {'
  ];
  if (spec.app.production.securityHeaders || spec.app.production.requestId || spec.app.production.cors.enabled) {
    lines.push('  fastify.addHook("onRequest", async (request, reply) => {');
    if (spec.app.production.securityHeaders) lines.push(
      '    reply.header("X-Content-Type-Options", "nosniff");',
      '    reply.header("X-Frame-Options", "DENY");',
      '    reply.header("Referrer-Policy", "no-referrer");'
    );
    if (spec.app.production.requestId) lines.push(
      '    request.raw.id = String(request.headers["x-request-id"] || crypto.randomUUID());',
      '    reply.header("X-Request-Id", request.raw.id);'
    );
    if (spec.app.production.cors.enabled) lines.push(
      '    reply.header("Access-Control-Allow-Origin", ' + js(spec.app.production.cors.origin) + ');'
    );
    lines.push('  });');
  }
  if (spec.app.health.enabled) {
    lines.push('  fastify.get(' + js(spec.app.health.path) + ', async (request, reply) => reply.code(' + spec.app.health.status + ').send(' + js(spec.app.health.response) + '));');
  }
  if (spec.observability.health.liveness.enabled) {
    lines.push('  fastify.get(' + js(spec.observability.health.liveness.path) + ', async (request, reply) => reply.code(200).send({status: "alive"}));');
  }
  if (spec.observability.health.readiness.enabled) {
    lines.push(
      '  fastify.get(' + js(spec.observability.health.readiness.path) + ', async (request, reply) => {',
      '    const response = {code: 200, body: null};',
      '    const res = {status(code) {response.code = code; return this;}, json(body) {response.body = body; return this;}};',
      '    await observability.readinessHandler(request.raw, res);',
      '    return reply.code(response.code).send(response.body);',
      '  });'
    );
  }
  if (spec.observability.metrics.enabled) {
    lines.push(
      '  fastify.get(' + js(spec.observability.metrics.path) + ', async (request, reply) => {',
      '    const response = {code: 200, body: ""};',
      '    const res = {setHeader(key, value) {reply.header(key, value);}, status(code) {response.code = code; return this;}, send(body) {response.body = body; return this;}};',
      '    await observability.metricsHandler(request.raw, res, error => {throw error;});',
      '    return reply.code(response.code).send(response.body);',
      '  });'
    );
  }
  lines.push('};', '');
  return lines.join('\n');
};
