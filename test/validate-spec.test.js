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


test('enforces remaining PostgreSQL Prisma capability boundaries', () => {
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
        supported: {steps: [{name: 'done', action: 'respond', body: {ok: true}}]}
      }
    }),
    error => {
      assert.match(error.message, /idStrategy must be "uuid"/);
      assert.match(error.message, /database\.options is only supported by the mongodb target/);
      assert.match(error.message, /schemaOptions is only supported by the mongodb target/);
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


test('validates admin UI paths entities fields and operation capabilities', () => {
  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'admin-api'},
      database: {type: 'mongodb'},
      admin: {
        enabled: true,
        outputDir: '../admin',
        entities: {
          Missing: {listFields: ['name']},
          Product: {
            titleField: 'missing',
            listFields: ['unknown'],
            filterFields: ['price'],
            fields: {ghost: {label: 'Ghost'}},
            create: true
          }
        }
      },
      entities: {
        Product: {
          operations: {create: false, list: {query: {filters: ['name']}}},
          fields: {
            name: {type: 'string'},
            price: {type: 'number'}
          }
        }
      }
    }),
    error => {
      assert.match(error.message, /admin\.outputDir must be a safe relative path/);
      assert.match(error.message, /admin\.entities\.Missing references unknown entity/);
      assert.match(error.message, /titleField references unknown field missing/);
      assert.match(error.message, /listFields references unknown field unknown/);
      assert.match(error.message, /filterFields field price is not allowed/);
      assert.match(error.message, /fields references unknown field ghost/);
      assert.match(error.message, /create cannot be enabled when create operation is disabled/);
      return true;
    }
  );
});


test('accepts PostgreSQL workflows events jobs and custom endpoints', () => {
  assert.doesNotThrow(() => validateSpec({
    specVersion: '1.0',
    app: {name: 'postgres-workflow-api'},
    database: {type: 'postgresql'},
    entities: {
      Product: {
        fields: {
          name: {type: 'string', required: true},
          price: {type: 'number', required: true}
        }
      }
    },
    events: {
      'product.changed': {webhooks: []}
    },
    workflows: {
      updatePrice: {
        transaction: true,
        steps: [
          {name: 'update', action: 'updateById', entity: 'Product', id: '$body.id', data: {price: '$body.price'}},
          {name: 'event', action: 'emit', event: 'product.changed', payload: {id: '$steps.update.id'}},
          {name: 'done', action: 'respond', body: {id: '$steps.update.id'}}
        ]
      },
      queueUpdate: {
        steps: [
          {name: 'job', action: 'enqueue', job: 'updatePrice', payload: {id: '$params.id', price: '$body.price'}}
        ]
      }
    },
    jobs: {
      updatePrice: {workflow: 'updatePrice', queue: 'products'}
    },
    endpoints: {
      queueUpdate: {method: 'post', path: '/products/:id/update-price', workflow: 'queueUpdate'}
    }
  }));
});


test('accepts PostgreSQL many-to-many references and rejects incompatible indexes/unique', () => {
  assert.doesNotThrow(() => validateSpec({
    specVersion: '1.0',
    app: {name: 'many-api'},
    database: {type: 'postgresql'},
    entities: {
      Tag: {fields: {name: {type: 'string', required: true}}},
      Product: {
        operations: {
          list: {populate: ['tags'], query: {filters: ['tags'], operators: ['eq', 'in']}},
          get: {populate: ['tags']}
        },
        fields: {
          name: {type: 'string', required: true},
          tags: {type: 'reference', ref: 'Tag', many: true, onDelete: 'nullify'}
        }
      }
    }
  }));

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'bad-many-api'},
      database: {type: 'postgresql'},
      entities: {
        Tag: {fields: {name: {type: 'string'}}},
        Product: {
          indexes: [{fields: {tags: 1}}],
          fields: {
            tags: {type: 'reference', ref: 'Tag', many: true, unique: true}
          }
        }
      }
    }),
    error => {
      assert.match(error.message, /unique is not supported for many references on postgresql/);
      assert.match(error.message, /cannot index an implicit many-to-many relation on postgresql/);
      return true;
    }
  );
});


test('validates GraphQL API target semantics', () => {
  assert.doesNotThrow(() => validateSpec({
    specVersion: '1.0',
    api: {rest: false, graphql: {enabled: true, path: '/graphql'}},
    app: {name: 'graphql-only'},
    database: {type: 'mongodb'},
    entities: {
      Product: {fields: {name: {type: 'string'}}}
    }
  }));

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      api: {rest: false, graphql: false},
      app: {name: 'no-api'},
      database: {type: 'mongodb'},
      entities: {Product: {fields: {name: {type: 'string'}}}}
    }),
    /api must enable at least one of rest or graphql/
  );

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      api: {graphql: {enabled: true, path: '/health'}},
      app: {name: 'collision', health: {enabled: true, path: '/health'}},
      database: {type: 'mongodb'},
      entities: {Product: {fields: {id: {type: 'string'}, '__secret': {type: 'string'}}}}
    }),
    error => {
      assert.match(error.message, /api\.graphql\.path cannot be the same as app\.health\.path/);
      assert.match(error.message, /fields\.id is reserved by the GraphQL target/);
      assert.match(error.message, /fields\.__secret is not a valid GraphQL field name/);
      return true;
    }
  );
});


test('validates multi-strategy authentication semantics', () => {
  assert.doesNotThrow(() => validateSpec({
    specVersion: '1.0',
    app: {name: 'multi-auth'},
    database: {type: 'mongodb'},
    auth: {
      enabled: true,
      strategies: ['jwt', 'apiKey', 'session', 'oidc'],
      jwt: {refresh: {enabled: true}},
      apiKey: {keys: [{env: 'SERVICE_KEY', roles: ['admin']}]},
      session: {secure: true, sameSite: 'none'},
      local: {enabled: true},
      oidc: {enabled: true, issuer: 'https://id.example.test'}
    },
    entities: {
      Product: {
        operations: {
          list: {auth: {required: true, strategies: ['apiKey', 'oidc'], roles: ['admin']}}
        },
        fields: {name: {type: 'string'}}
      }
    }
  }));

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'bad-auth'},
      database: {type: 'mongodb'},
      auth: {
        enabled: true,
        strategy: 'jwt',
        strategies: ['apiKey'],
        apiKey: {keys: []},
        session: {secure: false, sameSite: 'none'},
        local: {enabled: true},
        oidc: {enabled: true}
      },
      entities: {
        Product: {
          operations: {
            list: {auth: {strategies: ['session']}}
          },
          fields: {name: {type: 'string'}}
        }
      }
    }),
    error => {
      assert.match(error.message, /auth\.strategy and auth\.strategies cannot both be configured/);
      assert.match(error.message, /auth\.apiKey\.keys must contain at least one key/);
      assert.match(error.message, /auth\.local\.enabled requires jwt or session/);
      assert.match(error.message, /auth\.oidc\.issuer is required/);
      assert.match(error.message, /sameSite "none" requires auth\.session\.secure true/);
      assert.match(error.message, /references disabled auth strategy "session"/);
      return true;
    }
  );

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      api: {graphql: {enabled: true, path: '/auth/login'}},
      app: {name: 'auth-route-collision'},
      database: {type: 'mongodb'},
      auth: {
        enabled: true,
        strategies: ['jwt'],
        local: {enabled: true, loginPath: '/auth/login'}
      },
      entities: {Product: {fields: {name: {type: 'string'}}}}
    }),
    /auth\.local\.loginPath cannot be the same as api\.graphql\.path/
  );
});


test('validates observability endpoint collisions', () => {
  assert.doesNotThrow(() => validateSpec({
    specVersion: '1.0',
    app: {name: 'observable'},
    database: {type: 'mongodb'},
    observability: {
      enabled: true,
      metrics: {path: '/metrics'},
      health: {
        liveness: {path: '/health/live'},
        readiness: {path: '/health/ready'}
      }
    },
    entities: {Product: {fields: {name: {type: 'string'}}}}
  }));

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      api: {graphql: {enabled: true, path: '/metrics'}},
      app: {name: 'bad-observable', health: {enabled: true, path: '/health/live'}},
      database: {type: 'mongodb'},
      observability: {
        enabled: true,
        metrics: {path: '/metrics'},
        health: {
          liveness: {path: '/health/live'},
          readiness: {path: '/metrics'}
        }
      },
      entities: {Product: {fields: {name: {type: 'string'}}}}
    }),
    error => {
      assert.match(error.message, /observability\.metrics\.path cannot be the same as api\.graphql\.path/);
      assert.match(error.message, /observability\.health\.liveness\.path cannot be the same as app\.health\.path/);
      assert.match(error.message, /observability\.health\.readiness\.path duplicates observability route \/metrics/);
      return true;
    }
  );
});


test('validates declarative cache policies and distributed topology constraints', () => {
  assert.doesNotThrow(() => validateSpec({
    specVersion: '1.0',
    app: {name: 'cached-api'},
    database: {type: 'mongodb'},
    cache: {enabled: true, provider: 'redis'},
    entities: {
      Product: {
        operations: {list: {cache: true}, get: {cache: {ttlSeconds: 30}}},
        fields: {name: {type: 'string'}}
      }
    },
    workflows: {
      updateProduct: {
        steps: [{name: 'update', action: 'updateById', entity: 'Product', id: '$body.id', data: {name: '$body.name'}}]
      }
    },
    jobs: {updateProduct: {workflow: 'updateProduct'}},
    outbox: {worker: 'separate'},
    deployment: {kubernetes: {enabled: true, image: 'cached:latest', replicas: 3}}
  }));

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'missing-cache-root'},
      database: {type: 'mongodb'},
      entities: {
        Product: {
          operations: {get: {cache: true}},
          fields: {name: {type: 'string'}}
        }
      }
    }),
    /operations\.get\.cache requires top-level cache\.enabled/
  );

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'mutation-cache'},
      database: {type: 'mongodb'},
      cache: {enabled: true},
      entities: {
        Product: {
          operations: {update: {cache: true}},
          fields: {name: {type: 'string'}}
        }
      }
    }),
    /operations\.update\.cache can only be enabled for list\/get operations/
  );

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'memory-worker'},
      database: {type: 'mongodb'},
      cache: {enabled: true, provider: 'memory'},
      entities: {Product: {fields: {name: {type: 'string'}}}},
      workflows: {
        updateProduct: {
          steps: [{name: 'update', action: 'updateById', entity: 'Product', id: '$body.id', data: {name: '$body.name'}}]
        }
      },
      jobs: {updateProduct: {workflow: 'updateProduct'}},
      outbox: {worker: 'separate'}
    }),
    /cache\.provider "memory" cannot be used with outbox\.worker "separate"/
  );

  assert.throws(
    () => validateSpec({
      specVersion: '1.0',
      app: {name: 'memory-replicas'},
      database: {type: 'mongodb'},
      cache: {enabled: true, provider: 'memory'},
      entities: {Product: {fields: {name: {type: 'string'}}}},
      deployment: {kubernetes: {enabled: true, image: 'memory:latest', replicas: 2}}
    }),
    /cache\.provider "memory" cannot be used with multiple Kubernetes replicas/
  );
});
