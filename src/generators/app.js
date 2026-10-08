'use strict';

const {filePaths, js, joinUrl, payload, relativeRequire} = require('./utils');

function appSource(spec) {
  const appPath = filePaths(spec).app;
  const imports = spec.entities.map(entity => {
    const paths = filePaths(spec, entity.name);
    return 'const ' + entity.name + 'Routes = require(' + js(relativeRequire(appPath, paths.route)) + ');';
  });
  if (spec.endpoints.length) imports.push('const CustomRoutes = require(' + js(relativeRequire(appPath, filePaths(spec).endpointRoutes)) + ');');
  if (spec.auth.routesEnabled) imports.push('const AuthRoutes = require(' + js(relativeRequire(appPath, filePaths(spec).authRoutes)) + ');');
  const middlewareImports = spec.app.middlewareModules.map((modulePath, index) =>
    'const customMiddleware' + index + ' = require(' + js(relativeRequire(appPath, modulePath)) + ');'
  );
  const prodImports = [];
  if (spec.app.production.requestId) prodImports.push("const crypto = require('node:crypto');");
  if (spec.app.production.cors.enabled) prodImports.push("const cors = require('cors');");
  if (spec.app.production.rateLimit.enabled) prodImports.push("const {rateLimit} = require('express-rate-limit');");
  if (spec.app.production.compression) prodImports.push("const compression = require('compression');");

  const mounts = spec.api.rest
    ? spec.entities.map(entity => 'app.use(' + js(joinUrl(spec.app.apiPrefix, entity.route)) + ', ' + entity.name + 'Routes);')
    : [];
  const middleware = [];

  if (spec.app.express.trustProxy !== false) middleware.push('app.set("trust proxy", ' + js(spec.app.express.trustProxy) + ');');
  if (spec.app.production.securityHeaders) {
    middleware.push("app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });");
  }
  if (spec.app.production.requestId) {
    middleware.push("app.use((req, res, next) => { req.id = req.id || req.headers['x-request-id'] || crypto.randomUUID(); res.setHeader('X-Request-Id', req.id); next(); });");
  }
  if (spec.app.production.cors.enabled) middleware.push('app.use(cors({origin: ' + js(spec.app.production.cors.origin) + '}));');
  if (spec.app.production.rateLimit.enabled) {
    middleware.push('app.use(rateLimit({windowMs: ' + spec.app.production.rateLimit.windowMs + ', limit: ' + spec.app.production.rateLimit.max + ', standardHeaders: true, legacyHeaders: false}));');
  }
  if (spec.app.production.compression) middleware.push('app.use(compression());');
  if (spec.app.express.json.enabled) middleware.push('app.use(express.json({limit: ' + js(spec.app.express.json.limit) + '}));');
  if (spec.app.express.urlencoded.enabled) middleware.push('app.use(express.urlencoded({extended: ' + spec.app.express.urlencoded.extended + ', limit: ' + js(spec.app.express.urlencoded.limit) + '}));');
  spec.app.middlewareModules.forEach((unused, index) => middleware.push('app.use(customMiddleware' + index + ');'));

  const health = spec.app.health.enabled
    ? ['app.get(' + js(spec.app.health.path) + ', (req, res) => res.status(' + spec.app.health.status + ').json(' + js(spec.app.health.response) + '));']
    : [];

  return [
    "'use strict';", '',
    "const express = require('express');",
    ...prodImports,
    'const errorHandler = require(' + js(relativeRequire(appPath, filePaths(spec).errorHandler)) + ');',
    ...(spec.observability.enabled ? ['const observability = require(' + js(relativeRequire(appPath, filePaths(spec).observability)) + ');'] : []),
    ...(spec.storage.enabled ? ['const storage = require(' + js(relativeRequire(appPath, filePaths(spec).storage)) + ');'] : []),
    ...(spec.api.graphql.enabled ? ['const graphqlApi = require(' + js(relativeRequire(appPath, filePaths(spec).graphql)) + ');'] : []),
    ...imports,
    ...middlewareImports, '',
    'const app = express();', '',
    ...(spec.observability.enabled ? ['app.use(observability.requestMiddleware);'] : []),
    ...middleware,
    ...health,
    ...(spec.observability.health.liveness.enabled ? [
      'app.get(' + js(spec.observability.health.liveness.path) + ', observability.livenessHandler);'
    ] : []),
    ...(spec.observability.health.readiness.enabled ? [
      'app.get(' + js(spec.observability.health.readiness.path) + ', observability.readinessHandler);'
    ] : []),
    ...(spec.observability.metrics.enabled ? [
      'app.get(' + js(spec.observability.metrics.path) + ', observability.metricsHandler);'
    ] : []),
    ...(spec.storage.enabled && spec.storage.provider === 'local' && spec.storage.signedUrls.enabled ? [
      'app.get(' + js(spec.storage.signedUrls.path) + ', storage.downloadHandler);'
    ] : []),
    ...(spec.auth.routesEnabled ? ['app.use(AuthRoutes);'] : []),
    ...(spec.api.graphql.enabled ? [
      'app.all(' + js(spec.api.graphql.path) + ', ' +
        (spec.app.express.json.enabled ? '' : 'express.json({limit: ' + js(spec.app.express.json.limit) + '}), ') +
        'graphqlApi.handler);'
    ] : []),
    ...mounts,
    ...(spec.api.rest && spec.endpoints.length ? ['app.use(' + js(spec.app.apiPrefix || '/') + ', CustomRoutes);'] : []), '',
    'app.use((req, res) => res.status(' + spec.app.statusCodes.notFound + ').json(' + payload(spec.app.responses.notFound) + '));',
    'app.use(errorHandler);', '',
    'module.exports = app;', ''
  ].join('\n');
}

module.exports = appSource;
