'use strict';

const {filePaths, js, joinUrl, relativeRequire} = require('./utils');

module.exports = function nativeEndpointSource(spec) {
  const paths = filePaths(spec);
  const target = require('node:path').posix.join(spec.generation.paths.source, 'fastify-endpoints.js');
  const endpoints = spec.api.rest ? spec.endpoints.map(endpoint => ({
    method: endpoint.method.toUpperCase(),
    url: joinUrl(spec.app.apiPrefix || '/', endpoint.path),
    workflow: endpoint.workflow,
    status: endpoint.status,
    auth: endpoint.auth
  })) : [];
  return [
    "'use strict';",
    ...(endpoints.length ? ['const workflows = require(' + js(relativeRequire(target, paths.workflowEngine)) + ');'] : []),
    ...(endpoints.some(endpoint => endpoint.auth.required) ? ['const auth = require(' + js(relativeRequire(target, paths.auth)) + ');'] : []),
    'const endpoints = ' + js(endpoints) + ';',
    'module.exports = function registerNativeEndpoints(fastify) {',
    '  for (const endpoint of endpoints) {',
    '    fastify.route({method: endpoint.method, url: endpoint.url, handler: async (request, reply) => {',
    '      if (endpoint.auth.required) {',
    '        try { request.raw.auth = await auth.readAuth(request.raw, endpoint.auth); }',
    '        catch (error) { return reply.code(error.statusCode || 401).send({error: error.message}); }',
    '      }',
    '      const context = {body: request.body, params: request.params, query: request.query, headers: request.headers, auth: request.raw.auth, id: request.raw.id};',
    '      const output = await workflows.execute(endpoint.workflow, context);',
    '      const result = output.result;',
    '      const status = result && result.__response ? (result.status || endpoint.status) : endpoint.status;',
    '      if (status === 204) return reply.code(204).send();',
    '      return reply.code(status).send(result && result.__response ? result.body : result);',
    '    }});',
    '  }',
    '};',
    'module.exports.matches = (method, pathname) => endpoints.some(endpoint => endpoint.method === String(method).toUpperCase() && endpoint.url === pathname);',
    ''
  ].join('\n');
};
