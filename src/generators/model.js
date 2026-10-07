'use strict';

const {js} = require('./utils');

const TYPE_MAP = {string: 'String', number: 'Number', boolean: 'Boolean', date: 'Date'};

function renderField(field) {
  const options = {...field.options};

  if (field.type === 'reference') {
    const refType = 'mongoose.Schema.Types.ObjectId';
    options.type = field.many ? '[' + refType + ']' : refType;
    options.ref = field.ref;
  } else {
    options.type = TYPE_MAP[field.type];
  }

  for (const key of ['required', 'unique', 'enum', 'min', 'max', 'default']) {
    if (field[key] !== undefined) options[key] = field[key];
  }
  if (field.minLength !== undefined) options.minlength = field.minLength;
  if (field.maxLength !== undefined) options.maxlength = field.maxLength;

  return '  ' + field.name + ': { ' + Object.entries(options).map(([key, value]) => {
    if (key === 'type') return key + ': ' + value;
    return key + ': ' + js(value);
  }).join(', ') + ' }';
}

function modelSource(entity) {
  const schemaOptions = {
    ...entity.schemaOptions,
    ...(entity.collection ? {collection: entity.collection} : {})
  };

  const fields = entity.fields.map(renderField);
  if (entity.softDelete.enabled) {
    fields.push('  ' + entity.softDelete.field + ': { type: Date, default: null, index: true }');
  }
  if (entity.audit.enabled) {
    fields.push('  ' + entity.audit.createdBy + ': { type: String }');
    fields.push('  ' + entity.audit.updatedBy + ': { type: String }');
  }

  const indexLines = entity.indexes.map(index =>
    entity.name + 'Schema.index(' + js(index.fields) + ', ' + js(index.options || {}) + ');'
  );

  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');", '',
    'const ' + entity.name + 'Schema = new mongoose.Schema({',
    fields.join(',\n'),
    '}, ' + js(schemaOptions) + ');', '',
    ...indexLines,
    indexLines.length ? '' : null,
    "module.exports = mongoose.model('" + entity.name + "', " + entity.name + 'Schema);', ''
  ].filter(line => line !== null).join('\n');
}

module.exports = modelSource;
