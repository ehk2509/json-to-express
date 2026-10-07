'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

module.exports = function customRoutesSource(spec) {
  const paths = filePaths(spec);
  const needsAuth = spec.endpoints.some(endpoint => endpoint.auth.required);
  const lines = [
    "'use strict';", '',
    "const express = require('express');",
    'const workflows = require(' + js(relativeRequire(paths.endpointRoutes, paths.workflowEngine)) + ');',
    ...(needsAuth ? ['const auth = require(' + js(relativeRequire(paths.endpointRoutes, paths.auth)) + ');'] : []),
    '',
    'const router = express.Router();', ''
  ];

  for (const endpoint of spec.endpoints) {
    const middleware = [];
    if (endpoint.auth.required) {
      middleware.push('auth.authenticate');
      if (endpoint.auth.roles.length) middleware.push('auth.requireRoles(' + js(endpoint.auth.roles) + ')');
    }
    const handler = [
      'async function(req, res, next) {',
      '  try {',
      '    const output = await workflows.execute(' + js(endpoint.workflow) + ', req);',
      '    const result = output.result;',
      '    if (result && result.__response) {',
      '      const status = result.status || ' + endpoint.status + ';',
      '      if (status === 204) return res.status(204).end();',
      '      return res.status(status).json(result.body);',
      '    }',
      '    if (' + endpoint.status + ' === 204) return res.status(204).end();',
      '    return res.status(' + endpoint.status + ').json(result);',
      '  } catch (error) { next(error); }',
      '}'
    ].join(' ');
    const args = [...middleware, handler].join(', ');
    lines.push('router.' + endpoint.method + '(' + js(endpoint.path) + ', ' + args + ');');
  }

  lines.push('', 'module.exports = router;', '');
  return lines.join('\n');
};
