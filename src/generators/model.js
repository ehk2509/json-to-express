'use strict';

const {js} = require('./utils');

const TYPE_MAP = {string: 'String', number: 'Number', boolean: 'Boolean', date: 'Date'};

function renderField(field) {
  const options = {...field.options, type: TYPE_MAP[field.type]};
  for (const key of ['required', 'unique', 'enum', 'min', 'max', 'default']) {
    if (field[key] !== undefined) options[key] = field[key];
  }
  if (field.minLength !== undefined) options.minlength = field.minLength;
  if (field.maxLength !== undefined) options.maxlength = field.maxLength;

  return '  ' + field.name + ': { ' + Object.entries(options).map(([key, value]) =>
    key + ': ' + (key === 'type' ? value : js(value))
  ).join(', ') + ' }';
}

function modelSource(entity) {
  const schemaOptions = {
    ...entity.schemaOptions,
    ...(entity.collection ? {collection: entity.collection} : {})
  };

  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');", '',
    'const ' + entity.name + 'Schema = new mongoose.Schema({',
    entity.fields.map(renderField).join(',\n'),
    '}, ' + js(schemaOptions) + ');', '',
    "module.exports = mongoose.model('" + entity.name + "', " + entity.name + 'Schema);', ''
  ].join('\n');
}

module.exports = modelSource;
