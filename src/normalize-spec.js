'use strict';

const path = require('node:path');
const {validateSpec} = require('./validate-spec');
const {upgradeSpec} = require('./spec-version');

const DEFAULT_PATHS = {
  source: 'src',
  models: 'models',
  controllers: 'controllers',
  routes: 'routes',
  config: 'config',
  middleware: 'middleware',
  tests: 'test'
};

const DEFAULT_OPERATIONS = {
  list: {
    enabled: true, method: 'get', path: '/', status: 200, lean: true,
    auth: false, validate: true, populate: [], transaction: false,
    query: {
      filters: [], operators: ['eq'], sortParam: 'sort', selectParam: 'select',
      pagination: {enabled: false, pageParam: 'page', limitParam: 'limit', defaultLimit: 20, maxLimit: 100}
    }
  },
  get: {
    enabled: true, method: 'get', path: '/:id', status: 200, notFoundStatus: 404,
    lean: true, selectParam: 'select', auth: false, validate: true, populate: [], transaction: false
  },
  create: {enabled: true, method: 'post', path: '/', status: 201, auth: false, validate: true, populate: [], transaction: false},
  update: {
    enabled: true, method: 'patch', path: '/:id', status: 200, notFoundStatus: 404,
    runValidators: true, auth: false, validate: true, populate: [], transaction: false
  },
  delete: {
    enabled: true, method: 'delete', path: '/:id', status: 204, notFoundStatus: 404,
    auth: false, validate: true, populate: [], transaction: false
  }
};

function pluralize(value) {
  if (/[^aeiou]y$/i.test(value)) return value.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(value)) return value + 'es';
  return value + 's';
}

function defaultRoute(entityName) {
  return pluralize(entityName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());
}

function packageName(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'generated-express-app';
}

function normalizePrefix(value) {
  if (value === '/') return '';
  return value.replace(/\/$/, '');
}

function valueOr(value, fallback) {
  return value === undefined ? fallback : value;
}

function normalizePaths(generation) {
  return {...DEFAULT_PATHS, ...((generation && generation.paths) || {})};
}

function normalizeAuthRule(value) {
  if (value === false || value === undefined) return {required: false, roles: []};
  if (value === true) return {required: true, roles: []};
  return {
    required: valueOr(value.required, true),
    roles: value.roles || []
  };
}

function normalizeOperation(name, value, idParam, authEnabled) {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_OPERATIONS[name]));
  if (defaults.path.includes(':id') && idParam !== 'id') defaults.path = defaults.path.replace(':id', ':' + idParam);

  if (typeof value === 'boolean') return {...defaults, enabled: value};
  const configured = value || {};
  const operation = {...defaults, ...configured};

  if (name === 'list') {
    const query = configured.query || {};
    operation.query = {
      ...defaults.query,
      ...query,
      filters: valueOr(query.filters, defaults.query.filters),
      operators: valueOr(query.operators, defaults.query.operators),
      pagination: {...defaults.query.pagination, ...(query.pagination || {})}
    };
  }

  operation.auth = normalizeAuthRule(configured.auth === undefined ? (authEnabled ? true : false) : configured.auth);
  operation.populate = configured.populate || [];
  operation.validate = valueOr(configured.validate, true);
  operation.transaction = valueOr(configured.transaction, false);
  return operation;
}

function normalizeSpec(inputSpec) {
  const spec = upgradeSpec(inputSpec);
  validateSpec(spec);

  const generation = spec.generation || {};
  const paths = normalizePaths(generation);
  const packageConfig = spec.app.package || {};
  const health = spec.app.health || {};
  const responses = spec.app.responses || {};
  const statusCodes = spec.app.statusCodes || {};
  const expressConfig = spec.app.express || {};
  const jsonConfig = expressConfig.json || {};
  const urlencodedConfig = expressConfig.urlencoded || {};
  const production = spec.app.production || {};
  const cors = production.cors || {};
  const rateLimit = production.rateLimit || {};
  const generatedName = packageConfig.name || packageName(spec.app.name);
  const serverFile = path.posix.join(paths.source, 'server.js');
  const auth = spec.auth || {};
  const authEnabled = valueOr(auth.enabled, false);
  const openapi = spec.docs && spec.docs.openapi || {};

  const dependencies = {
    dotenv: '^16.4.5',
    express: '^4.21.1',
    mongoose: '^8.8.0',
    ...(authEnabled ? {jsonwebtoken: '^9.0.2'} : {}),
    ...(valueOr(cors.enabled, false) ? {cors: '^2.8.5'} : {}),
    ...(valueOr(rateLimit.enabled, false) ? {'express-rate-limit': '^7.4.1'} : {}),
    ...(valueOr(production.compression, false) ? {compression: '^1.7.5'} : {}),
    ...(packageConfig.dependencies || {})
  };

  const normalized = {
    specVersion: spec.specVersion,
    generation: {outputDir: generation.outputDir, paths},
    auth: {
      enabled: authEnabled,
      strategy: 'jwt',
      secretEnv: valueOr(auth.secretEnv, 'JWT_SECRET'),
      algorithms: auth.algorithms || ['HS256'],
      userClaim: valueOr(auth.userClaim, 'sub'),
      rolesClaim: valueOr(auth.rolesClaim, 'roles')
    },
    environment: spec.environment || {},
    docs: {
      openapi: {
        enabled: valueOr(openapi.enabled, true),
        file: valueOr(openapi.file, 'openapi.json'),
        title: valueOr(openapi.title, spec.app.name.trim()),
        version: valueOr(openapi.version, packageConfig.version || '0.1.0')
      }
    },
    app: {
      name: spec.app.name.trim(),
      packageName: generatedName,
      port: valueOr(spec.app.port, 3000),
      portEnv: valueOr(spec.app.portEnv, 'PORT'),
      host: valueOr(spec.app.host, '0.0.0.0'),
      hostEnv: valueOr(spec.app.hostEnv, 'HOST'),
      startupMessage: valueOr(spec.app.startupMessage, spec.app.name.trim() + ' listening on {host}:{port}'),
      apiPrefix: normalizePrefix(valueOr(spec.app.apiPrefix, '/api')),
      health: {
        enabled: valueOr(health.enabled, true),
        path: valueOr(health.path, '/health'),
        status: valueOr(health.status, 200),
        response: valueOr(health.response, {status: 'ok'})
      },
      middlewareModules: spec.app.middlewareModules || [],
      express: {
        trustProxy: valueOr(expressConfig.trustProxy, false),
        json: {enabled: valueOr(jsonConfig.enabled, true), limit: valueOr(jsonConfig.limit, valueOr(spec.app.bodyLimit, '1mb'))},
        urlencoded: {
          enabled: valueOr(urlencodedConfig.enabled, false),
          extended: valueOr(urlencodedConfig.extended, true),
          limit: valueOr(urlencodedConfig.limit, '1mb')
        }
      },
      production: {
        requestId: valueOr(production.requestId, true),
        securityHeaders: valueOr(production.securityHeaders, true),
        cors: {enabled: valueOr(cors.enabled, false), origin: valueOr(cors.origin, '*')},
        rateLimit: {
          enabled: valueOr(rateLimit.enabled, false),
          windowMs: valueOr(rateLimit.windowMs, 60000),
          max: valueOr(rateLimit.max, 100)
        },
        compression: valueOr(production.compression, false)
      },
      responses: {
        notFound: valueOr(responses.notFound, 'Route not found'),
        validationError: valueOr(responses.validationError, 'Validation failed'),
        invalidIdentifier: valueOr(responses.invalidIdentifier, 'Invalid identifier'),
        uniqueConstraint: valueOr(responses.uniqueConstraint, 'Unique constraint violated'),
        internalError: valueOr(responses.internalError, 'Internal server error')
      },
      statusCodes: {
        notFound: valueOr(statusCodes.notFound, 404),
        validationError: valueOr(statusCodes.validationError, 400),
        invalidIdentifier: valueOr(statusCodes.invalidIdentifier, 400),
        uniqueConstraint: valueOr(statusCodes.uniqueConstraint, 409),
        internalError: valueOr(statusCodes.internalError, 500)
      },
      package: {
        name: generatedName,
        version: valueOr(packageConfig.version, '0.1.0'),
        private: valueOr(packageConfig.private, true),
        description: valueOr(packageConfig.description, 'Generated by json-to-express'),
        nodeEngine: valueOr(packageConfig.nodeEngine, '>=18'),
        main: valueOr(packageConfig.main, serverFile),
        scripts: {
          start: 'node ' + serverFile,
          dev: 'node --watch ' + serverFile,
          test: 'node --test',
          ...(packageConfig.scripts || {})
        },
        dependencies,
        devDependencies: {supertest: '^7.0.0', ...(packageConfig.devDependencies || {})}
      }
    },
    database: {
      type: 'mongodb',
      uriEnv: valueOr(spec.database.uriEnv, 'MONGODB_URI'),
      defaultUri: valueOr(spec.database.defaultUri, 'mongodb://127.0.0.1:27017/' + generatedName),
      options: spec.database.options || {}
    },
    entities: []
  };

  normalized.entities = Object.entries(spec.entities).map(([name, entity]) => {
    const idParam = valueOr(entity.idParam, 'id');
    const operations = {};
    for (const operationName of Object.keys(DEFAULT_OPERATIONS)) {
      operations[operationName] = normalizeOperation(
        operationName,
        entity.operations && entity.operations[operationName],
        idParam,
        authEnabled
      );
    }

    const softDelete = entity.softDelete || {};
    const audit = entity.audit || {};

    return {
      name,
      route: valueOr(entity.route, defaultRoute(name)),
      collection: entity.collection,
      idParam,
      notFoundResponse: valueOr(entity.notFoundResponse, name + ' not found'),
      hooks: entity.hooks || null,
      indexes: entity.indexes || [],
      softDelete: {
        enabled: valueOr(softDelete.enabled, false),
        field: valueOr(softDelete.field, 'deletedAt')
      },
      audit: {
        enabled: valueOr(audit.enabled, false),
        createdBy: valueOr(audit.createdBy, 'createdBy'),
        updatedBy: valueOr(audit.updatedBy, 'updatedBy')
      },
      schemaOptions: {timestamps: true, versionKey: false, ...(entity.schemaOptions || {})},
      operations,
      fields: Object.entries(entity.fields).map(([fieldName, field]) => ({
        name: fieldName,
        type: field.type,
        ref: field.ref,
        many: valueOr(field.many, false),
        onDelete: valueOr(field.onDelete, 'restrict'),
        required: field.required,
        unique: field.unique,
        enum: field.enum,
        min: field.min,
        max: field.max,
        minLength: field.minLength,
        maxLength: field.maxLength,
        default: field.default,
        options: field.options || {}
      }))
    };
  });

  return normalized;
}

module.exports = {DEFAULT_PATHS, defaultRoute, normalizeSpec, packageName, pluralize};
