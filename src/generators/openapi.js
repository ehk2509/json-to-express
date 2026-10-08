'use strict';

const {joinUrl} = require('./utils');

function identifierSchema(spec) {
  return spec.database.type === 'postgresql'
    ? {type: 'string', format: 'uuid'}
    : {type: 'string', pattern: '^[a-fA-F0-9]{24}$'};
}

function filterSchema(field, spec) {
  if (!field) return {};
  if (field.type === 'reference') return identifierSchema(spec);
  return fieldSchema(field, spec);
}

function fileMetadataSchema(field) {
  const item = {
    type: 'object',
    properties: {
      key: {type: 'string'},
      originalName: {type: 'string'},
      mimeType: {type: 'string'},
      size: {type: 'integer', minimum: 0},
      checksumSha256: {type: 'string'},
      provider: {enum: ['local', 's3']},
      uploadedAt: {type: 'string', format: 'date-time'},
      url: {type: ['string', 'null'], format: 'uri'}
    },
    required: ['key', 'originalName', 'mimeType', 'size', 'checksumSha256', 'provider', 'uploadedAt']
  };
  return field.many ? {type: 'array', items: item} : item;
}

function uploadFieldSchema(field) {
  const binary = {type: 'string', format: 'binary'};
  return field.many ? {type: 'array', items: binary} : binary;
}

function fieldSchema(field, spec) {
  if (field.type === 'file') return fileMetadataSchema(field);
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

  if (spec.auth.jwt.enabled) {
    document.components.securitySchemes.jwtAuth = {type: 'http', scheme: 'bearer', bearerFormat: 'JWT'};
  }
  if (spec.auth.apiKey.enabled) {
    document.components.securitySchemes.apiKeyAuth = {type: 'apiKey', in: 'header', name: spec.auth.apiKey.header};
  }
  if (spec.auth.session.enabled) {
    document.components.securitySchemes.sessionAuth = {type: 'apiKey', in: 'cookie', name: spec.auth.session.cookieName};
  }
  if (spec.auth.oidc.enabled) {
    document.components.securitySchemes.oidcAuth = {
      type: 'openIdConnect',
      openIdConnectUrl: String(spec.auth.oidc.issuer).replace(/\/$/, '') + '/.well-known/openid-configuration'
    };
  }

  const securityFor = rule => {
    if (!rule || !rule.required) return undefined;
    const names = {jwt: 'jwtAuth', apiKey: 'apiKeyAuth', session: 'sessionAuth', oidc: 'oidcAuth'};
    return (rule.strategies || spec.auth.strategies)
      .filter(strategy => names[strategy] && document.components.securitySchemes[names[strategy]])
      .map(strategy => ({[names[strategy]]: []}));
  };

  if (spec.auth.local.enabled && spec.auth.local.allowRegistration) {
    document.paths[spec.auth.local.registerPath] = {
      post: {
        operationId: 'authRegister',
        requestBody: {required: true, content: {'application/json': {schema: {
          type: 'object', required: ['email', 'password'],
          properties: {email: {type: 'string', format: 'email'}, password: {type: 'string', minLength: spec.auth.local.passwordMinLength}}
        }}}},
        responses: {'201': {description: 'Registered'}, '409': {description: 'Account already exists'}}
      }
    };
  }
  if (spec.auth.local.enabled) {
    document.paths[spec.auth.local.loginPath] = {
      post: {
        operationId: 'authLogin',
        requestBody: {required: true, content: {'application/json': {schema: {
          type: 'object', required: ['email', 'password'],
          properties: {email: {type: 'string', format: 'email'}, password: {type: 'string'}}
        }}}},
        responses: {'200': {description: 'Authenticated'}, '401': {description: 'Invalid credentials'}}
      }
    };
    document.paths[spec.auth.local.forgotPasswordPath] = {
      post: {operationId: 'authForgotPassword', responses: {'202': {description: 'Reset request accepted'}}}
    };
    document.paths[spec.auth.local.resetPasswordPath] = {
      post: {operationId: 'authResetPassword', responses: {'200': {description: 'Password reset'}}}
    };
  }
  if (spec.auth.jwt.refresh.enabled) {
    document.paths[spec.auth.jwt.refresh.path] = {
      post: {operationId: 'authRefresh', responses: {'200': {description: 'Tokens rotated'}, '401': {description: 'Invalid refresh token'}}}
    };
  }
  if (spec.auth.local.enabled || spec.auth.session.enabled || spec.auth.jwt.refresh.enabled) {
    document.paths[spec.auth.local.logoutPath] = {
      post: {operationId: 'authLogout', responses: {'204': {description: 'Logged out'}}}
    };
  }
  if (spec.auth.oidc.enabled) {
    document.paths[spec.auth.oidc.loginPath] = {
      get: {operationId: 'authOidcLogin', responses: {'302': {description: 'Redirect to OIDC provider'}}}
    };
    document.paths[spec.auth.oidc.callbackPath] = {
      get: {operationId: 'authOidcCallback', responses: {'200': {description: 'OIDC login completed'}, '302': {description: 'Configured success redirect'}}}
    };
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
    if (endpoint.auth.required) operation.security = securityFor(endpoint.auth);
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
        for (const filter of op.query.filters) {
          const field = entity.fields.find(item => item.name === filter);
          const baseSchema = filterSchema(field, spec);
          operation.parameters.push({name: filter, in: 'query', schema: baseSchema});
          for (const operator of op.query.operators) {
            if (operator === 'eq') continue;
            operation.parameters.push({
              name: filter + '__' + operator,
              in: 'query',
              schema: operator === 'in' ? {type: 'array', items: baseSchema} : baseSchema
            });
          }
        }
        if (op.query.sortParam) operation.parameters.push({name: op.query.sortParam, in: 'query', schema: {type: 'string'}});
        if (op.query.selectParam) operation.parameters.push({name: op.query.selectParam, in: 'query', schema: {type: 'string'}});
        if (op.query.pagination.enabled) {
          operation.parameters.push({name: op.query.pagination.pageParam, in: 'query', schema: {type: 'integer', minimum: 1}});
          operation.parameters.push({name: op.query.pagination.limitParam, in: 'query', schema: {type: 'integer', minimum: 1, maximum: op.query.pagination.maxLimit}});
        }
      }
      if (['create', 'update'].includes(name)) {
        const fileFields = entity.fields.filter(field => field.type === 'file');
        if (fileFields.length) {
          const multipartProperties = {};
          const multipartRequired = [];
          for (const field of entity.fields) {
            multipartProperties[field.name] = field.type === 'file' ? uploadFieldSchema(field) : fieldSchema(field, spec);
            if (name === 'create' && field.required) multipartRequired.push(field.name);
          }
          operation.requestBody = {
            required: name === 'create',
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: multipartProperties,
                  ...(multipartRequired.length ? {required: multipartRequired} : {})
                }
              },
              'application/json': {
                schema: {$ref: '#/components/schemas/' + entity.name},
                description: 'JSON requests cannot attach new files; file fields may only be cleared with null.'
              }
            }
          };
        } else {
          operation.requestBody = {
            required: name === 'create',
            content: {'application/json': {schema: {$ref: '#/components/schemas/' + entity.name}}}
          };
        }
      }
      if (op.auth.required) operation.security = securityFor(op.auth);
      document.paths[full][op.method] = operation;
    }
  }

  return JSON.stringify(document, null, 2) + '\n';
};
