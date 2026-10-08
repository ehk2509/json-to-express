'use strict';

const {filePaths, js, relativeRequire} = require('./utils');
const {lowerFirst} = require('./prisma-schema');

function pluralize(value) {
  if (/[^aeiou]y$/i.test(value)) return value.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(value)) return value + 'es';
  return value + 's';
}

function pascal(value) {
  return String(value)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function scalarType(field) {
  if (field.type === 'number') return 'Float';
  if (field.type === 'boolean') return 'Boolean';
  if (field.type === 'reference') return 'ID';
  return 'String';
}

function outputType(field) {
  if (field.type === 'reference') {
    if (field.many) return '[' + field.ref + '!]!';
    return field.ref + (field.required ? '!' : '');
  }
  const type = scalarType(field);
  return type + (field.required ? '!' : '');
}

function inputType(field, create) {
  let type;
  if (field.type === 'reference') type = field.many ? '[ID!]' : 'ID';
  else type = scalarType(field);
  const required = create && field.required && field.default === undefined;
  return type + (required ? '!' : '');
}

function filterType(field, operator) {
  const base = field.type === 'reference' ? 'ID' : scalarType(field);
  return operator === 'in' ? '[' + base + '!]' : base;
}

function graphqlNames(entity) {
  return {
    list: 'list' + pluralize(entity.name),
    get: 'get' + entity.name,
    create: 'create' + entity.name,
    update: 'update' + entity.name,
    delete: 'delete' + entity.name
  };
}

function entityMetadata(spec) {
  return Object.fromEntries(spec.entities.map(entity => [
    entity.name,
    {
      delegate: lowerFirst(entity.name),
      idParam: entity.idParam,
      softDeleteField: entity.softDelete.enabled ? entity.softDelete.field : null,
      names: graphqlNames(entity),
      fields: Object.fromEntries(entity.fields.map(field => [
        field.name,
        {
          type: field.type,
          ref: field.ref || null,
          many: Boolean(field.many)
        }
      ])),
      operations: Object.fromEntries(Object.entries(entity.operations).map(([name, operation]) => [
        name,
        {
          enabled: operation.enabled,
          auth: operation.auth,
          validate: operation.validate,
          query: name === 'list' ? {
            filters: operation.query.filters,
            operators: operation.query.operators,
            sortParam: operation.query.sortParam,
            pageParam: operation.query.pagination.pageParam,
            limitParam: operation.query.pagination.limitParam,
            pagination: operation.query.pagination.enabled
          } : null
        }
      ]))
    }
  ]));
}

function endpointMetadata(spec) {
  return Object.fromEntries(spec.endpoints.map(endpoint => [
    'action' + pascal(endpoint.name),
    {
      name: endpoint.name,
      workflow: endpoint.workflow,
      method: endpoint.method,
      auth: endpoint.auth
    }
  ]));
}

function typeDefs(spec) {
  const lines = ['scalar JSON', ''];

  for (const entity of spec.entities) {
    lines.push('type ' + entity.name + ' {', '  id: ID!');
    for (const field of entity.fields) lines.push('  ' + field.name + ': ' + outputType(field));
    if (entity.schemaOptions.timestamps !== false) {
      lines.push('  createdAt: String', '  updatedAt: String');
    }
    lines.push('}', '');

    if (entity.operations.create.enabled) {
      lines.push('input ' + entity.name + 'CreateInput {');
      for (const field of entity.fields) lines.push('  ' + field.name + ': ' + inputType(field, true));
      lines.push('}', '');
    }

    if (entity.operations.update.enabled) {
      lines.push('input ' + entity.name + 'UpdateInput {');
      for (const field of entity.fields) lines.push('  ' + field.name + ': ' + inputType(field, false));
      lines.push('}', '');
    }

    if (entity.operations.list.enabled && entity.operations.list.query.filters.length) {
      lines.push('input ' + entity.name + 'FilterInput {');
      for (const fieldName of entity.operations.list.query.filters) {
        const field = entity.fields.find(item => item.name === fieldName);
        if (!field) continue;
        lines.push('  ' + fieldName + ': ' + filterType(field, 'eq'));
        for (const operator of entity.operations.list.query.operators) {
          if (operator === 'eq') continue;
          lines.push('  ' + fieldName + '__' + operator + ': ' + filterType(field, operator));
        }
      }
      lines.push('}', '');
    }
  }

  lines.push('type Query {', '  _service: String!');
  for (const entity of spec.entities) {
    const names = graphqlNames(entity);
    const list = entity.operations.list;
    const get = entity.operations.get;
    if (list.enabled) {
      const args = [];
      if (list.query.filters.length) args.push('filter: ' + entity.name + 'FilterInput');
      if (list.query.sortParam) args.push('sort: String');
      if (list.query.pagination.enabled) args.push('page: Int', 'limit: Int');
      lines.push('  ' + names.list + (args.length ? '(' + args.join(', ') + ')' : '') + ': [' + entity.name + '!]!');
    }
    if (get.enabled) lines.push('  ' + names.get + '(id: ID!): ' + entity.name);
  }
  for (const endpoint of spec.endpoints.filter(item => item.method === 'get')) {
    lines.push('  action' + pascal(endpoint.name) + '(params: JSON, query: JSON, body: JSON): JSON');
  }
  lines.push('}', '');

  const mutations = [];
  for (const entity of spec.entities) {
    const names = graphqlNames(entity);
    if (entity.operations.create.enabled) mutations.push('  ' + names.create + '(input: ' + entity.name + 'CreateInput!): ' + entity.name + '!');
    if (entity.operations.update.enabled) mutations.push('  ' + names.update + '(id: ID!, input: ' + entity.name + 'UpdateInput!): ' + entity.name);
    if (entity.operations.delete.enabled) mutations.push('  ' + names.delete + '(id: ID!): Boolean!');
  }
  for (const endpoint of spec.endpoints.filter(item => item.method !== 'get')) {
    mutations.push('  action' + pascal(endpoint.name) + '(params: JSON, query: JSON, body: JSON): JSON');
  }
  if (mutations.length) lines.push('type Mutation {', ...mutations, '}', '');

  return lines.join('\n');
}

function controllerImports(spec, graphqlPath) {
  return spec.entities.map(entity => {
    const paths = filePaths(spec, entity.name);
    return 'const ' + entity.name + 'Controller = require(' + js(relativeRequire(graphqlPath, paths.controller)) + ');';
  });
}

function mongoImports(spec, graphqlPath) {
  return spec.entities.map(entity => {
    const paths = filePaths(spec, entity.name);
    return 'const ' + entity.name + 'Model = require(' + js(relativeRequire(graphqlPath, paths.model)) + ');';
  });
}

function entityResolverLines(spec) {
  const lines = [];
  for (const entity of spec.entities) {
    const entries = [
      'id(parent) { return String(parent.id !== undefined ? parent.id : parent._id); }'
    ];
    for (const field of entity.fields) {
      if (field.type === 'date') {
        entries.push(field.name + '(parent) { const value = parent[' + js(field.name) + ']; return value instanceof Date ? value.toISOString() : value; }');
      }
      if (field.type === 'reference') {
        entries.push(
          'async ' + field.name + '(parent, unused, context) {' +
          ' return resolveRelation(' + js(entity.name) + ', ' + js(field.name) + ', parent, context);' +
          ' }'
        );
      }
    }
    if (entity.schemaOptions.timestamps !== false) {
      entries.push(
        'createdAt(parent) { const value = parent.createdAt; return value instanceof Date ? value.toISOString() : value; }',
        'updatedAt(parent) { const value = parent.updatedAt; return value instanceof Date ? value.toISOString() : value; }'
      );
    }
    lines.push('resolvers[' + js(entity.name) + '] = {' + entries.join(', ') + '};');
  }
  return lines;
}

function targetRuntime(spec) {
  if (spec.database.type === 'mongodb') {
    const modelMap = '{' + spec.entities.map(entity => entity.name + ': ' + entity.name + 'Model').join(', ') + '}';
    return [
      'const models = ' + modelMap + ';',
      'async function loadEntities(entityName, ids) {',
      '  const meta = entities[entityName];',
      '  const filter = {_id: {$in: ids}};',
      '  if (meta.softDeleteField) filter[meta.softDeleteField] = null;',
      '  const rows = await models[entityName].find(filter).lean();',
      '  const byId = new Map(rows.map(row => [String(row._id), row]));',
      '  return ids.map(id => byId.get(String(id)) || null);',
      '}',
      'async function loadStoredRelation(sourceName, fieldName, parentIds) {',
      '  const meta = entities[sourceName];',
      '  const filter = {_id: {$in: parentIds}};',
      '  if (meta.softDeleteField) filter[meta.softDeleteField] = null;',
      '  const rows = await models[sourceName].find(filter).select({_id: 1, [fieldName]: 1}).lean();',
      '  const byId = new Map(rows.map(row => [String(row._id), row[fieldName]]));',
      '  return parentIds.map(id => byId.get(String(id)));',
      '}'
    ];
  }

  return [
    'const prisma = connectDatabase.client;',
    'async function loadEntities(entityName, ids) {',
    '  const meta = entities[entityName];',
    '  const where = {id: {in: ids}};',
    '  if (meta.softDeleteField) where[meta.softDeleteField] = null;',
    '  const rows = await prisma[meta.delegate].findMany({where});',
    '  const byId = new Map(rows.map(row => [String(row.id), row]));',
    '  return ids.map(id => byId.get(String(id)) || null);',
    '}',
    'async function loadStoredRelation(sourceName, fieldName, parentIds) {',
    '  const meta = entities[sourceName];',
    '  const rows = await prisma[meta.delegate].findMany({',
    '    where: {id: {in: parentIds}},',
    '    select: {id: true, [fieldName]: true}',
    '  });',
    '  const byId = new Map(rows.map(row => [String(row.id), row[fieldName]]));',
    '  return parentIds.map(id => byId.get(String(id)));',
    '}'
  ];
}

module.exports = function graphqlSource(spec) {
  const paths = filePaths(spec);
  const graphqlPath = paths.graphql;
  const entities = entityMetadata(spec);
  const endpoints = endpointMetadata(spec);
  const hasMutation = spec.entities.some(entity =>
    entity.operations.create.enabled || entity.operations.update.enabled || entity.operations.delete.enabled
  ) || spec.endpoints.some(endpoint => endpoint.method !== 'get');

  const lines = [
    "'use strict';", '',
    "const {graphql, GraphQLError, GraphQLScalarType, Kind} = require('graphql');",
    "const {makeExecutableSchema} = require('@graphql-tools/schema');",
    "const DataLoader = require('dataloader');",
    'const validation = require(' + js(relativeRequire(graphqlPath, paths.validation)) + ');',
    'const errorHandler = require(' + js(relativeRequire(graphqlPath, paths.errorHandler)) + ');',
    ...controllerImports(spec, graphqlPath),
    ...(spec.database.type === 'mongodb'
      ? mongoImports(spec, graphqlPath)
      : ['const connectDatabase = require(' + js(relativeRequire(graphqlPath, paths.database)) + ');']),
    ...(spec.auth.enabled ? ['const auth = require(' + js(relativeRequire(graphqlPath, paths.auth)) + ');'] : []),
    ...(spec.endpoints.length ? ['const workflows = require(' + js(relativeRequire(graphqlPath, paths.workflowEngine)) + ');'] : []),
    '',
    'const typeDefs = ' + js(typeDefs(spec)) + ';',
    'const entities = ' + js(entities) + ';',
    'const endpoints = ' + js(endpoints) + ';',
    '',
    'function parseLiteral(ast) {',
    '  if (ast.kind === Kind.NULL) return null;',
    '  if (ast.kind === Kind.STRING || ast.kind === Kind.BOOLEAN) return ast.value;',
    '  if (ast.kind === Kind.INT || ast.kind === Kind.FLOAT) return Number(ast.value);',
    '  if (ast.kind === Kind.LIST) return ast.values.map(parseLiteral);',
    '  if (ast.kind === Kind.OBJECT) return Object.fromEntries(ast.fields.map(field => [field.name.value, parseLiteral(field.value)]));',
    '  return undefined;',
    '}',
    'const JSONScalar = new GraphQLScalarType({',
    "  name: 'JSON',",
    '  serialize: value => value,',
    '  parseValue: value => value,',
    '  parseLiteral',
    '});',
    '',
    ...targetRuntime(spec),
    '',
    'function graphError(message, code, details, status) {',
    '  return new GraphQLError(message, {extensions: {code, ...(details ? {details} : {}), ...(status ? {httpStatus: status} : {})}});',
    '}',
    '',
    'function makeResponse(resolve, reject, req) {',
    '  return {',
    '    statusCode: 200, headersSent: false,',
    '    status(code) { this.statusCode = code; return this; },',
    '    json(body) {',
    '      this.headersSent = true;',
    '      if (this.statusCode >= 400) reject(graphError(body && body.error || "Request failed", "BAD_USER_INPUT", body && body.details, this.statusCode));',
    '      else resolve(body);',
    '      return this;',
    '    },',
    '    end() {',
    '      this.headersSent = true;',
    '      if (this.statusCode >= 400) reject(graphError("Request failed", "BAD_USER_INPUT", null, this.statusCode));',
    '      else resolve(true);',
    '      return this;',
    '    }',
    '  };',
    '}',
    '',
    'function invokeController(controller, req) {',
    '  return new Promise((resolve, reject) => {',
    '    const res = makeResponse(resolve, reject, req);',
    '    const next = error => {',
    '      if (!error) return reject(graphError("Controller did not complete", "INTERNAL_SERVER_ERROR"));',
    '      try { errorHandler(error, req, res, reject); } catch (handlerError) { reject(handlerError); }',
    '    };',
    '    Promise.resolve(controller(req, res, next)).catch(next);',
    '  });',
    '}',
    '',
    'function request(context, values = {}) {',
    '  return {',
    '    headers: context.req.headers || {},',
    '    body: values.body || {},',
    '    params: values.params || {},',
    '    query: values.query || {},',
    '    auth: null,',
    '    id: context.req.id',
    '  };',
    '}',
    '',
    'async function authorize(rule, req) {',
    ...(spec.auth.enabled ? [
      '  try { req.auth = await auth.readAuth(req, rule); }',
      '  catch (error) {',
      '    const code = error.statusCode === 403 ? "FORBIDDEN" : "UNAUTHENTICATED";',
      '    throw graphError(error.message, code, null, error.statusCode || 401);',
      '  }'
    ] : ['  if (rule.required) throw graphError("Authentication is not configured", "UNAUTHENTICATED", null, 401);']),
    '}',
    '',
    'function validateId(id) {',
    '  if (!validation.isIdentifier(String(id))) throw graphError("Invalid identifier", "BAD_USER_INPUT", null, 400);',
    '}',
    'function validateInput(entityName, input, partial) {',
    '  const errors = validation.validateBody(entityName, input, partial);',
    '  if (errors.length) throw graphError("Invalid request", "BAD_USER_INPUT", errors, 400);',
    '}',
    '',
    'function createLoaders() {',
    '  const entityLoaders = {};',
    '  const relationLoaders = {};',
    '  for (const [entityName, meta] of Object.entries(entities)) {',
    '    entityLoaders[entityName] = new DataLoader(ids => loadEntities(entityName, ids.map(String)));',
    '    for (const [fieldName, field] of Object.entries(meta.fields)) {',
    '      if (field.type === "reference" && field.many) {',
    '        relationLoaders[entityName + "." + fieldName] = new DataLoader(ids => loadStoredRelation(entityName, fieldName, ids.map(String)));',
    '      }',
    '    }',
    '  }',
    '  return {entityLoaders, relationLoaders};',
    '}',
    '',
    'async function resolveReferenceValue(value, ref, context) {',
    '  if (value === null || value === undefined) return null;',
    '  if (Array.isArray(value)) return Promise.all(value.map(item => resolveReferenceValue(item, ref, context)));',
    '  if (typeof value === "object") {',
    '    const targetFields = Object.keys(entities[ref].fields);',
    '    if (targetFields.some(name => value[name] !== undefined)) return value;',
    '    const scalarId = typeof value.id === "string" || typeof value.id === "number";',
    '    const identifier = value._id !== undefined ? value._id : (scalarId ? value.id : value);',
    '    return context.entityLoaders[ref].load(String(identifier));',
    '  }',
    '  return context.entityLoaders[ref].load(String(value));',
    '}',
    '',
    'async function resolveRelation(sourceName, fieldName, parent, context) {',
    '  const field = entities[sourceName].fields[fieldName];',
    '  let value = parent[fieldName];',
    '  if (value === undefined && !field.many && parent[fieldName + "Id"] !== undefined) value = parent[fieldName + "Id"];',
    '  if (value === undefined && field.many) {',
    '    const parentId = parent.id !== undefined ? parent.id : parent._id;',
    '    value = await context.relationLoaders[sourceName + "." + fieldName].load(String(parentId));',
    '  }',
    '  if (field.many && (value === null || value === undefined)) return [];',
    '  return resolveReferenceValue(value, field.ref, context);',
    '}',
    '',
    'const controllers = {' + spec.entities.map(entity => entity.name + ': ' + entity.name + 'Controller').join(', ') + '};',
    'const resolvers = {JSON: JSONScalar, Query: {_service: () => ' + js(spec.app.name) + '}' + (hasMutation ? ', Mutation: {}' : '') + '};',
    '',
    'for (const [entityName, meta] of Object.entries(entities)) {',
    '  const controller = controllers[entityName];',
    '  if (meta.operations.list.enabled) {',
    '    resolvers.Query[meta.names.list] = async (unused, args, context) => {',
    '      const query = {...(args.filter || {})};',
    '      const q = meta.operations.list.query;',
    '      if (args.sort !== undefined && q.sortParam) query[q.sortParam] = args.sort;',
    '      if (q.pagination && args.page !== undefined) query[q.pageParam] = args.page;',
    '      if (q.pagination && args.limit !== undefined) query[q.limitParam] = args.limit;',
    '      const req = request(context, {query});',
    '      await authorize(meta.operations.list.auth, req);',
    '      return invokeController(controller.list, req);',
    '    };',
    '  }',
    '  if (meta.operations.get.enabled) {',
    '    resolvers.Query[meta.names.get] = async (unused, args, context) => {',
    '      validateId(args.id);',
    '      const req = request(context, {params: {[meta.idParam]: String(args.id)}});',
    '      await authorize(meta.operations.get.auth, req);',
    '      return invokeController(controller.get, req);',
    '    };',
    '  }',
    '  if (meta.operations.create.enabled) {',
    '    resolvers.Mutation[meta.names.create] = async (unused, args, context) => {',
    '      if (meta.operations.create.validate) validateInput(entityName, args.input, false);',
    '      const req = request(context, {body: args.input});',
    '      await authorize(meta.operations.create.auth, req);',
    '      return invokeController(controller.create, req);',
    '    };',
    '  }',
    '  if (meta.operations.update.enabled) {',
    '    resolvers.Mutation[meta.names.update] = async (unused, args, context) => {',
    '      validateId(args.id);',
    '      if (meta.operations.update.validate) validateInput(entityName, args.input, true);',
    '      const req = request(context, {body: args.input, params: {[meta.idParam]: String(args.id)}});',
    '      await authorize(meta.operations.update.auth, req);',
    '      return invokeController(controller.update, req);',
    '    };',
    '  }',
    '  if (meta.operations.delete.enabled) {',
    '    resolvers.Mutation[meta.names.delete] = async (unused, args, context) => {',
    '      validateId(args.id);',
    '      const req = request(context, {params: {[meta.idParam]: String(args.id)}});',
    '      await authorize(meta.operations.delete.auth, req);',
    '      return Boolean(await invokeController(controller.remove, req));',
    '    };',
    '  }',
    '}',
    '',
    ...(spec.endpoints.length ? [
      'for (const [fieldName, endpoint] of Object.entries(endpoints)) {',
      '  const target = endpoint.method === "get" ? resolvers.Query : resolvers.Mutation;',
      '  target[fieldName] = async (unused, args, context) => {',
      '    const req = request(context, {params: args.params || {}, query: args.query || {}, body: args.body || {}});',
      '    await authorize(endpoint.auth, req);',
      '    const output = await workflows.execute(endpoint.workflow, req);',
      '    const result = output.result;',
      '    return result && result.__response ? result.body : result;',
      '  };',
      '}',
      ''
    ] : []),
    ...entityResolverLines(spec),
    '',
    'const schema = makeExecutableSchema({typeDefs, resolvers});',
    '',
    'async function handler(req, res) {',
    '  const input = req.method === "GET" ? req.query : req.body;',
    '  const source = input && input.query;',
    '  if (!source) return res.status(400).json({errors: [{message: "GraphQL query is required"}]});',
    '  try {',
    '    const loaders = createLoaders();',
    '    const result = await graphql({',
    '      schema, source,',
    '      variableValues: input.variables,',
    '      operationName: input.operationName,',
    '      contextValue: {req, ...loaders}',
    '    });',
    '    return res.status(200).json(result);',
    '  } catch (error) {',
    '    return res.status(500).json({errors: [{message: error.message || "GraphQL execution failed"}]});',
    '  }',
    '}',
    '',
    'module.exports = {handler, schema, typeDefs};',
    ''
  ];

  return lines.join('\n');
};
