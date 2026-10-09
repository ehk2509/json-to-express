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
    ...nativeModules.map((name, i) =>
      'const register' + i + ' = require(' + js(relativeRequire(appPath, require('node:path').posix.join(root, name + '.js'))) + ');'),
    ...nativeModules.map((name, i) => 'register' + i + '(fastify);'),
    'module.exports = fastify;',
    ''
  ].join('\n');
};
