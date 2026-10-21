'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

const TYPE_MAP = {string: 'String', number: 'Number', boolean: 'Boolean', date: 'Date'};

function renderField(field, entity, spec) {
  const options = {...field.options};

  if (field.type === 'reference') {
    const refType = 'mongoose.Schema.Types.ObjectId';
    options.type = field.many ? '[' + refType + ']' : refType;
    options.ref = field.ref;
    options.validate = 'referenceExists(' + js(relativeRequire(filePaths(spec, entity.name).model, filePaths(spec, field.ref).model)) + ', ' + js(field.ref) + ', ' + js(spec.entities.find(item => item.name === field.ref).softDelete) + ')';
  } else if (field.type === 'file') {
    const fileType = 'mongoose.Schema.Types.Mixed';
    options.type = field.many ? '[' + fileType + ']' : fileType;
  } else {
    options.type = TYPE_MAP[field.type];
  }

  for (const key of ['required', 'unique', 'enum', 'min', 'max', 'default']) {
    if (field[key] !== undefined) options[key] = field[key];
  }
  if (field.minLength !== undefined) options.minlength = field.minLength;
  if (field.maxLength !== undefined) options.maxlength = field.maxLength;

  return '  ' + field.name + ': { ' + Object.entries(options).map(([key, value]) => {
    if (key === 'type' || key === 'validate') return key + ': ' + value;
    return key + ': ' + js(value);
  }).join(', ') + ' }';
}

function modelSource(entity, spec) {
  const schemaOptions = {
    ...entity.schemaOptions,
    ...(entity.collection ? {collection: entity.collection} : {})
  };

  const fields = entity.fields.map(field => renderField(field, entity, spec));
  const hasReferences = entity.fields.some(field => field.type === 'reference');
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
    ...(hasReferences ? [
      '// MongoDB has no foreign keys: reject writes that point at missing or soft-deleted records.',
      'function referenceExists(modelPath, modelName, softDelete) {',
      '  return {',
      "    type: 'reference',",
      '    message: props => props.path + \' references a missing \' + modelName,',
      '    async validator(value) {',
      '      const ids = [...new Set((Array.isArray(value) ? value : [value]).filter(id => id !== null && id !== undefined).map(String))];',
      '      if (!ids.length) return true;',
      '      const filter = {_id: {$in: ids}};',
      '      if (softDelete.enabled) filter[softDelete.field] = null;',
      '      return (await require(modelPath).countDocuments(filter)) === ids.length;',
      '    }',
      '  };',
      '}', ''
    ] : []),
    'const ' + entity.name + 'Schema = new mongoose.Schema({',
    fields.join(',\n'),
    '}, ' + js(schemaOptions) + ');', '',
    ...indexLines,
    indexLines.length ? '' : null,
    "module.exports = mongoose.model('" + entity.name + "', " + entity.name + 'Schema);', ''
  ].filter(line => line !== null).join('\n');
}

module.exports = modelSource;
