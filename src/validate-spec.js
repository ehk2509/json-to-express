'use strict';

const path = require('node:path');
const {validateSchema} = require('./schema-validator');
const {upgradeSpec} = require('./spec-version');

class SpecificationError extends Error {
  constructor(errors) {
    super('Invalid application specification:\n- ' + errors.join('\n- '));
    this.name = 'SpecificationError';
    this.errors = errors;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRelativePath(errors, value, fieldPath) {
  if (value === undefined) return;
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    errors.push(fieldPath + ' must be a safe relative path without ".."');
  }
}

function visitWorkflowValue(value, visitor) {
  if (typeof value === 'string') {
    visitor(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => visitWorkflowValue(item, visitor));
    return;
  }
  if (isObject(value)) {
    Object.values(value).forEach(item => visitWorkflowValue(item, visitor));
  }
}

function validateWorkflowReference(errors, value, workflowName, stepName, knownSteps) {
  if (!value.startsWith('$') || value.startsWith('$$')) return;
  const root = value.split('.')[0];
  if (['$body', '$params', '$query', '$auth'].includes(root)) return;
  if (root === '$steps') {
    const parts = value.split('.');
    if (parts.length < 3 || !knownSteps.has(parts[1])) {
      errors.push('workflows.' + workflowName + '.steps.' + stepName + ' references an unavailable prior step in "' + value + '"');
    }
    return;
  }
  errors.push('workflows.' + workflowName + '.steps.' + stepName + ' has unsupported reference root in "' + value + '"');
}
function validateSpec(inputSpec) {
  const spec = upgradeSpec(inputSpec);
  const errors = validateSchema(spec);

  if (!isObject(spec)) {
    throw new SpecificationError(errors.length ? errors : ['root must be a JSON object']);
  }

  if (spec.generation && spec.generation.paths) {
    for (const [key, value] of Object.entries(spec.generation.paths)) {
      validateRelativePath(errors, value, 'generation.paths.' + key);
    }
  }

  const rawGraphql = spec.api && spec.api.graphql;
  const graphqlEnabled = rawGraphql === true || (isObject(rawGraphql) && rawGraphql.enabled !== false);
  const graphqlPath = isObject(rawGraphql) && rawGraphql.path || '/graphql';
  if (spec.api && spec.api.rest === false && !graphqlEnabled) {
    errors.push('api must enable at least one of rest or graphql');
  }
  if (
    graphqlEnabled && spec.app && spec.app.health && spec.app.health.enabled !== false &&
    graphqlPath === spec.app.health.path
  ) {
    errors.push('api.graphql.path cannot be the same as app.health.path');
  }

  const hasFileFields = isObject(spec.entities) && Object.values(spec.entities).some(entity =>
    isObject(entity) && isObject(entity.fields) && Object.values(entity.fields).some(field => isObject(field) && field.type === 'file')
  );
  if (spec.storage && (spec.storage.enabled !== false || hasFileFields)) {
    const storage = spec.storage;
    const signed = storage.signedUrls || {};
    const downloadPath = signed.path || '/files/:token';
    if (signed.enabled !== false && !downloadPath.includes(':token')) {
      errors.push('storage.signedUrls.path must contain :token');
    }
    if (storage.provider === 'local' && storage.local && storage.local.directory) {
      validateRelativePath(errors, storage.local.directory, 'storage.local.directory');
    }
  }

  if (spec.observability && spec.observability.enabled === true) {
    const observability = spec.observability;
    const metrics = observability.metrics || {};
    const health = observability.health || {};
    const liveness = health.liveness || {};
    const readiness = health.readiness || {};
    const observabilityPaths = [];
    if (metrics.enabled !== false) observabilityPaths.push(['observability.metrics.path', metrics.path || '/metrics']);
    if (liveness.enabled !== false) observabilityPaths.push(['observability.health.liveness.path', liveness.path || '/health/live']);
    if (readiness.enabled !== false) observabilityPaths.push(['observability.health.readiness.path', readiness.path || '/health/ready']);

    const occupied = new Map();
    if (spec.app && spec.app.health && spec.app.health.enabled !== false) {
      occupied.set(spec.app.health.path || '/health', 'app.health.path');
    }
    if (graphqlEnabled) occupied.set(graphqlPath, 'api.graphql.path');

    const auth = spec.auth || {};
    if (auth.enabled === true) {
      const local = auth.local || {};
      const jwt = auth.jwt || {};
      const refresh = jwt.refresh || {};
      const oidc = auth.oidc || {};
      if (local.enabled === true) {
        if (local.allowRegistration !== false) occupied.set(local.registerPath || '/auth/register', 'auth.local.registerPath');
        occupied.set(local.loginPath || '/auth/login', 'auth.local.loginPath');
        occupied.set(local.logoutPath || '/auth/logout', 'auth.local.logoutPath');
        occupied.set(local.forgotPasswordPath || '/auth/forgot-password', 'auth.local.forgotPasswordPath');
        occupied.set(local.resetPasswordPath || '/auth/reset-password', 'auth.local.resetPasswordPath');
      }
      if (refresh.enabled === true) occupied.set(refresh.path || '/auth/refresh', 'auth.jwt.refresh.path');
      if (oidc.enabled === true) {
        occupied.set(oidc.loginPath || '/auth/oidc/login', 'auth.oidc.loginPath');
        occupied.set(oidc.callbackPath || '/auth/oidc/callback', 'auth.oidc.callbackPath');
      }
    }

    const seen = new Map();
    for (const [label, routePath] of observabilityPaths) {
      if (seen.has(routePath)) errors.push(label + ' duplicates observability route ' + routePath);
      else seen.set(routePath, label);
      if (occupied.has(routePath)) errors.push(label + ' cannot be the same as ' + occupied.get(routePath));
      if (spec.app && routePath === spec.app.apiPrefix) errors.push(label + ' cannot be the same as app.apiPrefix');
    }
  }

  if (isObject(spec.entities)) {
    for (const [entityName, entity] of Object.entries(spec.entities)) {
      for (const [operationName, operation] of Object.entries(entity && entity.operations || {})) {
        if (!isObject(operation) || operation.cache === undefined || operation.cache === false) continue;
        const cacheEnabled = operation.cache === true || (isObject(operation.cache) && operation.cache.enabled !== false);
        if (!cacheEnabled) continue;
        if (!spec.cache || spec.cache.enabled !== true) {
          errors.push('entities.' + entityName + '.operations.' + operationName + '.cache requires top-level cache.enabled');
        }
        if (!['list', 'get'].includes(operationName)) {
          errors.push('entities.' + entityName + '.operations.' + operationName + '.cache can only be enabled for list/get operations');
        }
      }
    }
  }

  if (spec.cache && spec.cache.enabled === true && (spec.cache.provider || 'memory') === 'memory') {
    const hasAsyncWork =
      (isObject(spec.events) && Object.keys(spec.events).length > 0) ||
      (isObject(spec.jobs) && Object.keys(spec.jobs).length > 0);
    const workerMode = spec.outbox && spec.outbox.worker || 'embedded';
    if (hasAsyncWork && workerMode === 'separate') {
      errors.push('cache.provider "memory" cannot be used with outbox.worker "separate"; use redis for cross-process invalidation');
    }
    if (spec.deployment && spec.deployment.kubernetes && spec.deployment.kubernetes.enabled === true) {
      const replicas = spec.deployment.kubernetes.replicas === undefined ? 2 : spec.deployment.kubernetes.replicas;
      if (replicas > 1) {
        errors.push('cache.provider "memory" cannot be used with multiple Kubernetes replicas; use redis for distributed cache coherence');
      }
    }
  }

  if (spec.database && spec.database.prisma && spec.database.prisma.schemaPath) {
    validateRelativePath(errors, spec.database.prisma.schemaPath, 'database.prisma.schemaPath');
  }

  if (spec.sdk && spec.sdk.outputDir) {
    validateRelativePath(errors, spec.sdk.outputDir, 'sdk.outputDir');
  }
  if (spec.admin && spec.admin.outputDir) {
    validateRelativePath(errors, spec.admin.outputDir, 'admin.outputDir');
  }

  if (spec.admin && spec.admin.entities) {
    for (const [entityName, adminEntity] of Object.entries(spec.admin.entities)) {
      const entity = spec.entities && spec.entities[entityName];
      if (!entity) {
        errors.push('admin.entities.' + entityName + ' references unknown entity');
        continue;
      }
      const fields = new Set(Object.keys(entity.fields || {}));
      const listFilters = new Set(
        entity.operations && entity.operations.list && entity.operations.list.query && entity.operations.list.query.filters || []
      );
      const checkFields = (names, label) => {
        for (const fieldName of names || []) {
          if (!fields.has(fieldName)) errors.push('admin.entities.' + entityName + '.' + label + ' references unknown field ' + fieldName);
        }
      };
      if (adminEntity.titleField && !fields.has(adminEntity.titleField)) {
        errors.push('admin.entities.' + entityName + '.titleField references unknown field ' + adminEntity.titleField);
      }
      checkFields(adminEntity.listFields, 'listFields');
      checkFields(adminEntity.hiddenFields, 'hiddenFields');
      checkFields(adminEntity.readonlyFields, 'readonlyFields');
      checkFields(adminEntity.filterFields, 'filterFields');
      for (const fieldName of adminEntity.filterFields || []) {
        if (!listFilters.has(fieldName)) {
          errors.push('admin.entities.' + entityName + '.filterFields field ' + fieldName + ' is not allowed by operations.list.query.filters');
        }
      }
      for (const fieldName of Object.keys(adminEntity.fields || {})) {
        if (!fields.has(fieldName)) errors.push('admin.entities.' + entityName + '.fields references unknown field ' + fieldName);
      }
      const operationEnabled = operation => {
        if (operation === undefined) return true;
        if (typeof operation === 'boolean') return operation;
        return operation.enabled !== false;
      };
      const operations = entity.operations || {};
      if (adminEntity.create === true && !operationEnabled(operations.create)) {
        errors.push('admin.entities.' + entityName + '.create cannot be enabled when create operation is disabled');
      }
      if (adminEntity.edit === true && !operationEnabled(operations.update)) {
        errors.push('admin.entities.' + entityName + '.edit cannot be enabled when update operation is disabled');
      }
      if (adminEntity.delete === true && !operationEnabled(operations.delete)) {
        errors.push('admin.entities.' + entityName + '.delete cannot be enabled when delete operation is disabled');
      }

      const pagination = operations.list && typeof operations.list === 'object' &&
        operations.list.query && operations.list.query.pagination;
      if (
        adminEntity.pageSize !== undefined &&
        pagination && pagination.enabled === true &&
        pagination.maxLimit !== undefined &&
        adminEntity.pageSize > pagination.maxLimit
      ) {
        errors.push('admin.entities.' + entityName + '.pageSize cannot exceed operations.list.query.pagination.maxLimit');
      }

      const hidden = new Set(adminEntity.hiddenFields || []);
      for (const fieldName of adminEntity.listFields || []) {
        if (hidden.has(fieldName)) {
          errors.push('admin.entities.' + entityName + '.listFields cannot include hidden field ' + fieldName);
        }
      }

      const readonly = new Set(adminEntity.readonlyFields || []);
      if (adminEntity.create !== false && operationEnabled(operations.create)) {
        for (const [fieldName, field] of Object.entries(entity.fields || {})) {
          const fieldAdmin = adminEntity.fields && adminEntity.fields[fieldName] || {};
          const isReadonly = readonly.has(fieldName) || fieldAdmin.readonly === true;
          if (isReadonly && field.required === true && field.default === undefined) {
            errors.push('admin.entities.' + entityName + ' cannot make required create field ' + fieldName + ' readonly without a default');
          }
        }
      }
    }
  }

  if (spec.deployment) {
    if (spec.deployment.docker) {
      validateRelativePath(errors, spec.deployment.docker.file, 'deployment.docker.file');
      validateRelativePath(errors, spec.deployment.docker.ignoreFile, 'deployment.docker.ignoreFile');
    }
    if (spec.deployment.compose) {
      validateRelativePath(errors, spec.deployment.compose.file, 'deployment.compose.file');
      if (spec.deployment.compose.enabled === true && (!spec.deployment.docker || spec.deployment.docker.enabled !== true)) {
        errors.push('deployment.compose.enabled requires deployment.docker.enabled');
      }
    }
    if (spec.deployment.kubernetes) {
      validateRelativePath(errors, spec.deployment.kubernetes.directory, 'deployment.kubernetes.directory');
    }
  }

  if (spec.app && Array.isArray(spec.app.middlewareModules)) {
    spec.app.middlewareModules.forEach((value, index) => {
      validateRelativePath(errors, value, 'app.middlewareModules[' + index + ']');
    });
  }

  if (spec.auth && spec.auth.enabled === true) {
    const auth = spec.auth;
    const inferredStrategies = [];
    if (auth.apiKey && auth.apiKey.enabled === true) inferredStrategies.push('apiKey');
    if (auth.session && auth.session.enabled === true) inferredStrategies.push('session');
    if (auth.oidc && auth.oidc.enabled === true) inferredStrategies.push('oidc');
    if (auth.jwt && auth.jwt.enabled === true) inferredStrategies.push('jwt');
    const strategies = auth.strategies || (auth.strategy ? [auth.strategy] : (inferredStrategies.length ? inferredStrategies : ['jwt']));
    const strategySet = new Set(strategies);

    if (auth.strategy && auth.strategies) {
      errors.push('auth.strategy and auth.strategies cannot both be configured');
    }
    if (strategySet.has('apiKey') && (!auth.apiKey || !Array.isArray(auth.apiKey.keys) || auth.apiKey.keys.length === 0)) {
      errors.push('auth.apiKey.keys must contain at least one key when apiKey strategy is enabled');
    }
    if (auth.apiKey && Array.isArray(auth.apiKey.keys)) {
      const seenKeyEnvs = new Set();
      for (const key of auth.apiKey.keys) {
        if (key && key.env) {
          if (seenKeyEnvs.has(key.env)) errors.push('auth.apiKey.keys contains duplicate env "' + key.env + '"');
          seenKeyEnvs.add(key.env);
        }
      }
    }

    const localEnabled = Boolean(auth.local && auth.local.enabled === true);
    const oidcEnabled = Boolean(auth.oidc && auth.oidc.enabled === true) || strategySet.has('oidc');
    const sessionEnabled = strategySet.has('session');
    const jwtEnabled = strategySet.has('jwt');
    const refreshEnabled = Boolean(auth.jwt && auth.jwt.refresh && auth.jwt.refresh.enabled === true);

    if (sessionEnabled && !localEnabled && !oidcEnabled) {
      errors.push('auth session strategy requires auth.local.enabled or auth.oidc.enabled so sessions can be issued');
    }
    if (localEnabled && !jwtEnabled && !sessionEnabled) {
      errors.push('auth.local.enabled requires jwt or session in auth strategies');
    }
    if (refreshEnabled && !jwtEnabled) {
      errors.push('auth.jwt.refresh.enabled requires jwt in auth strategies');
    }
    if (oidcEnabled) {
      if (!auth.oidc || !auth.oidc.issuer) errors.push('auth.oidc.issuer is required when OIDC is enabled');
      if (!auth.oidc || !auth.oidc.clientIdEnv) {
        // The normalizer supplies OIDC_CLIENT_ID, so the field may be omitted.
      }
    }
    if (
      auth.session && auth.session.sameSite === 'none' &&
      auth.session.secure === false
    ) {
      errors.push('auth.session.sameSite "none" requires auth.session.secure true');
    }

    const authPaths = [];
    if (localEnabled) {
      const local = auth.local;
      if (local.allowRegistration !== false) authPaths.push(['auth.local.registerPath', local.registerPath || '/auth/register']);
      authPaths.push(['auth.local.loginPath', local.loginPath || '/auth/login']);
      authPaths.push(['auth.local.logoutPath', local.logoutPath || '/auth/logout']);
      authPaths.push(['auth.local.forgotPasswordPath', local.forgotPasswordPath || '/auth/forgot-password']);
      authPaths.push(['auth.local.resetPasswordPath', local.resetPasswordPath || '/auth/reset-password']);
    }
    if (refreshEnabled) authPaths.push(['auth.jwt.refresh.path', auth.jwt.refresh.path || '/auth/refresh']);
    if (oidcEnabled) {
      authPaths.push(['auth.oidc.loginPath', auth.oidc.loginPath || '/auth/oidc/login']);
      authPaths.push(['auth.oidc.callbackPath', auth.oidc.callbackPath || '/auth/oidc/callback']);
    }
    const seenAuthPaths = new Map();
    for (const [label, routePath] of authPaths) {
      if (seenAuthPaths.has(routePath)) {
        errors.push(label + ' duplicates auth route ' + routePath);
      } else {
        seenAuthPaths.set(routePath, label);
      }
      if (spec.app && spec.app.health && spec.app.health.enabled !== false && routePath === spec.app.health.path) {
        errors.push(label + ' cannot be the same as app.health.path');
      }
      if (graphqlEnabled && routePath === graphqlPath) {
        errors.push(label + ' cannot be the same as api.graphql.path');
      }
    }

    const validateRuleStrategies = (rule, label) => {
      if (!isObject(rule) || !Array.isArray(rule.strategies)) return;
      for (const strategy of rule.strategies) {
        if (!strategySet.has(strategy)) errors.push(label + '.strategies references disabled auth strategy "' + strategy + '"');
      }
    };
    if (isObject(spec.entities)) {
      for (const [entityName, entity] of Object.entries(spec.entities)) {
        for (const [operationName, operation] of Object.entries(entity && entity.operations || {})) {
          if (isObject(operation)) validateRuleStrategies(operation.auth, 'entities.' + entityName + '.operations.' + operationName + '.auth');
        }
      }
    }
    if (isObject(spec.endpoints)) {
      for (const [endpointName, endpoint] of Object.entries(spec.endpoints)) {
        if (isObject(endpoint)) validateRuleStrategies(endpoint.auth, 'endpoints.' + endpointName + '.auth');
      }
    }
  }

  if (spec.auth && spec.auth.enabled === false && isObject(spec.entities)) {
    for (const [entityName, entity] of Object.entries(spec.entities)) {
      if (!isObject(entity) || !isObject(entity.operations)) continue;
      for (const [operationName, operation] of Object.entries(entity.operations)) {
        if (!isObject(operation) || operation.auth === undefined || operation.auth === false) continue;
        errors.push('entities.' + entityName + '.operations.' + operationName + '.auth requires top-level auth.enabled');
      }
    }
  }

  if (spec.database && spec.database.type === 'postgresql') {
    if (spec.database.idStrategy !== undefined && spec.database.idStrategy !== 'uuid') {
      errors.push('database.idStrategy must be "uuid" for postgresql');
    }
    if (spec.database.options && Object.keys(spec.database.options).length) {
      errors.push('database.options is only supported by the mongodb target');
    }
  }

  const entityNames = new Set(isObject(spec.entities) ? Object.keys(spec.entities) : []);
  if (graphqlEnabled && isObject(spec.entities)) {
    for (const [entityName, entity] of Object.entries(spec.entities)) {
      if (entity && entity.fields && Object.prototype.hasOwnProperty.call(entity.fields, 'id')) {
        errors.push('entities.' + entityName + '.fields.id is reserved by the GraphQL target');
      }
      for (const fieldName of Object.keys(entity && entity.fields || {})) {
        if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(fieldName) || fieldName.startsWith('__')) {
          errors.push('entities.' + entityName + '.fields.' + fieldName + ' is not a valid GraphQL field name');
        }
      }
    }
  }
  const workflowNames = new Set(isObject(spec.workflows) ? Object.keys(spec.workflows) : []);
  const eventNames = new Set(isObject(spec.events) ? Object.keys(spec.events) : []);
  const jobNames = new Set(isObject(spec.jobs) ? Object.keys(spec.jobs) : []);

  if (isObject(spec.endpoints)) {
    const routes = new Set();
    for (const [endpointName, endpoint] of Object.entries(spec.endpoints)) {
      if (!isObject(endpoint)) continue;
      if (endpoint.workflow && !workflowNames.has(endpoint.workflow)) {
        errors.push('endpoints.' + endpointName + '.workflow references unknown workflow "' + endpoint.workflow + '"');
      }
      if (endpoint.auth !== undefined && endpoint.auth !== false && (!spec.auth || spec.auth.enabled !== true)) {
        errors.push('endpoints.' + endpointName + '.auth requires top-level auth.enabled');
      }
      if (endpoint.method && endpoint.path) {
        const key = endpoint.method + ' ' + endpoint.path;
        if (routes.has(key)) errors.push('endpoints.' + endpointName + ' duplicates custom endpoint ' + key);
        routes.add(key);
      }
    }
  }

  if (isObject(spec.jobs)) {
    for (const [jobName, job] of Object.entries(spec.jobs)) {
      if (!isObject(job)) continue;
      if (job.workflow && !workflowNames.has(job.workflow)) {
        errors.push('jobs.' + jobName + '.workflow references unknown workflow "' + job.workflow + '"');
      }
    }
  }

  if (isObject(spec.workflows)) {
    for (const [workflowName, workflow] of Object.entries(spec.workflows)) {
      if (!isObject(workflow) || !Array.isArray(workflow.steps)) continue;
      const knownSteps = new Set();
      for (const [index, step] of workflow.steps.entries()) {
        if (!isObject(step)) continue;
        const stepPath = 'workflows.' + workflowName + '.steps[' + index + ']';
        if (knownSteps.has(step.name)) errors.push(stepPath + '.name must be unique within the workflow');

        const entityActions = new Set(['findById', 'create', 'updateById', 'deleteById']);
        if (entityActions.has(step.action)) {
          if (!step.entity) errors.push(stepPath + '.entity is required for action ' + step.action);
          else if (!entityNames.has(step.entity)) errors.push(stepPath + '.entity references unknown entity "' + step.entity + '"');
        }
        if (['findById', 'updateById', 'deleteById'].includes(step.action) && step.id === undefined) {
          errors.push(stepPath + '.id is required for action ' + step.action);
        }
        if (['create', 'updateById'].includes(step.action) && step.data === undefined) {
          errors.push(stepPath + '.data is required for action ' + step.action);
        }
        if (step.action === 'emit') {
          if (!step.event) errors.push(stepPath + '.event is required for action emit');
          else if (!eventNames.has(step.event)) errors.push(stepPath + '.event references unknown event "' + step.event + '"');
        }
        if (step.action === 'enqueue') {
          if (!step.job) errors.push(stepPath + '.job is required for action enqueue');
          else if (!jobNames.has(step.job)) errors.push(stepPath + '.job references unknown job "' + step.job + '"');
        }

        for (const candidate of [step.id, step.data, step.payload, step.body]) {
          if (candidate === undefined) continue;
          visitWorkflowValue(candidate, value => validateWorkflowReference(errors, value, workflowName, step.name || String(index), knownSteps));
        }

        if (step.name) knownSteps.add(step.name);
      }
    }
  }

  if (isObject(spec.entities)) {
    for (const [entityName, entity] of Object.entries(spec.entities)) {
      if (!isObject(entity)) continue;

      if (spec.database && spec.database.type === 'postgresql') {
        if (entity.schemaOptions && Object.keys(entity.schemaOptions).length) {
          errors.push('entities.' + entityName + '.schemaOptions is only supported by the mongodb target');
        }
        if (Array.isArray(entity.indexes)) {
          entity.indexes.forEach((definition, index) => {
            if (!isObject(definition) || !isObject(definition.options)) return;
            const unsupported = Object.keys(definition.options).filter(key => key !== 'unique');
            if (unsupported.length) {
              errors.push('entities.' + entityName + '.indexes[' + index + '].options only supports "unique" for postgresql');
            }
          });
        }
      }

      if (entity.hooks && entity.hooks.module) {
        validateRelativePath(errors, entity.hooks.module, 'entities.' + entityName + '.hooks.module');
      }

      const idParam = entity.idParam || 'id';
      if (isObject(entity.operations)) {
        for (const operationName of ['get', 'update', 'delete']) {
          const operation = entity.operations[operationName];
          if (!isObject(operation) || operation.path === undefined) continue;
          if (!operation.path.includes(':' + idParam)) {
            errors.push('entities.' + entityName + '.operations.' + operationName + '.path must contain the :' + idParam + ' parameter');
          }
        }

        const list = entity.operations.list;
        if (isObject(list) && isObject(list.query) && Array.isArray(list.query.filters)) {
          for (const fieldName of list.query.filters) {
            const field = entity.fields && entity.fields[fieldName];
            if (field && field.type === 'file') {
              errors.push('entities.' + entityName + '.operations.list.query.filters cannot include file field "' + fieldName + '"');
            }
          }
        }
        if (isObject(list) && isObject(list.query) && isObject(list.query.pagination)) {
          const pagination = list.query.pagination;
          if (
            pagination.defaultLimit !== undefined &&
            pagination.maxLimit !== undefined &&
            pagination.defaultLimit > pagination.maxLimit
          ) {
            errors.push('entities.' + entityName + '.operations.list.query.pagination.defaultLimit must be <= maxLimit');
          }
        }
      }

      if (Array.isArray(entity.indexes)) {
        for (const [index, definition] of entity.indexes.entries()) {
          if (!isObject(definition) || !isObject(definition.fields)) continue;
          for (const fieldName of Object.keys(definition.fields)) {
            if (!entity.fields || !Object.prototype.hasOwnProperty.call(entity.fields, fieldName)) {
              errors.push('entities.' + entityName + '.indexes[' + index + '].fields.' + fieldName + ' references an unknown field');
            } else if (entity.fields[fieldName].type === 'file') {
              errors.push('entities.' + entityName + '.indexes[' + index + '].fields.' + fieldName + ' cannot index a file metadata field');
            } else if (
              spec.database && spec.database.type === 'postgresql' &&
              entity.fields[fieldName].type === 'reference' && entity.fields[fieldName].many === true
            ) {
              errors.push('entities.' + entityName + '.indexes[' + index + '].fields.' + fieldName + ' cannot index an implicit many-to-many relation on postgresql');
            }
          }
        }
      }

      if (isObject(entity.operations)) {
        for (const [operationName, operation] of Object.entries(entity.operations)) {
          if (!isObject(operation) || !Array.isArray(operation.populate)) continue;
          for (const fieldName of operation.populate) {
            const field = entity.fields && entity.fields[fieldName];
            if (!field || field.type !== 'reference') {
              errors.push('entities.' + entityName + '.operations.' + operationName + '.populate references non-reference field "' + fieldName + '"');
            }
          }
        }
      }

      if (isObject(entity.fields)) {
        for (const [fieldName, field] of Object.entries(entity.fields)) {
          if (!isObject(field)) continue;

          if (spec.database && spec.database.type === 'postgresql' && field.options && Object.keys(field.options).length) {
            errors.push('entities.' + entityName + '.fields.' + fieldName + '.options is only supported by the mongodb target');
          }
          if (
            spec.database && spec.database.type === 'postgresql' &&
            field.type === 'reference' && field.many === true && field.unique === true
          ) {
            errors.push('entities.' + entityName + '.fields.' + fieldName + '.unique is not supported for many references on postgresql');
          }
          if (
            spec.database && spec.database.type === 'postgresql' &&
            field.type === 'reference' && field.many !== true &&
            field.onDelete === 'nullify' && field.required === true
          ) {
            errors.push('entities.' + entityName + '.fields.' + fieldName + ' cannot use onDelete "nullify" when required for postgresql');
          }

          if (field.type === 'reference') {
            if (!field.ref) {
              errors.push('entities.' + entityName + '.fields.' + fieldName + '.ref is required for reference fields');
            } else if (!entityNames.has(field.ref)) {
              errors.push('entities.' + entityName + '.fields.' + fieldName + '.ref references unknown entity "' + field.ref + '"');
            }
            if (field.upload !== undefined) errors.push('entities.' + entityName + '.fields.' + fieldName + '.upload requires type "file"');
          } else if (field.type === 'file') {
            if (field.ref !== undefined || field.onDelete !== undefined) {
              errors.push('entities.' + entityName + '.fields.' + fieldName + ' reference options are not supported for file fields');
            }
            if (field.unique === true) errors.push('entities.' + entityName + '.fields.' + fieldName + '.unique is not supported for file fields');
            if (field.enum !== undefined || field.min !== undefined || field.max !== undefined || field.minLength !== undefined || field.maxLength !== undefined) {
              errors.push('entities.' + entityName + '.fields.' + fieldName + ' scalar constraints are not supported for file fields');
            }
            if (field.options && Object.keys(field.options).length) {
              errors.push('entities.' + entityName + '.fields.' + fieldName + '.options is not supported for file fields');
            }
            if (field.upload && field.upload.directory) {
              validateRelativePath(errors, field.upload.directory, 'entities.' + entityName + '.fields.' + fieldName + '.upload.directory');
            }
          } else {
            if (field.ref !== undefined || field.many !== undefined || field.onDelete !== undefined) {
              errors.push('entities.' + entityName + '.fields.' + fieldName + ' reference options require type "reference" or "file" for many');
            }
            if (field.upload !== undefined) errors.push('entities.' + entityName + '.fields.' + fieldName + '.upload requires type "file"');
          }

          if (!Array.isArray(field.enum)) continue;
          if (!['string', 'number'].includes(field.type)) {
            errors.push('entities.' + entityName + '.fields.' + fieldName + '.enum is only supported for string and number fields');
          }
          if (field.type === 'string' && field.enum.some(value => typeof value !== 'string')) {
            errors.push('entities.' + entityName + '.fields.' + fieldName + '.enum values must be strings');
          }
          if (field.type === 'number' && field.enum.some(value => typeof value !== 'number')) {
            errors.push('entities.' + entityName + '.fields.' + fieldName + '.enum values must be numbers');
          }
        }
      }
    }
  }

  if (spec.fixtures && isObject(spec.fixtures)) {
    if (!spec.database || spec.database.type !== 'postgresql') errors.push('fixtures require postgresql');
    const dependencies = new Map();
    for (const [entityName, rows] of Object.entries(spec.fixtures)) {
      const entity = spec.entities && spec.entities[entityName];
      if (!entity) { errors.push('fixtures.' + entityName + ' references unknown entity'); continue; }
      const deps = new Set();
      dependencies.set(entityName, deps);
      if (!Array.isArray(rows)) continue;
      for (const [index, row] of rows.entries()) {
        if (!isObject(row) || !isObject(row.where) || !isObject(row.data)) continue;
        const keys = Object.keys(row.where);
        if (keys.length !== 1 || !entity.fields[keys[0]] || entity.fields[keys[0]].unique !== true) {
          errors.push('fixtures.' + entityName + '[' + index + '].where must select one declared unique scalar field');
        }
        for (const [key, value] of Object.entries(row.data)) {
          const field = entity.fields[key];
          if (!field || field.type === 'file') { errors.push('fixtures.' + entityName + '[' + index + '].data.' + key + ' is unsupported'); continue; }
          if (field.type === 'reference') {
            if (field.many || !isObject(value) || !isObject(value.where) || Object.keys(value.where).length !== 1) {
              errors.push('fixtures.' + entityName + '[' + index + '].data.' + key + ' requires a single reference where selector');
              continue;
            }
            const target = spec.entities[field.ref];
            const refKey = Object.keys(value.where)[0];
            if (!target || !target.fields[refKey] || target.fields[refKey].unique !== true) errors.push('fixtures.' + entityName + '[' + index + '].data.' + key + ' requires target unique field');
            deps.add(field.ref);
          }
        }
      }
    }
    const visiting = new Set(), visited = new Set();
    function visit(name) {
      if (visiting.has(name)) { errors.push('fixtures dependency cycle at ' + name); return; }
      if (visited.has(name)) return;
      visiting.add(name);
      for (const dep of dependencies.get(name) || []) {
        if (!dependencies.has(dep)) errors.push('fixtures.' + name + ' requires fixture rows for dependency ' + dep);
        else visit(dep);
      }
      visiting.delete(name);
      visited.add(name);
    }
    for (const name of dependencies.keys()) visit(name);
  }
  if (spec.factories && isObject(spec.factories)) {
    if (!spec.database || spec.database.type !== 'postgresql') errors.push('factories are currently supported only for postgresql');
    for (const [entityName, config] of Object.entries(spec.factories)) {
      if (!spec.entities || !spec.entities[entityName]) {
        errors.push('factories.' + entityName + ' references an unknown entity');
      } else if (isObject(config) && isObject(config.template)) {
        const fields = spec.entities[entityName].fields || {};
        for (const fieldName of Object.keys(config.template)) {
          if (!fields[fieldName] || ['reference', 'file'].includes(fields[fieldName].type)) {
            errors.push('factories.' + entityName + '.template.' + fieldName + ' must be a scalar entity field');
          }
        }
      }
    }
  }
  if (spec.seeds && isObject(spec.seeds)) {
    if (!spec.database || spec.database.type !== 'postgresql') {
      errors.push('seeds are currently supported only for postgresql');
    }
    for (const [entityName, rows] of Object.entries(spec.seeds)) {
      const entity = spec.entities && spec.entities[entityName];
      if (!entity) {
        errors.push('seeds.' + entityName + ' references an unknown entity');
        continue;
      }
      const fields = entity.fields || {};
      if (!Array.isArray(rows)) continue;
      rows.forEach((row, index) => {
        if (!isObject(row)) return;
        for (const key of Object.keys(row)) {
          if (key === 'id') continue;
          if (!fields[key]) {
            errors.push('seeds.' + entityName + '[' + index + '].' + key + ' is not an entity field');
          } else if (['reference', 'file'].includes(fields[key].type)) {
            errors.push('seeds.' + entityName + '[' + index + '].' + key + ' cannot seed references or files; use scalar fields');
          }
        }
      });
    }
  }

  if (errors.length) throw new SpecificationError(errors);
  return spec;
}

module.exports = {SpecificationError, validateSpec};
