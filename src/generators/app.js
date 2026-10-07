'use strict';

const {filePaths, js, joinUrl, payload, relativeRequire} = require('./utils');

function appSource(spec) {
  const appPath = filePaths(spec).app;
  const imports = spec.entities.map(entity => {
    const paths = filePaths(spec, entity.name);
    return 'const ' + entity.name + 'Routes = require(' + js(relativeRequire(appPath, paths.route)) + ');';
  });
  const mounts = spec.entities.map(entity => 'app.use(' + js(joinUrl(spec.app.apiPrefix, entity.route)) + ', ' + entity.name + 'Routes);');
  const middleware = [];

  if (spec.app.express.trustProxy !== false) middleware.push('app.set("trust proxy", ' + js(spec.app.express.trustProxy) + ');');
  if (spec.app.express.json.enabled) middleware.push('app.use(express.json({limit: ' + js(spec.app.express.json.limit) + '}));');
  if (spec.app.express.urlencoded.enabled) {
    middleware.push('app.use(express.urlencoded({extended: ' + spec.app.express.urlencoded.extended + ', limit: ' + js(spec.app.express.urlencoded.limit) + '}));');
  }

  const health = spec.app.health.enabled
    ? ['app.get(' + js(spec.app.health.path) + ', (req, res) => res.status(' + spec.app.health.status + ').json(' + js(spec.app.health.response) + '));']
    : [];

  return [
    "'use strict';", '',
    "const express = require('express');",
    'const errorHandler = require(' + js(relativeRequire(appPath, filePaths(spec).errorHandler)) + ');',
    ...imports, '',
    'const app = express();', '',
    ...middleware,
    ...health,
    ...mounts, '',
    'app.use((req, res) => res.status(' + spec.app.statusCodes.notFound + ').json(' + payload(spec.app.responses.notFound) + '));',
    'app.use(errorHandler);', '',
    'module.exports = app;', ''
  ].join('\n');
}

module.exports = appSource;
