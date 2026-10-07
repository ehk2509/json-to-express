'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

function routesSource(entity, spec) {
  const controllerNames = {list: 'list', get: 'get', create: 'create', update: 'update', delete: 'remove'};
  const routeLines = [];
  const paths = filePaths(spec, entity.name);

  for (const [name, operation] of Object.entries(entity.operations)) {
    if (!operation.enabled) continue;
    routeLines.push('router.' + operation.method + '(' + js(operation.path) + ', controller.' + controllerNames[name] + ');');
  }

  return [
    "'use strict';", '',
    "const express = require('express');",
    'const controller = require(' + js(relativeRequire(paths.route, paths.controller)) + ');', '',
    'const router = express.Router();', '',
    ...routeLines, '',
    'module.exports = router;', ''
  ].join('\n');
}

module.exports = routesSource;
