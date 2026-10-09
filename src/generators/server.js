'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

function serverSource(spec) {
  const paths = filePaths(spec);
  return [
    "'use strict';", '',
    "require('dotenv').config();",
    'const validateEnvironment = require(' + js(relativeRequire(paths.server, paths.environment)) + ');',
    ...(spec.observability.enabled ? ['const observability = require(' + js(relativeRequire(paths.server, paths.observability)) + ');'] : []),
    ...(spec.cache.enabled ? ['const cache = require(' + js(relativeRequire(paths.server, paths.cache)) + ');'] : []),
    'const app = require(' + js(relativeRequire(paths.server, paths.app)) + ');',
    ...(spec.app.framework === 'fastify' ? ["const fastify = require('fastify')({logger: false" + (spec.storage.enabled && spec.storage.provider === 'local' && spec.storage.signedUrls.enabled ? ', maxParamLength: 2048' : '') + '});', "const fastifyExpress = require('@fastify/express');", 'const registerNativeRoutes = require(' + js(relativeRequire(paths.server, require('node:path').posix.join(spec.generation.paths.source, 'fastify-native.js'))) + ');', 'const registerNativeCrud = require(' + js(relativeRequire(paths.server, require('node:path').posix.join(spec.generation.paths.source, 'fastify-crud.js'))) + ');', 'const registerNativeEndpoints = require(' + js(relativeRequire(paths.server, require('node:path').posix.join(spec.generation.paths.source, 'fastify-endpoints.js'))) + ');', 'const registerNativeAuth = require(' + js(relativeRequire(paths.server, require('node:path').posix.join(spec.generation.paths.source, 'fastify-auth.js'))) + ');'] : []),
    'const connectDatabase = require(' + js(relativeRequire(paths.server, paths.database)) + ');',
    ...(spec.outbox.enabled && spec.outbox.worker === 'embedded' ? ['const outboxWorker = require(' + js(relativeRequire(paths.server, paths.worker)) + ');'] : []), '',
    'validateEnvironment();',
    'const port = Number(process.env[' + js(spec.app.portEnv) + '] || ' + spec.app.port + ');',
    'const host = process.env[' + js(spec.app.hostEnv) + '] || ' + js(spec.app.host) + ';',
    'let server;', '',
    'async function start() {',
    ...(spec.observability.enabled ? ['  await observability.startTracing();'] : []),
    '  await connectDatabase();',
    ...(spec.outbox.enabled && spec.outbox.worker === 'embedded' ? [
      spec.observability.enabled
        ? '  outboxWorker.startWorker().catch(error => observability.logger.error("worker.loop.failed", {error: error.message}));'
        : '  outboxWorker.startWorker().catch(error => console.error("Outbox worker failed:", error));'
    ] : []),
    ...(spec.app.framework === 'fastify' ? [
      '  await fastify.register(fastifyExpress);',
      ...(spec.storage.enabled ? ['  await fastify.register(require("@fastify/multipart"));'] : []),
      ...(spec.app.production.rateLimit.enabled ? ['  await fastify.register(require("@fastify/rate-limit"), {max: ' + spec.app.production.rateLimit.max + ', timeWindow: ' + spec.app.production.rateLimit.windowMs + '});'] : []),
      ...(spec.app.production.compression ? ['  await fastify.register(require("@fastify/compress"));'] : []),
      '  fastify.use((req, res, next) => {',
      '    const pathname = String(req.url).split("?")[0];',
      '    if (registerNativeRoutes.matches(req.method, pathname) || registerNativeCrud.matches(req.method, pathname) || registerNativeEndpoints.matches(req.method, pathname) || registerNativeAuth.matches(req.method, pathname)) return next();',
      '    app(req, res, next);',
      '  });',
      '  registerNativeRoutes(fastify);',
      '  registerNativeCrud(fastify);',
      '  registerNativeEndpoints(fastify);',
      '  registerNativeAuth(fastify);',
      '  await fastify.listen({port, host});',
      '  server = fastify;',
      '  ' + (spec.observability.enabled
        ? 'observability.logger.info("server.started", {host, port});'
        : 'console.log(' + js(spec.app.startupMessage) + '.replace("{host}", host).replace("{port}", String(port)));')
    ] : [
    '  server = app.listen(port, host, () => ' +
      (spec.observability.enabled
        ? 'observability.logger.info("server.started", {host, port})'
        : 'console.log(' + js(spec.app.startupMessage) + '.replace("{host}", host).replace("{port}", String(port)))') +
      ');'
    ]),
    '}', '',
    'async function shutdown(signal) {',
    '  console.log(signal + " received, shutting down");',
    ...(spec.app.framework === 'fastify' ? ['  if (server) await server.close();'] : ['  if (server) await new Promise(resolve => server.close(resolve));']),
    ...(spec.outbox.enabled && spec.outbox.worker === 'embedded' ? ['  outboxWorker.stopWorker();'] : []),
    ...(spec.cache.enabled ? ['  await cache.disconnect();'] : []),
    '  if (connectDatabase.disconnect) await connectDatabase.disconnect();',
    ...(spec.observability.enabled ? ['  await observability.shutdownTracing();'] : []),
    '}', '',
    "for (const signal of ['SIGTERM', 'SIGINT']) {",
    '  process.once(signal, () => shutdown(signal).then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); }));',
    '}', '',
    "start().catch(error => { " +
      (spec.observability.enabled
        ? "observability.logger.error('server.start.failed', {error: error.message});"
        : "console.error('Failed to start application:', error);") +
      " process.exitCode = 1; });", ''
  ].join('\n');
}

module.exports = serverSource;
