'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

module.exports = function directFastifyAppSource(spec) {
  const appPath = filePaths(spec).app;
  const root = require('node:path').posix.join(spec.generation.paths.source);
  const nativeModules = ['fastify-native', 'fastify-crud', 'fastify-endpoints', 'fastify-auth'];
  return [
    "'use strict';",
    "const fastify = require('fastify')({logger: false" + (spec.storage.enabled && spec.storage.provider === 'local' && spec.storage.signedUrls.enabled ? ', maxParamLength: 2048' : '') + '});',
    ...(spec.storage.enabled ? ["fastify.register(require('@fastify/multipart'));"] : []),
    ...(spec.app.production.rateLimit.enabled ? ['fastify.register(require("@fastify/rate-limit"), {max: ' + spec.app.production.rateLimit.max + ', timeWindow: ' + spec.app.production.rateLimit.windowMs + '});'] : []),
    ...(spec.app.production.compression ? ['fastify.register(require("@fastify/compress"));'] : []),
    ...(spec.observability.enabled ? [
      'const observability = require(' + js(relativeRequire(appPath, filePaths(spec).observability)) + ');',
      'fastify.addHook("onRequest", (request, reply, done) => {',
      '  request.raw.route = {path: request.routeOptions.url};',
      '  observability.requestMiddleware(request.raw, reply.raw, done);',
      '});'
    ] : []),
    ...nativeModules.map((name, i) =>
      'const register' + i + ' = require(' + js(relativeRequire(appPath, require('node:path').posix.join(root, name + '.js'))) + ');'),
    ...nativeModules.map((name, i) => 'register' + i + '(fastify);'),
    'module.exports = fastify;',
    ''
  ].join('\n');
};
