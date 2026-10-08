'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

function routesSource(entity, spec) {
  const controllerNames = {list: 'list', get: 'get', create: 'create', update: 'update', delete: 'remove'};
  const routeLines = [];
  const paths = filePaths(spec, entity.name);
  const needsAuth = Object.values(entity.operations).some(op => op.enabled && op.auth && op.auth.required);
  const hasFiles = entity.fields.some(field => field.type === 'file');

  for (const [name, operation] of Object.entries(entity.operations)) {
    if (!operation.enabled) continue;
    const middleware = [];
    if (operation.auth && operation.auth.required) {
      middleware.push('auth.authenticate(' + js(operation.auth) + ')');
    }
    if (hasFiles && ['create','update'].includes(name)) {
      middleware.push('storage.uploadMiddleware(' + js(entity.name) + ')');
    }
    if (operation.validate) {
      if (name === 'create') middleware.push('validation.body(' + js(entity.name) + ', false)');
      if (name === 'update') middleware.push('validation.body(' + js(entity.name) + ', true)');
      if (['get','update','delete'].includes(name)) middleware.push('validation.identifier(' + js(entity.idParam) + ')');
    }
    const handlers=[...middleware,'controller.'+controllerNames[name]].join(', ');
    routeLines.push('router.' + operation.method + '(' + js(operation.path) + ', ' + handlers + ');');
  }

  return [
    "'use strict';", '',
    "const express = require('express');",
    'const controller = require(' + js(relativeRequire(paths.route, paths.controller)) + ');',
    'const validation = require(' + js(relativeRequire(paths.route, filePaths(spec).validation)) + ');',
    ...(needsAuth ? ['const auth = require(' + js(relativeRequire(paths.route, filePaths(spec).auth)) + ');'] : []),
    ...(hasFiles ? ['const storage = require(' + js(relativeRequire(paths.route, filePaths(spec).storage)) + ');'] : []),
    '',
    'const router = express.Router();', '',
    ...routeLines, '',
    'module.exports = router;', ''
  ].join('\n');
}

module.exports = routesSource;
