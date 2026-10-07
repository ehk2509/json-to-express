'use strict';

const schema = require('../schema/application.schema.json');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveRef(ref) {
  if (!ref.startsWith('#/')) throw new Error('Only local JSON Schema refs are supported: ' + ref);
  return ref.slice(2).split('/').reduce((value, key) => value[key], schema);
}

function matchesType(value, type) {
  if (type === 'object') return isObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function validateNode(value, rule, path, errors) {
  if (!rule || Object.keys(rule).length === 0) return;

  if (rule.$ref) {
    validateNode(value, resolveRef(rule.$ref), path, errors);
    return;
  }

  if (rule.oneOf) {
    const matches = rule.oneOf.filter(candidate => {
      const candidateErrors = [];
      validateNode(value, candidate, path, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (matches.length !== 1) errors.push(path + ' must match exactly one supported shape');
    return;
  }

  if (rule.const !== undefined && value !== rule.const) {
    errors.push(path + ' must equal ' + JSON.stringify(rule.const));
    return;
  }

  if (rule.enum && !rule.enum.includes(value)) {
    errors.push(path + ' must be one of: ' + rule.enum.join(', '));
    return;
  }

  if (rule.type !== undefined) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some(type => matchesType(value, type))) {
      errors.push(path + ' must be of type ' + types.join(' or '));
      return;
    }
  }

  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(path + ' must not be empty');
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(path + ' has an invalid format');
  }

  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) errors.push(path + ' must be >= ' + rule.minimum);
    if (rule.maximum !== undefined && value > rule.maximum) errors.push(path + ' must be <= ' + rule.maximum);
  }

  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(path + ' must contain at least ' + rule.minItems + ' item(s)');
    if (rule.items) value.forEach((item, index) => validateNode(item, rule.items, path + '[' + index + ']', errors));
  }

  if (isObject(value)) {
    const properties = rule.properties || {};
    const required = rule.required || [];
    for (const key of required) {
      if (value[key] === undefined) errors.push(path + '.' + key + ' is required');
    }

    if (rule.minProperties !== undefined && Object.keys(value).length < rule.minProperties) {
      errors.push(path + ' must contain at least ' + rule.minProperties + ' property/properties');
    }

    if (rule.propertyNames && rule.propertyNames.pattern) {
      const pattern = new RegExp(rule.propertyNames.pattern);
      for (const key of Object.keys(value)) {
        if (!pattern.test(key)) errors.push(path + '.' + key + ' has an invalid property name');
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) {
        validateNode(child, properties[key], path + '.' + key, errors);
      } else if (rule.additionalProperties === false) {
        errors.push(path + '.' + key + ' is not a supported property');
      } else if (isObject(rule.additionalProperties)) {
        validateNode(child, rule.additionalProperties, path + '.' + key, errors);
      }
    }
  }
}

function validateSchema(value) {
  const errors = [];
  validateNode(value, schema, '$', errors);
  return errors;
}

module.exports = {validateSchema};
