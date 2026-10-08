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


test('validates workflow targets, step ordering and custom endpoint references', () => {
  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'workflow-api'},
      database: {type: 'mongodb'},
      entities: {Order: {fields: {status: {type: 'string'}}}},
      events: {'order.done': {}},
      workflows: {
        broken: {
          steps: [
            {name: 'update', action: 'updateById', entity: 'Missing', id: '$steps.load._id', data: {status: 'done'}},
            {name: 'load', action: 'findById', entity: 'Order', id: '$params.id'},
            {name: 'emit', action: 'emit', event: 'missing.event', payload: {id: '$steps.load._id'}}
          ]
        }
      },
      endpoints: {
        run: {method: 'post', path: '/run', workflow: 'missingWorkflow'}
      }
    }),
    error => {
      assert.match(error.message, /unknown workflow/);
      assert.match(error.message, /unknown entity/);
      assert.match(error.message, /unavailable prior step/);
      assert.match(error.message, /unknown event/);
      return true;
    }
  );
});


test('validates queued jobs and enqueue targets', () => {
  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'jobs-api'},
      database: {type: 'mongodb'},
      entities: {Order: {fields: {status: {type: 'string'}}}},
      jobs: {
        brokenJob: {workflow: 'missingWorkflow'}
      },
      workflows: {
        enqueueBroken: {
          steps: [
            {name: 'job', action: 'enqueue', job: 'missingJob', payload: {id: '$body.id'}}
          ]
        }
      }
    }),
    error => {
      assert.match(error.message, /jobs\.brokenJob\.workflow references unknown workflow/);
      assert.match(error.message, /job references unknown job/);
      return true;
    }
  );
});


test('enforces PostgreSQL Prisma capability boundaries', () => {
  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'postgres-api'},
      database: {type: 'postgresql', idStrategy: 'objectId', options: {pool: 2}},
      entities: {
        Category: {fields: {name: {type: 'string'}}},
        Product: {
          schemaOptions: {timestamps: false},
          fields: {
            category: {
              type: 'reference',
              ref: 'Category',
              required: true,
              many: true,
              onDelete: 'nullify',
              options: {index: true}
            }
          }
        }
      },
      workflows: {
        unsupported: {steps: [{name: 'done', action: 'respond', body: {ok: true}}]}
      }
    }),
    error => {
      assert.match(error.message, /idStrategy must be "uuid"/);
      assert.match(error.message, /database\.options is only supported by the mongodb target/);
      assert.match(error.message, /workflows are not yet supported by the postgresql target/);
      assert.match(error.message, /schemaOptions is only supported by the mongodb target/);
      assert.match(error.message, /many is not yet supported by the postgresql target/);
      assert.match(error.message, /cannot use onDelete "nullify"/);
      assert.match(error.message, /\.options is only supported by the mongodb target/);
      return true;
    }
  );
});


test('validates deployment paths and Compose Docker dependency', () => {
  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'deploy-api'},
      database: {type: 'mongodb'},
      deployment: {
        docker: {enabled: false, file: '../Dockerfile'},
        compose: {enabled: true, file: '../compose.yml'},
        kubernetes: {enabled: true, directory: '../k8s'}
      },
      entities: {Product: {fields: {name: {type: 'string'}}}}
    }),
    error => {
      assert.match(error.message, /deployment\.docker\.file must be a safe relative path/);
      assert.match(error.message, /deployment\.compose\.file must be a safe relative path/);
      assert.match(error.message, /deployment\.kubernetes\.directory must be a safe relative path/);
      assert.match(error.message, /deployment\.compose\.enabled requires deployment\.docker\.enabled/);
      return true;
    }
  );
});


test('validates generated SDK output path safety', () => {
  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'sdk-api'},
      database: {type: 'mongodb'},
      sdk: {enabled: true, outputDir: '../client'},
      entities: {Product: {fields: {name: {type: 'string'}}}}
    }),
    /sdk\.outputDir must be a safe relative path/
  );
});
