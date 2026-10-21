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
    authStore: path.posix.join(source, p.config, 'auth-store.js'),
    authRoutes: path.posix.join(source, p.routes, 'AuthRoutes.js'),
    validation: path.posix.join(source, p.middleware, 'validation.js'),
    environment: path.posix.join(source, p.config, 'environment.js'),
    observability: path.posix.join(source, p.config, 'observability.js'),
    cache: path.posix.join(source, p.config, 'cache.js'),
    storage: path.posix.join(source, p.config, 'storage.js'),
    workflowEngine: path.posix.join(source, p.workflows, 'engine.js'),
    eventBus: path.posix.join(source, p.workflows, 'events.js'),
    outbox: path.posix.join(source, p.workflows, 'outbox.js'),
    worker: path.posix.join(source, p.workflows, 'worker.js'),
    graphql: path.posix.join(source, p.graphql, 'index.js'),
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

// Fields clients may name in sort/select query parameters. Hidden (select: false)
// fields are never exposed, and Prisma cannot order by relations or JSON columns.
function queryFields(spec, entity, purpose) {
  const mongo = spec.database.type === 'mongodb';
  const names = [mongo ? '_id' : 'id', 'createdAt', 'updatedAt'];
  if (entity.audit && entity.audit.enabled) names.push(entity.audit.createdBy, entity.audit.updatedBy);
  for (const field of entity.fields) {
    if (field.options && field.options.select === false) continue;
    if (purpose === 'sort' && !mongo && (field.type === 'reference' || field.type === 'file')) continue;
    names.push(field.name);
  }
  return [...new Set(names)];
}

module.exports = {filePaths, js, joinUrl, payload, queryFields, relativeRequire};
