'use strict';

const SUPPORTED_TYPES = new Set(['string', 'number', 'boolean', 'date']);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const OPERATIONS = new Set(['list', 'get', 'create', 'update', 'delete']);

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

function isPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !/\s/.test(value);
}

function validateString(errors, value, path, options = {}) {
  if (value === undefined) return;
  if (typeof value !== 'string' || (!options.allowEmpty && !value.trim())) {
    errors.push(path + ' must be a ' + (options.allowEmpty ? 'string' : 'non-empty string'));
  }
}

function validateBoolean(errors, value, path) {
  if (value !== undefined && typeof value !== 'boolean') errors.push(path + ' must be a boolean');
}

function validateStatus(errors, value, path) {
  if (value !== undefined && (!Number.isInteger(value) || value < 100 || value > 599)) {
    errors.push(path + ' must be an HTTP status code between 100 and 599');
  }
}

function validatePath(errors, value, path) {
  if (value !== undefined && !isPath(value)) errors.push(path + ' must be an absolute path beginning with "/" and contain no spaces');
}

function validatePackage(errors, value) {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push('app.package must be an object');
    return;
  }
  for (const key of ['name', 'version', 'description', 'nodeEngine']) validateString(errors, value[key], 'app.package.' + key);
  validateBoolean(errors, value.private, 'app.package.private');
  for (const key of ['scripts', 'dependencies', 'devDependencies']) {
    if (value[key] !== undefined && !isObject(value[key])) errors.push('app.package.' + key + ' must be an object');
  }
}

function validateHealth(errors, value) {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push('app.health must be an object');
    return;
  }
  validateBoolean(errors, value.enabled, 'app.health.enabled');
  validatePath(errors, value.path, 'app.health.path');
  validateStatus(errors, value.status, 'app.health.status');
}

function validateResponses(errors, value) {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push('app.responses must be an object');
    return;
  }
  for (const key of ['notFound', 'validationError', 'invalidIdentifier', 'uniqueConstraint', 'internalError']) {
    validateString(errors, value[key], 'app.responses.' + key);
  }
}

function validateOperation(errors, entityName, name, operation, idParam) {
  const path = 'entities.' + entityName + '.operations.' + name;
  if (typeof operation === 'boolean' || operation === undefined) return;
  if (!isObject(operation)) {
    errors.push(path + ' must be a boolean or object');
    return;
  }
  validateBoolean(errors, operation.enabled, path + '.enabled');
  validateStatus(errors, operation.status, path + '.status');
  validateStatus(errors, operation.notFoundStatus, path + '.notFoundStatus');
  validateBoolean(errors, operation.lean, path + '.lean');
  validateBoolean(errors, operation.runValidators, path + '.runValidators');

  if (operation.method !== undefined && (!HTTP_METHODS.has(operation.method))) {
    errors.push(path + '.method must be one of: ' + [...HTTP_METHODS].join(', '));
  }
  validatePath(errors, operation.path, path + '.path');

  if (['get', 'update', 'delete'].includes(name) && operation.path !== undefined && !operation.path.includes(':' + idParam)) {
    errors.push(path + '.path must contain the :' + idParam + ' parameter');
  }
}

function validateSpec(spec) {
  const errors = [];
  if (!isObject(spec)) throw new SpecificationError(['root must be a JSON object']);

  if (!isObject(spec.app)) {
    errors.push('app must be an object');
  } else {
    if (typeof spec.app.name !== 'string' || !spec.app.name.trim()) errors.push('app.name must be a non-empty string');
    if (spec.app.port !== undefined && (!Number.isInteger(spec.app.port) || spec.app.port < 1 || spec.app.port > 65535)) {
      errors.push('app.port must be an integer between 1 and 65535');
    }
    validateString(errors, spec.app.portEnv, 'app.portEnv');
    validatePath(errors, spec.app.apiPrefix, 'app.apiPrefix');
    if (spec.app.bodyLimit !== undefined && (typeof spec.app.bodyLimit !== 'string' && typeof spec.app.bodyLimit !== 'number')) {
      errors.push('app.bodyLimit must be a string or number accepted by express.json');
    }
    validateHealth(errors, spec.app.health);
    validatePackage(errors, spec.app.package);
    validateResponses(errors, spec.app.responses);
    if (spec.app.statusCodes !== undefined) {
      if (!isObject(spec.app.statusCodes)) {
        errors.push('app.statusCodes must be an object');
      } else {
        for (const key of ['notFound', 'validationError', 'invalidIdentifier', 'uniqueConstraint', 'internalError']) {
          validateStatus(errors, spec.app.statusCodes[key], 'app.statusCodes.' + key);
        }
      }
    }
  }

  if (spec.generation !== undefined) {
    if (!isObject(spec.generation)) {
      errors.push('generation must be an object');
    } else {
      validateString(errors, spec.generation.outputDir, 'generation.outputDir');
    }
  }

  if (!isObject(spec.database)) {
    errors.push('database must be an object');
  } else {
    if (spec.database.type !== 'mongodb') errors.push('database.type must be "mongodb" in v0.1');
    if (spec.database.uriEnv !== undefined && (typeof spec.database.uriEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(spec.database.uriEnv))) {
      errors.push('database.uriEnv must be an uppercase environment variable name');
    }
    validateString(errors, spec.database.defaultUri, 'database.defaultUri');
    if (spec.database.options !== undefined && !isObject(spec.database.options)) errors.push('database.options must be an object');
  }

  if (!isObject(spec.entities) || Object.keys(spec.entities).length === 0) {
    errors.push('entities must be a non-empty object');
  } else {
    for (const [entityName, entity] of Object.entries(spec.entities)) {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(entityName)) errors.push('entity "' + entityName + '" must use a valid PascalCase identifier');
      if (!isObject(entity)) {
        errors.push('entity "' + entityName + '" must be an object');
        continue;
      }

      if (entity.route !== undefined && (typeof entity.route !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entity.route))) {
        errors.push('entities.' + entityName + '.route must be a lowercase URL segment');
      }
      validateString(errors, entity.collection, 'entities.' + entityName + '.collection');
      validateString(errors, entity.idParam, 'entities.' + entityName + '.idParam');
      if (entity.idParam !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entity.idParam)) {
        errors.push('entities.' + entityName + '.idParam must be a valid parameter identifier');
      }
      if (entity.schemaOptions !== undefined && !isObject(entity.schemaOptions)) {
        errors.push('entities.' + entityName + '.schemaOptions must be an object');
      }

      const idParam = entity.idParam || 'id';
      if (entity.operations !== undefined) {
        if (!isObject(entity.operations)) {
          errors.push('entities.' + entityName + '.operations must be an object');
        } else {
          for (const operationName of Object.keys(entity.operations)) {
            if (!OPERATIONS.has(operationName)) {
              errors.push('entities.' + entityName + '.operations.' + operationName + ' is not supported');
              continue;
            }
            validateOperation(errors, entityName, operationName, entity.operations[operationName], idParam);
          }
        }
      }

      if (!isObject(entity.fields) || Object.keys(entity.fields).length === 0) {
        errors.push('entities.' + entityName + '.fields must be a non-empty object');
        continue;
      }

      for (const [fieldName, field] of Object.entries(entity.fields)) {
        const fieldPath = 'entities.' + entityName + '.fields.' + fieldName;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldName)) errors.push(fieldPath + ' is not a valid JavaScript identifier');
        if (!isObject(field)) {
          errors.push(fieldPath + ' must be an object');
          continue;
        }
        if (!SUPPORTED_TYPES.has(field.type)) {
          errors.push(fieldPath + '.type "' + String(field.type) + '" is unsupported; expected one of: ' + [...SUPPORTED_TYPES].join(', '));
        }
        for (const booleanOption of ['required', 'unique']) {
          if (field[booleanOption] !== undefined && typeof field[booleanOption] !== 'boolean') {
            errors.push(fieldPath + '.' + booleanOption + ' must be a boolean');
          }
        }
        if (field.enum !== undefined) {
          if (!Array.isArray(field.enum) || field.enum.length === 0) errors.push(fieldPath + '.enum must be a non-empty array');
          else if (!['string', 'number'].includes(field.type)) errors.push(fieldPath + '.enum is only supported for string and number fields');
        }
        for (const numericOption of ['min', 'max', 'minLength', 'maxLength']) {
          if (field[numericOption] !== undefined && typeof field[numericOption] !== 'number') {
            errors.push(fieldPath + '.' + numericOption + ' must be a number');
          }
        }
        if (field.options !== undefined && !isObject(field.options)) errors.push(fieldPath + '.options must be an object');
      }
    }
  }

  if (errors.length) throw new SpecificationError(errors);
  return spec;
}

module.exports = {SpecificationError, validateSpec};
