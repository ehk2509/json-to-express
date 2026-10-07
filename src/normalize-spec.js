'use strict';

const {validateSpec} = require('./validate-spec');

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

function normalizeSpec(spec) {
  validateSpec(spec);
  return {
    app: {
      name: spec.app.name.trim(),
      packageName: packageName(spec.app.name),
      port: spec.app.port || 3000
    },
    database: {
      type: 'mongodb',
      uriEnv: spec.database.uriEnv || 'MONGODB_URI'
    },
    entities: Object.entries(spec.entities).map(([name, entity]) => ({
      name,
      route: entity.route || defaultRoute(name),
      fields: Object.entries(entity.fields).map(([fieldName, field]) => ({
        name: fieldName,
        type: field.type,
        required: field.required === true,
        unique: field.unique === true,
        enum: field.enum,
        min: field.min,
        max: field.max,
        minLength: field.minLength,
        maxLength: field.maxLength,
        default: field.default
      }))
    }))
  };
}

module.exports = {defaultRoute, normalizeSpec, packageName, pluralize};
