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

  if (isObject(spec.entities)) {
    const entityNames = new Set(Object.keys(spec.entities));
    for (const [entityName, entity] of Object.entries(spec.entities)) {
      if (!isObject(entity)) continue;

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
