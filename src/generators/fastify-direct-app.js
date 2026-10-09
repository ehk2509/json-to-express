'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

module.exports = function directFastifyAppSource(spec) {
  const appPath = filePaths(spec).app;
  const root = require('node:path').posix.join(spec.generation.paths.source);
  const nativeModules = ['fastify-native', 'fastify-crud', 'fastify-endpoints', 'fastify-auth'];
  return [
    "'use strict';",
    "const fastify = require('fastify')({logger: false" + (spec.storage.enabled && spec.storage.provider === 'local' && spec.storage.signedUrls.enabled ? ', maxParamLength: 2048' : '') + '});',
    'fastify.register(async function nativeScope(fastify) {',
    ...(spec.storage.enabled ? ["  await fastify.register(require('@fastify/multipart'));"] : []),
    ...(spec.app.production.rateLimit.enabled ? ['  await fastify.register(require("@fastify/rate-limit"), {max: ' + spec.app.production.rateLimit.max + ', timeWindow: ' + spec.app.production.rateLimit.windowMs + '});'] : []),
    ...(spec.app.production.compression ? ['  await fastify.register(require("@fastify/compress"));'] : []),
    ...(spec.observability.enabled ? [
      'const observability = require(' + js(relativeRequire(appPath, filePaths(spec).observability)) + ');',
      'fastify.addHook("onRequest", (request, reply, done) => {',
      '  request.raw.route = {path: request.routeOptions.url};',
      '  observability.requestMiddleware(request.raw, reply.raw, done);',
      '});'
    ] : []),
    ...spec.app.middlewareModules.flatMap(modulePath => [
      '  { const middleware = require(' + js(relativeRequire(appPath, modulePath)) + ');',
      '    const nativeHooks = ["fastifyOnRequest", "fastifyPreValidation", "fastifyPreHandler", "fastifyPreSerialization", "fastifyOnSend", "fastifyOnError", "fastifyOnResponse"];',
      '    if (!middleware || !nativeHooks.some(name => typeof middleware[name] === "function")) throw new Error("Native Fastify middleware exports are required: ' + modulePath.replace(/"/g, '') + '");',
      ...['onRequest', 'preValidation', 'preHandler'].map(stage =>
        '    if (typeof middleware.fastify' + stage[0].toUpperCase() + stage.slice(1) + ' === "function") fastify.addHook("' + stage + '", async (request, reply) => { await middleware.fastify' + stage[0].toUpperCase() + stage.slice(1) + '(request, reply); });'
      ),
      '    if (typeof middleware.fastifyPreSerialization === "function") fastify.addHook("preSerialization", (request, reply, payload) => middleware.fastifyPreSerialization(request, reply, payload));',
      '    if (typeof middleware.fastifyOnSend === "function") fastify.addHook("onSend", (request, reply, payload) => middleware.fastifyOnSend(request, reply, payload));',
      '    if (typeof middleware.fastifyOnError === "function") fastify.addHook("onError", (request, reply, error) => middleware.fastifyOnError(request, reply, error));',
      '    if (typeof middleware.fastifyOnResponse === "function") fastify.addHook("onResponse", (request, reply) => middleware.fastifyOnResponse(request, reply));',
      '  }'
    ]),
    ...nativeModules.map((name, i) =>
      'const register' + i + ' = require(' + js(relativeRequire(appPath, require('node:path').posix.join(root, name + '.js'))) + ');'),
    ...nativeModules.map((name, i) => 'register' + i + '(fastify);'),
    '});',
    'module.exports = fastify;',
    ''
  ].join('\n');
};
