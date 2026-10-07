'use strict';

const path = require('node:path');
const modelSource = require('./model');
const controllerSource = require('./controller');
const routesSource = require('./routes');
const appSource = require('./app');
const serverSource = require('./server');
const databaseSource = require('./database');
const errorHandlerSource = require('./error-handler');
const packageSource = require('./package');
const readmeSource = require('./readme');
const smokeTestSource = require('./health-generator');
const {filePaths} = require('./utils');

function buildFiles(spec) {
  const files = new Map();
  const paths = filePaths(spec);
  files.set('package.json', packageSource(spec));
  files.set('.env.example',
    spec.app.portEnv + '=' + spec.app.port + '\n' +
    spec.app.hostEnv + '=' + spec.app.host + '\n' +
    spec.database.uriEnv + '=' + spec.database.defaultUri + '\n'
  );
  files.set('README.md', readmeSource(spec));
  files.set(paths.app, appSource(spec));
  files.set(paths.server, serverSource(spec));
  files.set(paths.database, databaseSource(spec));
  files.set(paths.errorHandler, errorHandlerSource(spec));
  if (spec.app.health.enabled) files.set(paths.test, smokeTestSource(spec));

  for (const entity of spec.entities) {
    const entityPaths = filePaths(spec, entity.name);
    files.set(entityPaths.model, modelSource(entity, spec));
    files.set(entityPaths.controller, controllerSource(entity, spec));
    files.set(entityPaths.route, routesSource(entity, spec));
  }

  return files;
}

module.exports = {buildFiles};
