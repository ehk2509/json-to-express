'use strict';

const SUPPORTED_TYPES = new Set(['string', 'number', 'boolean', 'date']);

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
  }

  if (!isObject(spec.database)) {
    errors.push('database must be an object');
  } else {
    if (spec.database.type !== 'mongodb') errors.push('database.type must be "mongodb" in v0.1');
    if (spec.database.uriEnv !== undefined && (typeof spec.database.uriEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(spec.database.uriEnv))) {
      errors.push('database.uriEnv must be an uppercase environment variable name');
    }
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
        if (!SUPPORTED_TYPES.has(field.type)) errors.push(fieldPath + '.type must be one of: ' + [...SUPPORTED_TYPES].join(', '));
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
      }
    }
  }

  if (errors.length) throw new SpecificationError(errors);
  return spec;
}

module.exports = {SpecificationError, validateSpec};
