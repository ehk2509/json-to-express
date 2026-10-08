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
  workflows: 'workflows',
  graphql: 'graphql',
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

function humanize(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
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
  const apiConfig = spec.api || {};
  const rawGraphql = apiConfig.graphql;
  const graphqlConfig = typeof rawGraphql === 'boolean' ? {enabled: rawGraphql} : (rawGraphql || {});
  const graphqlEnabled = valueOr(graphqlConfig.enabled, false);
  const openapi = spec.docs && spec.docs.openapi || {};
  const outboxConfig = spec.outbox || {};
  const deployment = spec.deployment || {};
  const sdkConfig = spec.sdk || {};
  const adminConfig = spec.admin || {};
  const dockerConfig = deployment.docker || {};
  const composeConfig = deployment.compose || {};
  const kubernetesConfig = deployment.kubernetes || {};
  const prismaSchemaPath = valueOr(spec.database.prisma && spec.database.prisma.schemaPath, 'prisma/schema.prisma');
  const databaseType = spec.database.type;
  const isMongo = databaseType === 'mongodb';
  const isPostgres = databaseType === 'postgresql';
  const hasAsyncWork = Object.keys(spec.events || {}).length > 0 || Object.keys(spec.jobs || {}).length > 0;

  const dependencies = {
    dotenv: '^16.4.5',
    express: '^4.21.1',
    ...(isMongo ? {mongoose: '^8.8.0'} : {}),
    ...(isPostgres ? {'@prisma/client': '^6.16.2'} : {}),
    ...(authEnabled ? {jsonwebtoken: '^9.0.2'} : {}),
    ...(graphqlEnabled ? {
      graphql: '^16.10.0',
      '@graphql-tools/schema': '^10.0.21',
      dataloader: '^2.2.3'
    } : {}),
    ...(valueOr(cors.enabled, false) ? {cors: '^2.8.5'} : {}),
    ...(valueOr(rateLimit.enabled, false) ? {'express-rate-limit': '^7.4.1'} : {}),
    ...(valueOr(production.compression, false) ? {compression: '^1.7.5'} : {}),
    ...(packageConfig.dependencies || {})
  };
  const devDependencies = {
    supertest: '^7.0.0',
    ...(isPostgres ? {prisma: '^6.16.2'} : {}),
    ...(packageConfig.devDependencies || {})
  };

  const normalized = {
    specVersion: spec.specVersion,
    generation: {outputDir: generation.outputDir, paths},
    api: {
      rest: valueOr(apiConfig.rest, true),
      graphql: {
        enabled: graphqlEnabled,
        path: normalizePrefix(valueOr(graphqlConfig.path, '/graphql'))
      }
    },
    admin: {
      enabled: valueOr(adminConfig.enabled, false),
      outputDir: valueOr(adminConfig.outputDir, 'admin'),
      title: valueOr(adminConfig.title, spec.app.name.trim() + ' Admin'),
      baseUrl: valueOr(adminConfig.baseUrl, valueOr(sdkConfig.baseUrl, 'http://127.0.0.1:' + valueOr(spec.app.port, 3000))),
      devPort: valueOr(adminConfig.devPort, 5173),
      includeCustomActions: valueOr(adminConfig.includeCustomActions, true),
      auth: {
        tokenStorage: valueOr(adminConfig.auth && adminConfig.auth.tokenStorage, 'localStorage'),
        tokenKey: valueOr(adminConfig.auth && adminConfig.auth.tokenKey, 'j2e-admin-token')
      },
      theme: {
        brandColor: valueOr(adminConfig.theme && adminConfig.theme.brandColor, '#2563eb'),
        mode: valueOr(adminConfig.theme && adminConfig.theme.mode, 'system')
      },
      entities: []
    },
    sdk: {
      enabled: valueOr(sdkConfig.enabled, false),
      outputDir: valueOr(sdkConfig.outputDir, 'sdk'),
      languages: valueOr(sdkConfig.languages, ['javascript', 'typescript']),
      packageName: valueOr(sdkConfig.packageName, generatedName + '-client'),
      private: valueOr(sdkConfig.private, true),
      baseUrl: valueOr(sdkConfig.baseUrl, 'http://127.0.0.1:' + valueOr(spec.app.port, 3000)),
      includeCustomEndpoints: valueOr(sdkConfig.includeCustomEndpoints, true)
    },
    deployment: {
      docker: {
        enabled: valueOr(dockerConfig.enabled, false),
        nodeImage: valueOr(dockerConfig.nodeImage, 'node:22-alpine'),
        file: valueOr(dockerConfig.file, 'Dockerfile'),
        ignoreFile: valueOr(dockerConfig.ignoreFile, '.dockerignore'),
        healthcheck: valueOr(dockerConfig.healthcheck, true)
      },
      compose: {
        enabled: valueOr(composeConfig.enabled, false),
        file: valueOr(composeConfig.file, 'docker-compose.yml'),
        database: valueOr(composeConfig.database, true),
        apiPort: valueOr(composeConfig.apiPort, valueOr(spec.app.port, 3000))
      },
      kubernetes: {
        enabled: valueOr(kubernetesConfig.enabled, false),
        directory: valueOr(kubernetesConfig.directory, 'deploy/k8s'),
        image: valueOr(kubernetesConfig.image, generatedName + ':latest'),
        replicas: valueOr(kubernetesConfig.replicas, 2),
        serviceType: valueOr(kubernetesConfig.serviceType, 'ClusterIP'),
        servicePort: valueOr(kubernetesConfig.servicePort, 80),
        resources: kubernetesConfig.resources || {}
      }
    },
    auth: {
      enabled: authEnabled,
      strategy: 'jwt',
      secretEnv: valueOr(auth.secretEnv, 'JWT_SECRET'),
      algorithms: auth.algorithms || ['HS256'],
      userClaim: valueOr(auth.userClaim, 'sub'),
      rolesClaim: valueOr(auth.rolesClaim, 'roles')
    },
    environment: spec.environment || {},
    outbox: {
      enabled: hasAsyncWork,
      worker: valueOr(outboxConfig.worker, 'embedded'),
      pollIntervalMs: valueOr(outboxConfig.pollIntervalMs, 500),
      batchSize: valueOr(outboxConfig.batchSize, 20),
      lockTimeoutMs: valueOr(outboxConfig.lockTimeoutMs, 30000),
      maxAttempts: valueOr(outboxConfig.maxAttempts, 5),
      backoffMs: valueOr(outboxConfig.backoffMs, 1000)
    },
    docs: {
      openapi: {
        enabled: valueOr(openapi.enabled, valueOr(apiConfig.rest, true)),
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
          ...(isPostgres ? {
            'prisma:generate': 'prisma generate --schema ' + prismaSchemaPath,
            'db:push': 'prisma db push --schema ' + prismaSchemaPath
          } : {}),
          ...(hasAsyncWork ? {
            worker: 'node ' + path.posix.join(paths.source, paths.workflows, 'worker.js'),
            'worker:once': 'node ' + path.posix.join(paths.source, paths.workflows, 'worker.js') + ' --once',
            'outbox:retry': 'node ' + path.posix.join(paths.source, paths.workflows, 'worker.js') + ' --retry-dead'
          } : {}),
          ...(packageConfig.scripts || {})
        },
        dependencies,
        devDependencies
      }
    },
    database: {
      type: databaseType,
      orm: isMongo ? 'mongoose' : 'prisma',
      idStrategy: valueOr(spec.database.idStrategy, isMongo ? 'objectId' : 'uuid'),
      uriEnv: valueOr(spec.database.uriEnv, isMongo ? 'MONGODB_URI' : 'DATABASE_URL'),
      defaultUri: valueOr(
        spec.database.defaultUri,
        isMongo
          ? 'mongodb://127.0.0.1:27017/' + generatedName
          : 'postgresql://postgres:postgres@127.0.0.1:5432/' + generatedName.replace(/-/g, '_')
      ),
      options: spec.database.options || {},
      prisma: {
        schemaPath: prismaSchemaPath
      }
    },
    workflows: Object.entries(spec.workflows || {}).map(([name, workflow]) => ({
      name,
      transaction: valueOr(workflow.transaction, false),
      steps: workflow.steps
    })),
    endpoints: Object.entries(spec.endpoints || {}).map(([name, endpoint]) => ({
      name,
      method: endpoint.method,
      path: endpoint.path,
      workflow: endpoint.workflow,
      status: valueOr(endpoint.status, 200),
      auth: normalizeAuthRule(endpoint.auth === undefined ? (authEnabled ? true : false) : endpoint.auth)
    })),
    events: Object.fromEntries(Object.entries(spec.events || {}).map(([name, event]) => [
      name,
      {
        webhooks: (event.webhooks || []).map(webhook => ({
          urlEnv: webhook.urlEnv,
          method: valueOr(webhook.method, 'post'),
          headers: webhook.headers || {},
          failure: valueOr(webhook.failure, 'continue')
        }))
      }
    ])),
    jobs: Object.fromEntries(Object.entries(spec.jobs || {}).map(([name, job]) => [
      name,
      {
        workflow: job.workflow,
        queue: valueOr(job.queue, 'default'),
        maxAttempts: valueOr(job.maxAttempts, valueOr(outboxConfig.maxAttempts, 5)),
        backoffMs: valueOr(job.backoffMs, valueOr(outboxConfig.backoffMs, 1000))
      }
    ])),
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

  const adminEntities = adminConfig.entities || {};
  normalized.admin.entities = normalized.entities.map(entity => {
    const configured = adminEntities[entity.name] || {};
    const configuredFields = configured.fields || {};
    const visibleFields = entity.fields.filter(field => !(configured.hiddenFields || []).includes(field.name));
    const firstString = visibleFields.find(field => field.type === 'string');
    const titleField = valueOr(configured.titleField, firstString ? firstString.name : (visibleFields[0] && visibleFields[0].name));

    return {
      name: entity.name,
      route: entity.route,
      label: valueOr(configured.label, humanize(entity.name)),
      pluralLabel: valueOr(configured.pluralLabel, humanize(pluralize(entity.name))),
      titleField,
      listFields: valueOr(configured.listFields, visibleFields.slice(0, 5).map(field => field.name)),
      filterFields: valueOr(configured.filterFields, entity.operations.list.query.filters),
      hiddenFields: configured.hiddenFields || [],
      readonlyFields: configured.readonlyFields || [],
      pageSize: valueOr(
        configured.pageSize,
        entity.operations.list.query.pagination.enabled
          ? entity.operations.list.query.pagination.defaultLimit
          : 20
      ),
      create: valueOr(configured.create, entity.operations.create.enabled),
      edit: valueOr(configured.edit, entity.operations.update.enabled),
      delete: valueOr(configured.delete, entity.operations.delete.enabled),
      fields: entity.fields.map(field => {
        const fieldConfig = configuredFields[field.name] || {};
        return {
          name: field.name,
          type: field.type,
          ref: field.ref,
          many: field.many,
          required: Boolean(field.required),
          enum: field.enum || [],
          min: field.min,
          max: field.max,
          minLength: field.minLength,
          maxLength: field.maxLength,
          default: field.default,
          label: valueOr(fieldConfig.label, humanize(field.name)),
          help: valueOr(fieldConfig.help, ''),
          placeholder: valueOr(fieldConfig.placeholder, ''),
          widget: valueOr(fieldConfig.widget, 'auto'),
          hidden: valueOr(fieldConfig.hidden, (configured.hiddenFields || []).includes(field.name)),
          readonly: valueOr(fieldConfig.readonly, (configured.readonlyFields || []).includes(field.name))
        };
      })
    };
  });

  return normalized;
}

module.exports = {DEFAULT_PATHS, defaultRoute, normalizeSpec, packageName, pluralize};
