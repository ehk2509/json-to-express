'use strict';

const {joinUrl} = require('./utils');

function identifierSchema(spec) {
  return spec.database.type === 'postgresql'
    ? {type: 'string', format: 'uuid'}
    : {type: 'string', pattern: '^[a-fA-F0-9]{24}$'};
}

function fieldSchema(field, spec) {
  if (field.type === 'reference') {
    const item = identifierSchema(spec);
    if (field.many) {
      const schema = {type: 'array', items: item};
      if (field.required) schema.minItems = 1;
      return schema;
    }
    return item;
  }
  const types = {string: 'string', number: 'number', boolean: 'boolean', date: 'string'};
  const schema = {type: types[field.type]};
  if (field.type === 'date') schema.format = 'date-time';
  if (field.enum) schema.enum = field.enum;
  if (field.min !== undefined) schema.minimum = field.min;
  if (field.max !== undefined) schema.maximum = field.max;
  if (field.minLength !== undefined) schema.minLength = field.minLength;
  if (field.maxLength !== undefined) schema.maxLength = field.maxLength;
  return schema;
}

module.exports = function openapiSource(spec) {
  const document = {
    openapi: '3.1.0',
    info: {title: spec.docs.openapi.title, version: spec.docs.openapi.version},
    paths: {},
    components: {schemas: {}, securitySchemes: {}}
  };

  if (spec.auth.enabled) {
    document.components.securitySchemes.bearerAuth = {type: 'http', scheme: 'bearer', bearerFormat: 'JWT'};
  }

  for (const endpoint of spec.endpoints) {
    const full = joinUrl(spec.app.apiPrefix, endpoint.path).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
    document.paths[full] = document.paths[full] || {};
    const parameters = [...endpoint.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: {type: 'string'}
    }));
    const operation = {
      operationId: endpoint.name,
      responses: {[String(endpoint.status)]: {description: 'Success'}},
      ...(parameters.length ? {parameters} : {})
    };
    if (endpoint.auth.required) operation.security = [{bearerAuth: []}];
    document.paths[full][endpoint.method] = operation;
  }

  for (const entity of spec.entities) {
    const properties = {};
    const required = [];
    for (const field of entity.fields) {
      properties[field.name] = fieldSchema(field, spec);
      if (field.required) required.push(field.name);
    }
    document.components.schemas[entity.name] = {
      type: 'object',
      properties: {[spec.database.type === 'postgresql' ? 'id' : '_id']: identifierSchema(spec), ...properties},
      ...(required.length ? {required} : {})
    };

    const base = joinUrl(spec.app.apiPrefix, entity.route);
    for (const [name, op] of Object.entries(entity.operations)) {
      if (!op.enabled) continue;
      const full = op.path === '/' ? base : joinUrl(base, op.path.replace(':' + entity.idParam, '{' + entity.idParam + '}'));
      document.paths[full] = document.paths[full] || {};
      const operation = {
        operationId: name + entity.name,
        responses: {[String(op.status)]: {description: 'Success'}}
      };
      if (['get', 'update', 'delete'].includes(name)) {
        operation.parameters = [{
          name: entity.idParam,
          in: 'path',
          required: true,
          schema: identifierSchema(spec)
        }];
      }
      if (name === 'list') {
        operation.parameters = operation.parameters || [];
        for (const filter of op.query.filters) operation.parameters.push({name: filter, in: 'query', schema: {}});
        if (op.query.sortParam) operation.parameters.push({name: op.query.sortParam, in: 'query', schema: {type: 'string'}});
        if (op.query.selectParam) operation.parameters.push({name: op.query.selectParam, in: 'query', schema: {type: 'string'}});
        if (op.query.pagination.enabled) {
          operation.parameters.push({name: op.query.pagination.pageParam, in: 'query', schema: {type: 'integer', minimum: 1}});
          operation.parameters.push({name: op.query.pagination.limitParam, in: 'query', schema: {type: 'integer', minimum: 1, maximum: op.query.pagination.maxLimit}});
        }
      }
      if (['create', 'update'].includes(name)) {
        operation.requestBody = {
          required: name === 'create',
          content: {'application/json': {schema: {$ref: '#/components/schemas/' + entity.name}}}
        };
      }
      if (op.auth.required) operation.security = [{bearerAuth: []}];
      document.paths[full][op.method] = operation;
    }
  }

  return JSON.stringify(document, null, 2) + '\n';
};
