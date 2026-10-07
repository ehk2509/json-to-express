'use strict';

const path = require('node:path');
const {validateSpec} = require('./validate-spec');

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
    enabled: true,
    method: 'get',
    path: '/',
    status: 200,
    lean: true,
    query: {
      filters: [],
      sortParam: 'sort',
      selectParam: 'select',
      pagination: {
        enabled: false,
        pageParam: 'page',
        limitParam: 'limit',
        defaultLimit: 20,
        maxLimit: 100
      }
    }
  },
  get: {enabled: true, method: 'get', path: '/:id', status: 200, notFoundStatus: 404, lean: true, selectParam: 'select'},
  create: {enabled: true, method: 'post', path: '/', status: 201},
  update: {enabled: true, method: 'patch', path: '/:id', status: 200, notFoundStatus: 404, runValidators: true},
  delete: {enabled: true, method: 'delete', path: '/:id', status: 204, notFoundStatus: 404}
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
  const configured = generation && generation.paths || {};
  return {...DEFAULT_PATHS, ...configured};
}

function normalizeOperation(name, value, idParam) {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_OPERATIONS[name]));
  if (defaults.path.includes(':id') && idParam !== 'id') defaults.path = defaults.path.replace(':id', ':' + idParam);

  if (typeof value === 'boolean') return {...defaults, enabled: value};
  const configured = value || {};
  const operation = {...defaults, ...configured};

  if (name === 'list') {
    const query = configured.query || {};
    const pagination = query.pagination || {};
    operation.query = {
      ...defaults.query,
      ...query,
      filters: valueOr(query.filters, defaults.query.filters),
      pagination: {...defaults.query.pagination, ...pagination}
    };
  }

  return operation;
}

function normalizeSpec(spec) {
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
  const generatedName = packageConfig.name || packageName(spec.app.name);
  const serverFile = path.posix.join(paths.source, 'server.js');

  return {
    generation: {
      outputDir: generation.outputDir,
      paths
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
      express: {
        trustProxy: valueOr(expressConfig.trustProxy, false),
        json: {
          enabled: valueOr(jsonConfig.enabled, true),
          limit: valueOr(jsonConfig.limit, valueOr(spec.app.bodyLimit, '1mb'))
        },
        urlencoded: {
          enabled: valueOr(urlencodedConfig.enabled, false),
          extended: valueOr(urlencodedConfig.extended, true),
          limit: valueOr(urlencodedConfig.limit, '1mb')
        }
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
        dependencies: {
          dotenv: '^16.4.5',
          express: '^4.21.1',
          mongoose: '^8.8.0',
          ...(packageConfig.dependencies || {})
        },
        devDependencies: {
          supertest: '^7.0.0',
          ...(packageConfig.devDependencies || {})
        }
      }
    },
    database: {
      type: 'mongodb',
      uriEnv: valueOr(spec.database.uriEnv, 'MONGODB_URI'),
      defaultUri: valueOr(spec.database.defaultUri, 'mongodb://127.0.0.1:27017/' + generatedName),
      options: spec.database.options || {}
    },
    entities: Object.entries(spec.entities).map(([name, entity]) => {
      const idParam = valueOr(entity.idParam, 'id');
      const operations = {};
      for (const operationName of Object.keys(DEFAULT_OPERATIONS)) {
        operations[operationName] = normalizeOperation(
          operationName,
          entity.operations && entity.operations[operationName],
          idParam
        );
      }

      return {
        name,
        route: valueOr(entity.route, defaultRoute(name)),
        collection: entity.collection,
        idParam,
        notFoundResponse: valueOr(entity.notFoundResponse, name + ' not found'),
        schemaOptions: {
          timestamps: true,
          versionKey: false,
          ...(entity.schemaOptions || {})
        },
        operations,
        fields: Object.entries(entity.fields).map(([fieldName, field]) => ({
          name: fieldName,
          type: field.type,
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
    })
  };
}

module.exports = {DEFAULT_PATHS, defaultRoute, normalizeSpec, packageName, pluralize};
