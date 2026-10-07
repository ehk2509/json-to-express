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
  assert.equal(validateSpec(validSpec).specVersion, '1.0');

  const normalized = normalizeSpec(validSpec);
  assert.equal(normalized.app.packageName, 'demo-api');
  assert.equal(normalized.app.package.name, 'demo-api');
  assert.equal(normalized.app.apiPrefix, '/api');
  assert.equal(normalized.app.health.path, '/health');
  assert.equal(normalized.app.express.json.enabled, true);
  assert.equal(normalized.entities[0].route, 'products');
  assert.equal(normalized.entities[0].operations.create.method, 'post');
  assert.equal(normalized.database.uriEnv, 'MONGODB_URI');
});

test('JSON Schema is the structural source of truth and rejects unknown properties', () => {
  assert.throws(
    () => validateSpec({
      app: {name: 'demo', apiPrefx: '/typo'},
      database: {type: 'mongodb'},
      entities: {Product: {fields: {name: {type: 'string'}}}}
    }),
    error => {
      assert.ok(error instanceof SpecificationError);
      assert.match(error.message, /apiPrefx is not a supported property/);
      return true;
    }
  );
});

test('collects structural validation failures', () => {
  assert.throws(
    () => validateSpec({
      app: {name: ''},
      database: {type: 'postgres'},
      entities: {
        product: {fields: {price: {type: 'money'}}}
      }
    }),
    error => {
      assert.match(error.message, /app\.name/);
      assert.match(error.message, /database\.type/);
      assert.match(error.message, /invalid property name/);
      assert.match(error.message, /money/);
      return true;
    }
  );
});

test('semantic validation catches cross-field constraints', () => {
  const invalid = {
    app: {name: 'demo'},
    database: {type: 'mongodb'},
    entities: {
      Product: {
        idParam: 'productId',
        operations: {
          get: {method: 'get', path: '/item/:id'},
          update: {path: '/item'},
          list: {
            query: {
              pagination: {
                enabled: true,
                defaultLimit: 100,
                maxLimit: 10
              }
            }
          }
        },
        fields: {
          name: {type: 'string', enum: [1, 2]}
        }
      }
    }
  };

  assert.throws(
    () => validateSpec(invalid),
    error => {
      assert.match(error.message, /:productId/);
      assert.match(error.message, /defaultLimit must be <= maxLimit/);
      assert.match(error.message, /enum values must be strings/);
      return true;
    }
  );
});

test('rejects unsafe generated layout paths', () => {
  assert.throws(
    () => validateSpec({
      generation: {paths: {source: '../outside'}},
      app: {name: 'demo'},
      database: {type: 'mongodb'},
      entities: {Product: {fields: {name: {type: 'string'}}}}
    }),
    /safe relative path/
  );
});


test('validates references, indexes and auth semantics', () => {
  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      auth: {enabled: false},
      app: {name: 'demo'},
      database: {type: 'mongodb'},
      entities: {
        Product: {
          indexes: [{fields: {missing: 1}}],
          operations: {get: {auth: true, populate: ['category']}},
          fields: {
            category: {type: 'reference', ref: 'MissingEntity'}
          }
        }
      }
    }),
    error => {
      assert.match(error.message, /requires top-level auth\.enabled/);
      assert.match(error.message, /references unknown entity/);
      assert.match(error.message, /unknown field/);
      return true;
    }
  );
});
