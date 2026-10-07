'use strict';

const {js} = require('./utils');

function routesSource(entity) {
  const controllerNames = {list: 'list', get: 'get', create: 'create', update: 'update', delete: 'remove'};
  const routeLines = [];
  for (const [name, operation] of Object.entries(entity.operations)) {
    if (!operation.enabled) continue;
    routeLines.push('router.' + operation.method + '(' + js(operation.path) + ', controller.' + controllerNames[name] + ');');
  }

  return [
    "'use strict';", '',
    "const express = require('express');",
    "const controller = require('../controllers/" + entity.name + "Controller');", '',
    'const router = express.Router();', '',
    ...routeLines, '',
    'module.exports = router;', ''
  ].join('\n');
}

module.exports = routesSource;
