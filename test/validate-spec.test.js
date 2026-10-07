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
  assert.equal(normalized.entities[0].route, 'products');
  assert.equal(normalized.database.uriEnv, 'MONGODB_URI');
});

test('collects useful validation failures', () => {
  assert.throws(
    () => validateSpec({
      app: {name: ''},
      database: {type: 'postgres'},
      entities: {product: {fields: {price: {type: 'money'}}}}
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
