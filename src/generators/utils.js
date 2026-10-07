'use strict';

const path = require('node:path');

function js(value) {
  return JSON.stringify(value);
}

function joinUrl(...parts) {
  const joined = parts
    .filter(part => part !== undefined && part !== null && part !== '')
    .map((part, index) => {
      const value = String(part);
      if (index === 0) return value.replace(/\/$/, '');
      return value.replace(/^\//, '').replace(/\/$/, '');
    })
    .filter(Boolean)
    .join('/');
  return joined.startsWith('/') ? joined : '/' + joined;
}

function payload(value, fallbackKey = 'error') {
  if (typeof value === 'string') return '{' + fallbackKey + ': ' + js(value) + '}';
  return js(value);
}

function filePaths(spec, entityName) {
  const p = spec.generation.paths;
  const source = p.source;
  const result = {
    app: path.posix.join(source, 'app.js'),
    server: path.posix.join(source, 'server.js'),
    database: path.posix.join(source, p.config, 'database.js'),
    errorHandler: path.posix.join(source, p.middleware, 'error-handler.js'),
    auth: path.posix.join(source, p.middleware, 'auth.js'),
    validation: path.posix.join(source, p.middleware, 'validation.js'),
    environment: path.posix.join(source, p.config, 'environment.js'),
    workflowEngine: path.posix.join(source, p.workflows, 'engine.js'),
    eventBus: path.posix.join(source, p.workflows, 'events.js'),
    outbox: path.posix.join(source, p.workflows, 'outbox.js'),
    worker: path.posix.join(source, p.workflows, 'worker.js'),
    endpointRoutes: path.posix.join(source, p.routes, 'CustomRoutes.js'),
    test: path.posix.join(p.tests, 'health.test.js')
  };
  if (entityName) {
    result.model = path.posix.join(source, p.models, entityName + '.js');
    result.controller = path.posix.join(source, p.controllers, entityName + 'Controller.js');
    result.route = path.posix.join(source, p.routes, entityName + 'Routes.js');
  }
  return result;
}

function relativeRequire(fromFile, toFile) {
  let relative = path.posix.relative(path.posix.dirname(fromFile), toFile).replace(/\.js$/, '');
  if (!relative.startsWith('.')) relative = './' + relative;
  return relative;
}

module.exports = {filePaths, js, joinUrl, payload, relativeRequire};
