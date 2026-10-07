'use strict';

const modelSource = require('./model');
const controllerSource = require('./controller');
const routesSource = require('./routes');
const appSource = require('./app');
const serverSource = require('./server');
const databaseSource = require('./database');
const errorHandlerSource = require('./error-handler');
const packageSource = require('./package');
const readmeSource = require('./readme');
const smokeTestSource = require('./test');

function buildFiles(spec) {
  const files = new Map();
  files.set('package.json', packageSource(spec));
  files.set('.env.example',
    spec.app.portEnv + '=' + spec.app.port + '\n' +
    spec.app.hostEnv + '=' + spec.app.host + '\n' +
    spec.database.uriEnv + '=' + spec.database.defaultUri + '\n'
  );
  files.set('README.md', readmeSource(spec));
  files.set('src/app.js', appSource(spec));
  files.set('src/server.js', serverSource(spec));
  files.set('src/config/database.js', databaseSource(spec));
  files.set('src/middleware/error-handler.js', errorHandlerSource(spec));
  if (spec.app.health.enabled) files.set('test/health.test.js', smokeTestSource(spec));

  for (const entity of spec.entities) {
    files.set('src/models/' + entity.name + '.js', modelSource(entity));
    files.set('src/controllers/' + entity.name + 'Controller.js', controllerSource(entity));
    files.set('src/routes/' + entity.name + 'Routes.js', routesSource(entity));
  }

  return files;
}

module.exports = {buildFiles};
