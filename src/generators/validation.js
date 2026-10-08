'use strict';

const {js} = require('./utils');

function descriptor(entity) {
  const fields = {};
  for (const field of entity.fields) {
    fields[field.name] = {
      type: field.type,
      required: Boolean(field.required),
      many: Boolean(field.many),
      enum: field.enum || null
    };
  }
  return fields;
}

module.exports = function validationSource(spec) {
  const entities = Object.fromEntries(spec.entities.map(entity => [entity.name, descriptor(entity)]));
  const postgres = spec.database.type === 'postgresql';
  const idHelper = postgres
    ? [
      'function isIdentifier(value) {',
      "  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);",
      '}'
    ]
    : [
      "const mongoose = require('mongoose');",
      'function isIdentifier(value) { return mongoose.Types.ObjectId.isValid(value); }'
    ];

  return [
    "'use strict';", '',
    ...idHelper, '',
    'const definitions = ' + js(entities) + ';', '',
    'function validValue(definition, value) {',
    '  if (value === null || value === undefined) return true;',
    "  if (definition.type === 'string' && typeof value !== 'string') return false;",
    "  if (definition.type === 'number' && !(typeof value === 'number' && Number.isFinite(value))) return false;",
    "  if (definition.type === 'boolean' && typeof value !== 'boolean') return false;",
    "  if (definition.type === 'date' && Number.isNaN(Date.parse(value))) return false;",
    "  if (definition.type === 'reference') {",
    '    const values = definition.many ? value : [value];',
    '    if (!Array.isArray(values) || !values.every(isIdentifier)) return false;',
    '  }',
    '  if (definition.enum && !definition.enum.includes(value)) return false;',
    '  return true;',
    '}', '',
    'function validateBody(entityName, value, partial) {',
    '  const fields = definitions[entityName];',
    '  const errors = [];',
    '  for (const [name, definition] of Object.entries(fields)) {',
    '    const fieldValue = value && value[name];',
    '    if (!partial && definition.required && (fieldValue === undefined || fieldValue === null || (definition.many && Array.isArray(fieldValue) && fieldValue.length === 0))) errors.push(name + " is required");',
    '    if (fieldValue !== undefined && !validValue(definition, fieldValue)) errors.push(name + " has an invalid value");',
    '  }',
    '  return errors;',
    '}', '',
    'function body(entityName, partial) {',
    '  return function validateBodyMiddleware(req, res, next) {',
    '    const errors = validateBody(entityName, req.body, partial);',
    "    if (errors.length) return res.status(400).json({error: 'Invalid request', details: errors});",
    '    next();',
    '  };',
    '}', '',
    'function identifier(paramName) {',
    '  return function validateIdentifier(req, res, next) {',
    "    if (!isIdentifier(req.params[paramName])) return res.status(400).json({error: 'Invalid identifier'});",
    '    next();',
    '  };',
    '}', '',
    'module.exports = {body, identifier, objectId: identifier, isIdentifier, validateBody};', ''
  ].join('\n');
};
