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
          } else if (field.ref !== undefined || field.many !== undefined || field.onDelete !== undefined) {
            errors.push('entities.' + entityName + '.fields.' + fieldName + ' reference options require type "reference"');
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

  if (errors.length) throw new SpecificationError(errors);
  return spec;
}

module.exports = {SpecificationError, validateSpec};
