'use strict';

const {js} = require('./utils');

module.exports = function fastifyNativeSource(spec) {
  const lines = [
    "'use strict';",
    '',
    'module.exports = function registerNativeRoutes(fastify) {'
  ];
  if (spec.app.health.enabled) {
    lines.push('  fastify.get(' + js(spec.app.health.path) + ', async (request, reply) => reply.code(' + spec.app.health.status + ').send(' + js(spec.app.health.response) + '));');
  }
  lines.push('};', '');
  return lines.join('\n');
};
