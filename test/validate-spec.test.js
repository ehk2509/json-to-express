'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeSpec, validateSpec, SpecificationError} = require('../src');

const validSpec = {
  app: {name: 'demo-api', port: 3100},
  database: {type: 'mongodb'},
  entities: {
    Product: {
      fields: {
        name: {type: 'string', required: true},
        price: {type: 'number', min: 0}
      }
    }
  }
};

test('validates and normalizes a minimal application specification', () => {
  assert.equal(validateSpec(validSpec), validSpec);

  const normalized = normalizeSpec(validSpec);
  assert.equal(normalized.app.packageName, 'demo-api');
  assert.equal(normalized.app.package.name, 'demo-api');
  assert.equal(normalized.app.apiPrefix, '/api');
  assert.equal(normalized.app.health.path, '/health');
  assert.equal(normalized.entities[0].route, 'products');
  assert.equal(normalized.entities[0].operations.create.method, 'post');
  assert.equal(normalized.database.uriEnv, 'MONGODB_URI');
});

test('collects useful validation failures', () => {
  assert.throws(
    () => validateSpec({
      app: {name: ''},
      database: {type: 'postgres'},
      entities: {
        product: {fields: {price: {type: 'money'}}}
      }
    }),
    error => {
      assert.ok(error instanceof SpecificationError);
      assert.match(error.message, /app\.name/);
      assert.match(error.message, /database\.type/);
      assert.match(error.message, /PascalCase/);
      assert.match(error.message, /money/);
      return true;
    }
  );
});

test('rejects inconsistent customizable endpoint settings', () => {
  const invalid = {
    app: {
      name: 'demo',
      statusCodes: {internalError: 700},
      health: {path: 'health'}
    },
    database: {type: 'mongodb'},
    entities: {
      Product: {
        idParam: 'productId',
        operations: {
          get: {method: 'trace', path: '/item/:id'},
          update: {path: '/item'}
        },
        fields: {
          name: {type: 'string', options: 'trim'}
        }
      }
    }
  };

  assert.throws(
    () => validateSpec(invalid),
    error => {
      assert.match(error.message, /health\.path/);
      assert.match(error.message, /statusCodes\.internalError/);
      assert.match(error.message, /method must be one of/);
      assert.match(error.message, /:productId/);
      assert.match(error.message, /options must be an object/);
      return true;
    }
  );
});
