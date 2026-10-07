'use strict';

const {js} = require('./utils');

function descriptor(entity) {
  const fields = {};
  for (const field of entity.fields) {
    fields[field.name] = {
      type: field.type,
      required: Boolean(field.required),
      many: Boolean(field.many)
    };
  }
  return fields;
}

module.exports = function validationSource(spec) {
  const entities = Object.fromEntries(spec.entities.map(entity => [entity.name, descriptor(entity)]));
  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');",
    'const definitions = ' + js(entities) + ';', '',
    'function validValue(definition, value) {',
    '  if (value === null || value === undefined) return true;',
    "  if (definition.type === 'string') return typeof value === 'string';",
    "  if (definition.type === 'number') return typeof value === 'number' && Number.isFinite(value);",
    "  if (definition.type === 'boolean') return typeof value === 'boolean';",
    "  if (definition.type === 'date') return !Number.isNaN(Date.parse(value));",
    "  if (definition.type === 'reference') {",
    '    const values = definition.many ? value : [value];',
    '    return Array.isArray(values) && values.every(item => mongoose.Types.ObjectId.isValid(item));',
    '  }',
    '  return false;',
    '}', '',
    'function body(entityName, partial) {',
    '  return function validateBody(req, res, next) {',
    '    const fields = definitions[entityName];',
    '    const errors = [];',
    '    for (const [name, definition] of Object.entries(fields)) {',
    '      const value = req.body && req.body[name];',
    '      if (!partial && definition.required && (value === undefined || value === null)) errors.push(name + " is required");',
    '      if (value !== undefined && !validValue(definition, value)) errors.push(name + " has an invalid type");',
    '    }',
    "    if (errors.length) return res.status(400).json({error: 'Invalid request', details: errors});",
    '    next();',
    '  };',
    '}', '',
    'function objectId(paramName) {',
    '  return function validateObjectId(req, res, next) {',
    "    if (!mongoose.Types.ObjectId.isValid(req.params[paramName])) return res.status(400).json({error: 'Invalid identifier'});",
    '    next();',
    '  };',
    '}', '',
    'module.exports = {body, objectId};', ''
  ].join('\n');
};
