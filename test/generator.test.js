'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {generateApplication, normalizeSpec} = require('../src');

const spec = {
  generation: {
    paths: {
      source: 'app',
      models: 'domain',
      controllers: 'handlers',
      routes: 'http',
      config: 'settings',
      middleware: 'middleware',
      tests: 'spec'
    }
  },
  app: {
    name: 'shop-api',
    port: 4100,
    portEnv: 'HTTP_PORT',
    host: '127.0.0.1',
    hostEnv: 'HTTP_HOST',
    startupMessage: 'shop ready at {host}:{port}',
    apiPrefix: '/v1',
    health: {
      enabled: true,
      path: '/ready',
      status: 203,
      response: {service: 'shop', ready: true}
    },
    middlewareModules: ['custom/request-context.js'],
    express: {
      trustProxy: 1,
      json: {enabled: true, limit: '2mb'},
      urlencoded: {enabled: true, extended: false, limit: '3mb'}
    },
    responses: {
      notFound: {code: 'ROUTE_NOT_FOUND'},
      validationError: 'Bad payload',
      invalidIdentifier: 'Bad id',
      uniqueConstraint: 'Already exists',
      internalError: 'Unexpected'
    },
    statusCodes: {
      notFound: 410,
      validationError: 422,
      invalidIdentifier: 422,
      uniqueConstraint: 409,
      internalError: 503
    },
    package: {
      name: 'custom-shop-service',
      version: '2.3.4',
      private: false,
      description: 'Custom generated shop service',
      nodeEngine: '>=20',
      scripts: {lint: 'node --check app/app.js'},
      dependencies: {express: '^5.1.0'},
      devDependencies: {supertest: '^7.1.0'}
    }
  },
  database: {
    type: 'mongodb',
    uriEnv: 'SHOP_MONGO_URL',
    defaultUri: 'mongodb://db.internal/custom-shop',
    options: {maxPoolSize: 12}
  },
  entities: {
    Product: {
      route: 'catalog',
      collection: 'catalog_items',
      idParam: 'productId',
      notFoundResponse: {code: 'PRODUCT_NOT_FOUND'},
      hooks: {
        module: 'custom/product-hooks.js',
        before: {list: 'beforeList'},
        after: {update: 'afterUpdate'}
      },
      schemaOptions: {timestamps: false, versionKey: 'revision'},
      operations: {
        list: {
          method: 'post',
          path: '/search',
          status: 202,
          lean: false,
          query: {
            filters: ['name', 'featured'],
            sortParam: 'order',
            selectParam: 'fields',
            pagination: {
              enabled: true,
              pageParam: 'p',
              limitParam: 'size',
              defaultLimit: 10,
              maxLimit: 50
            }
          }
        },
        get: {path: '/item/:productId', status: 202, notFoundStatus: 410, selectParam: 'fields'},
        create: false,
        update: {method: 'put', path: '/item/:productId', status: 202, runValidators: false},
        delete: {path: '/item/:productId', status: 200}
      },
      fields: {
        name: {type: 'string', required: true, minLength: 2, options: {trim: true, index: true}},
        price: {type: 'number', required: true, min: 0},
        featured: {type: 'boolean', default: false}
      }
    },
    Category: {
      operations: {delete: false},
      fields: {name: {type: 'string', required: true, unique: true}}
    }
  }
};

test('normalizes configurable runtime, query and layout settings', () => {
  const normalized = normalizeSpec(spec);
  assert.equal(normalized.app.apiPrefix, '/v1');
  assert.equal(normalized.app.host, '127.0.0.1');
  assert.equal(normalized.app.express.urlencoded.enabled, true);
  assert.equal(normalized.app.package.main, 'app/server.js');
  assert.equal(normalized.database.options.maxPoolSize, 12);
  assert.equal(normalized.generation.paths.controllers, 'handlers');
  assert.deepEqual(normalized.entities[0].operations.list.query.filters, ['name', 'featured']);
  assert.equal(normalized.entities[0].operations.list.query.pagination.maxLimit, 50);
  assert.equal(normalized.entities[0].operations.create.enabled, false);
});

test('generates configured project structure and behavior', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));
  const output = path.join(tempRoot, 'shop-api');
  const result = generateApplication(spec, output);

  assert.ok(result.files.includes('app/domain/Product.js'));
  assert.ok(result.files.includes('app/handlers/ProductController.js'));
  assert.ok(result.files.includes('app/http/ProductRoutes.js'));
  assert.ok(result.files.includes('spec/health.test.js'));
  assert.ok(result.files.includes('.j2e-manifest.json'));

  const appSource = fs.readFileSync(path.join(output, 'app/app.js'), 'utf8');
  assert.match(appSource, /\/v1\/catalog/);
  assert.match(appSource, /\/ready/);
  assert.match(appSource, /express\.urlencoded/);
  assert.match(appSource, /trust proxy/);
  assert.match(appSource, /ROUTE_NOT_FOUND/);
  assert.match(appSource, /request-context/);
  assert.match(appSource, /customMiddleware0/);

  const routesSource = fs.readFileSync(path.join(output, 'app/http/ProductRoutes.js'), 'utf8');
  assert.match(routesSource, /router\.post\("\/search"/);
  assert.match(routesSource, /router\.put\("\/item\/:productId"/);
  assert.doesNotMatch(routesSource, /controller\.create/);

  const controllerSource = fs.readFileSync(path.join(output, 'app/handlers/ProductController.js'), 'utf8');
  assert.match(controllerSource, /req\.params\["productId"\]/);
  assert.match(controllerSource, /for \(const field of \["name","featured"\]\)/);
  assert.match(controllerSource, /req\.query\["order"\]/);
  assert.match(controllerSource, /req\.query\["fields"\]/);
  assert.match(controllerSource, /req\.query\["size"\]/);
  assert.match(controllerSource, /\.skip\(/);
  assert.match(controllerSource, /PRODUCT_NOT_FOUND/);
  assert.match(controllerSource, /product-hooks/);
  assert.match(controllerSource, /beforeList/);
  assert.match(controllerSource, /afterUpdate/);

  const modelSource = fs.readFileSync(path.join(output, 'app/domain/Product.js'), 'utf8');
  assert.match(modelSource, /trim: true/);
  assert.match(modelSource, /index: true/);
  assert.match(modelSource, /catalog_items/);

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.equal(pkg.main, 'app/server.js');
  assert.equal(pkg.scripts.start, 'node app/server.js');
  assert.equal(pkg.dependencies.express, '^5.1.0');

  for (const relativeFile of result.files.filter(file => file.endsWith('.js'))) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, relativeFile)], {encoding: 'utf8'});
    assert.equal(checked.status, 0, relativeFile + ' failed syntax check:\n' + checked.stderr);
  }
});

test('regeneration preserves custom files and unmodified generated files update safely', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-regen-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));
  const output = path.join(tempRoot, 'service');

  generateApplication(spec, output);
  fs.writeFileSync(path.join(output, 'CUSTOM.md'), 'developer owned\n');

  const changed = JSON.parse(JSON.stringify(spec));
  changed.app.health.response = {ready: 'changed'};
  assert.doesNotThrow(() => generateApplication(changed, output));

  assert.equal(fs.readFileSync(path.join(output, 'CUSTOM.md'), 'utf8'), 'developer owned\n');
  assert.match(fs.readFileSync(path.join(output, 'app/app.js'), 'utf8'), /changed/);
});

test('regeneration detects developer edits to generated files and force replaces only owned conflicts', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-conflict-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));
  const output = path.join(tempRoot, 'service');

  generateApplication(spec, output);
  const generatedApp = path.join(output, 'app/app.js');
  fs.appendFileSync(generatedApp, '\n// developer edit\n');
  fs.writeFileSync(path.join(output, 'CUSTOM.md'), 'keep me\n');

  assert.throws(() => generateApplication(spec, output), /developer-modified generated files/);
  assert.doesNotThrow(() => generateApplication(spec, output, {force: true}));
  assert.doesNotMatch(fs.readFileSync(generatedApp, 'utf8'), /developer edit/);
  assert.equal(fs.readFileSync(path.join(output, 'CUSTOM.md'), 'utf8'), 'keep me\n');
});

test('refuses to adopt a non-empty unowned output directory even with force', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-unowned-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));
  const output = path.join(tempRoot, 'existing');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'important.txt'), 'do not delete');

  assert.throws(() => generateApplication(spec, output), /not owned by json-to-express/);
  assert.throws(() => generateApplication(spec, output, {force: true}), /not owned by json-to-express/);
  assert.equal(fs.readFileSync(path.join(output, 'important.txt'), 'utf8'), 'do not delete');
});

test('removes stale generator-owned files when a feature is disabled', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-stale-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));
  const output = path.join(tempRoot, 'service');

  generateApplication(spec, output);
  assert.equal(fs.existsSync(path.join(output, 'spec/health.test.js')), true);

  const changed = JSON.parse(JSON.stringify(spec));
  changed.app.health.enabled = false;
  generateApplication(changed, output);
  assert.equal(fs.existsSync(path.join(output, 'spec/health.test.js')), false);
});

test('uses generation.outputDir from JSON when CLI output is omitted', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-json-output-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const configured = JSON.parse(JSON.stringify(spec));
  configured.generation.outputDir = path.join(tempRoot, 'from-json');

  const result = generateApplication(configured);
  assert.equal(result.outputDir, path.join(tempRoot, 'from-json'));
  assert.equal(fs.existsSync(path.join(result.outputDir, 'app/app.js')), true);
});


test('generates JWT RBAC, production middleware, OpenAPI and environment guards', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-auth-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const secured = {
    specVersion: '1.0',
    app: {
      name: 'secure-api',
      production: {
        cors: {enabled: true, origin: 'https://example.com'},
        rateLimit: {enabled: true, windowMs: 30000, max: 50},
        compression: true
      }
    },
    auth: {
      enabled: true,
      strategy: 'jwt',
      secretEnv: 'API_JWT_SECRET',
      rolesClaim: 'roles'
    },
    environment: {
      API_JWT_SECRET: {required: true},
      EXTERNAL_API_URL: {default: 'https://api.example.com'}
    },
    docs: {openapi: {enabled: true, file: 'docs/openapi.json'}},
    database: {type: 'mongodb'},
    entities: {
      Team: {
        indexes: [{fields: {name: 1}, options: {unique: true}}],
        audit: {enabled: true},
        operations: {
          list: {auth: {required: true, roles: ['admin']}},
          create: {auth: true, transaction: true}
        },
        fields: {
          name: {type: 'string', required: true}
        }
      }
    }
  };

  const output = path.join(tempRoot, 'secure');
  const result = generateApplication(secured, output);
  assert.ok(result.files.includes('src/middleware/auth.js'));
  assert.ok(result.files.includes('src/middleware/validation.js'));
  assert.ok(result.files.includes('src/config/environment.js'));
  assert.ok(result.files.includes('docs/openapi.json'));
  assert.ok(result.files.includes('test/contract.test.js'));

  const routes = fs.readFileSync(path.join(output, 'src/routes/TeamRoutes.js'), 'utf8');
  assert.match(routes, /auth\.authenticate/);
  assert.match(routes, /"roles":\["admin"\]/);
  assert.match(routes, /"strategies":\["jwt"\]/);
  assert.match(routes, /validation\.body/);

  const app = fs.readFileSync(path.join(output, 'src/app.js'), 'utf8');
  assert.match(app, /require\('cors'\)/);
  assert.match(app, /express-rate-limit/);
  assert.match(app, /compression/);
  assert.match(app, /X-Request-Id/);

  const model = fs.readFileSync(path.join(output, 'src/models/Team.js'), 'utf8');
  assert.match(model, /TeamSchema\.index/);
  assert.match(model, /createdBy/);
  assert.match(model, /updatedBy/);

  const controller = fs.readFileSync(path.join(output, 'src/controllers/TeamController.js'), 'utf8');
  assert.match(controller, /withTransaction\(true/);
  assert.match(controller, /req\.auth\.userId/);

  const env = fs.readFileSync(path.join(output, '.env.example'), 'utf8');
  assert.match(env, /API_JWT_SECRET=change-me/);
  assert.match(env, /EXTERNAL_API_URL=https:\/\/api\.example\.com/);

  const generatedPackage = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.ok(generatedPackage.dependencies.jsonwebtoken);
  assert.ok(generatedPackage.dependencies.cors);
  assert.ok(generatedPackage.dependencies['express-rate-limit']);
  assert.ok(generatedPackage.dependencies.compression);

  const openapi = JSON.parse(fs.readFileSync(path.join(output, 'docs/openapi.json'), 'utf8'));
  assert.equal(openapi.components.securitySchemes.jwtAuth.scheme, 'bearer');
  assert.deepEqual(openapi.paths['/api/teams'].get.security, [{jwtAuth: []}]);
});


test('generates custom workflow endpoints, safe references and webhook runtime', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-workflow-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const workflowSpec = {
    specVersion: '1.0',
    app: {name: 'workflow-api', apiPrefix: '/api'},
    database: {type: 'mongodb'},
    entities: {
      Order: {
        fields: {
          status: {type: 'string', required: true},
          total: {type: 'number', required: true}
        }
      }
    },
    events: {
      'order.published': {
        webhooks: [{urlEnv: 'ORDER_WEBHOOK_URL', method: 'post', failure: 'fail'}]
      }
    },
    workflows: {
      publishOrder: {
        transaction: true,
        steps: [
          {name: 'load', action: 'findById', entity: 'Order', id: '$params.id'},
          {name: 'update', action: 'updateById', entity: 'Order', id: '$params.id', data: {status: 'published'}},
          {name: 'notify', action: 'emit', event: 'order.published', payload: {id: '$steps.update._id', total: '$steps.load.total'}},
          {name: 'done', action: 'respond', status: 202, body: {id: '$steps.update._id', status: '$steps.update.status'}}
        ]
      }
    },
    endpoints: {
      publishOrder: {
        method: 'post',
        path: '/orders/:id/publish',
        workflow: 'publishOrder',
        status: 202
      }
    }
  };

  const output = path.join(tempRoot, 'workflow');
  const result = generateApplication(workflowSpec, output);

  assert.ok(result.files.includes('src/workflows/engine.js'));
  assert.ok(result.files.includes('src/workflows/events.js'));
  assert.ok(result.files.includes('src/routes/CustomRoutes.js'));

  const app = fs.readFileSync(path.join(output, 'src/app.js'), 'utf8');
  assert.match(app, /CustomRoutes/);
  assert.match(app, /app\.use\("\/api", CustomRoutes\)/);

  const routes = fs.readFileSync(path.join(output, 'src/routes/CustomRoutes.js'), 'utf8');
  assert.match(routes, /router\.post\("\/orders\/:id\/publish"/);
  assert.match(routes, /workflows\.execute\("publishOrder"/);

  const engine = fs.readFileSync(path.join(output, 'src/workflows/engine.js'), 'utf8');
  assert.match(engine, /\$steps/);
  assert.match(engine, /session\.withTransaction/);
  assert.match(engine, /pendingEvents/);
  assert.match(engine, /eventBus\.publish/);

  const events = fs.readFileSync(path.join(output, 'src/workflows/events.js'), 'utf8');
  assert.match(events, /ORDER_WEBHOOK_URL/);
  assert.match(events, /fetch\(url/);

  const env = fs.readFileSync(path.join(output, '.env.example'), 'utf8');
  assert.match(env, /ORDER_WEBHOOK_URL=/);

  const openapi = JSON.parse(fs.readFileSync(path.join(output, 'openapi.json'), 'utf8'));
  assert.ok(openapi.paths['/api/orders/{id}/publish'].post);
  assert.equal(openapi.paths['/api/orders/{id}/publish'].post.operationId, 'publishOrder');
});


test('generates durable Mongo outbox, worker, retries and queued workflow jobs', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-outbox-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const queuedSpec = {
    specVersion: '1.0',
    app: {name: 'queue-api'},
    database: {type: 'mongodb'},
    outbox: {
      worker: 'separate',
      pollIntervalMs: 250,
      batchSize: 7,
      lockTimeoutMs: 5000,
      maxAttempts: 6,
      backoffMs: 200
    },
    entities: {
      Order: {
        fields: {
          status: {type: 'string', required: true}
        }
      }
    },
    events: {
      'order.done': {
        webhooks: [{urlEnv: 'ORDER_DONE_URL', failure: 'fail'}]
      }
    },
    jobs: {
      finalizeOrder: {
        workflow: 'finalizeOrder',
        queue: 'orders',
        maxAttempts: 4,
        backoffMs: 300
      }
    },
    workflows: {
      queueFinalize: {
        transaction: true,
        steps: [
          {name: 'job', action: 'enqueue', job: 'finalizeOrder', payload: {id: '$params.id'}, delayMs: 100},
          {name: 'done', action: 'respond', status: 202, body: {queued: true}}
        ]
      },
      finalizeOrder: {
        steps: [
          {name: 'update', action: 'updateById', entity: 'Order', id: '$body.id', data: {status: 'done'}},
          {name: 'event', action: 'emit', event: 'order.done', payload: {id: '$steps.update._id'}}
        ]
      }
    },
    endpoints: {
      finalize: {method: 'post', path: '/orders/:id/finalize', workflow: 'queueFinalize', status: 202}
    }
  };

  const output = path.join(tempRoot, 'queued');
  const result = generateApplication(queuedSpec, output);

  assert.ok(result.files.includes('src/workflows/outbox.js'));
  assert.ok(result.files.includes('src/workflows/worker.js'));

  const generatedPackage = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.equal(generatedPackage.scripts.worker, 'node src/workflows/worker.js');
  assert.equal(generatedPackage.scripts['worker:once'], 'node src/workflows/worker.js --once');
  assert.equal(generatedPackage.scripts['outbox:retry'], 'node src/workflows/worker.js --retry-dead');

  const outbox = fs.readFileSync(path.join(output, 'src/workflows/outbox.js'), 'utf8');
  assert.match(outbox, /status: "processing"/);
  assert.match(outbox, /status: dead \? "dead" : "pending"/);
  assert.match(outbox, /Math\.pow\(2, attempts - 1\)/);
  assert.match(outbox, /Date\.now\(\) - 5000/);
  assert.match(outbox, /retryDead/);

  const worker = fs.readFileSync(path.join(output, 'src/workflows/worker.js'), 'utf8');
  assert.match(worker, /processBatch/);
  assert.match(worker, /recoverStale/);
  assert.match(worker, /workflows\.execute/);
  assert.match(worker, /--retry-dead/);
  assert.match(worker, /connectDatabase\.disconnect/);

  const engine = fs.readFileSync(path.join(output, 'src/workflows/engine.js'), 'utf8');
  assert.match(engine, /pendingJobs/);
  assert.match(engine, /enqueueJob/);
  assert.match(engine, /persistPending\(context, session\)/);

  const server = fs.readFileSync(path.join(output, 'src/server.js'), 'utf8');
  assert.doesNotMatch(server, /outboxWorker\.startWorker/);
});


test('generates PostgreSQL Prisma schema, UUID routes and CRUD controllers from the same IR', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-prisma-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const postgresSpec = {
    specVersion: '1.0',
    app: {name: 'postgres-api'},
    database: {
      type: 'postgresql',
      uriEnv: 'DATABASE_URL',
      defaultUri: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres_api',
      idStrategy: 'uuid',
      prisma: {schemaPath: 'db/schema.prisma'}
    },
    entities: {
      Category: {
        collection: 'categories',
        fields: {
          name: {type: 'string', required: true, unique: true}
        }
      },
      Product: {
        collection: 'products',
        softDelete: {enabled: true, field: 'deletedAt'},
        indexes: [{fields: {name: 1, price: -1}, options: {}}],
        operations: {
          list: {
            populate: ['category'],
            query: {
              filters: ['name', 'price', 'category'],
              operators: ['eq', 'gte', 'lte'],
              pagination: {enabled: true, defaultLimit: 10, maxLimit: 50}
            }
          },
          get: {populate: ['category']},
          update: {transaction: true}
        },
        fields: {
          name: {type: 'string', required: true},
          price: {type: 'number', required: true},
          category: {type: 'reference', ref: 'Category', required: true, onDelete: 'restrict'},
          published: {type: 'boolean', default: false}
        }
      }
    }
  };

  const output = path.join(tempRoot, 'postgres');
  const result = generateApplication(postgresSpec, output);

  assert.ok(result.files.includes('db/schema.prisma'));
  assert.ok(result.files.includes('src/controllers/ProductController.js'));
  assert.equal(result.files.some(file => file === 'src/models/Product.js'), false);

  const schema = fs.readFileSync(path.join(output, 'db/schema.prisma'), 'utf8');
  assert.match(schema, /provider = "postgresql"/);
  assert.match(schema, /id String @id @default\(uuid\(\)\)/);
  assert.match(schema, /categoryId String/);
  assert.match(schema, /@relation\("Product_category".*onDelete: Restrict\)/);
  assert.match(schema, /Product_category Product\[\] @relation\("Product_category"\)/);
  assert.match(schema, /@@index\(\[name, price\(sort: Desc\)\]\)/);
  assert.match(schema, /@@map\("products"\)/);

  const controller = fs.readFileSync(path.join(output, 'src/controllers/ProductController.js'), 'utf8');
  assert.match(controller, /prisma\.product\.findMany/);
  assert.match(controller, /db\.product\.update/);
  assert.match(controller, /prisma\.\$transaction/);
  assert.match(controller, /field \+ "Id"/);
  assert.match(controller, /connect: \{id: reference\}/);

  const routes = fs.readFileSync(path.join(output, 'src/routes/ProductRoutes.js'), 'utf8');
  assert.match(routes, /validation\.identifier/);

  const validation = fs.readFileSync(path.join(output, 'src/middleware/validation.js'), 'utf8');
  assert.ok(validation.includes('^[0-9a-f]{8}-[0-9a-f]{4}-'));
  assert.doesNotMatch(validation, /mongoose/);

  const database = fs.readFileSync(path.join(output, 'src/config/database.js'), 'utf8');
  assert.match(database, /PrismaClient/);
  assert.match(database, /\$connect/);
  assert.match(database, /\$disconnect/);

  const generatedPackage = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.ok(generatedPackage.dependencies['@prisma/client']);
  assert.equal(generatedPackage.dependencies.mongoose, undefined);
  assert.ok(generatedPackage.devDependencies.prisma);
  assert.equal(generatedPackage.scripts['prisma:generate'], 'prisma generate --schema db/schema.prisma');
  assert.equal(generatedPackage.scripts['db:push'], 'prisma db push --schema db/schema.prisma');

  const openapi = JSON.parse(fs.readFileSync(path.join(output, 'openapi.json'), 'utf8'));
  assert.equal(openapi.components.schemas.Product.properties.id.format, 'uuid');
  assert.equal(openapi.paths['/api/products/{id}'].get.parameters[0].schema.format, 'uuid');

  for (const relativeFile of result.files.filter(file => file.endsWith('.js'))) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, relativeFile)], {encoding: 'utf8'});
    assert.equal(checked.status, 0, relativeFile + ' failed syntax check:\n' + checked.stderr);
  }
});


test('generates Docker Compose and Kubernetes deployment artifacts for MongoDB', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-deploy-mongo-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const deploymentSpec = {
    specVersion: '1.0',
    app: {name: 'deploy-api', port: 4100, health: {enabled: true, path: '/ready'}},
    database: {type: 'mongodb'},
    deployment: {
      docker: {enabled: true, nodeImage: 'node:22-alpine'},
      compose: {enabled: true, database: true, apiPort: 8100},
      kubernetes: {
        enabled: true,
        directory: 'deploy/k8s',
        image: 'example/deploy-api:1.0.0',
        replicas: 3,
        serviceType: 'ClusterIP',
        servicePort: 8080,
        resources: {
          requests: {cpu: '100m', memory: '128Mi'},
          limits: {cpu: '500m', memory: '512Mi'}
        }
      }
    },
    environment: {
      PUBLIC_ORIGIN: {default: 'https://example.com'},
      PRIVATE_TOKEN: {required: true}
    },
    entities: {
      Product: {fields: {name: {type: 'string', required: true}}}
    }
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(deploymentSpec, output);

  for (const file of [
    'Dockerfile',
    '.dockerignore',
    'docker-compose.yml',
    'deploy/k8s/configmap.yaml',
    'deploy/k8s/secret.example.yaml',
    'deploy/k8s/deployment.yaml',
    'deploy/k8s/service.yaml'
  ]) assert.ok(result.files.includes(file), file + ' should be generated');

  const dockerfile = fs.readFileSync(path.join(output, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /FROM node:22-alpine AS build/);
  assert.match(dockerfile, /npm prune --omit=dev/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /EXPOSE 4100/);

  const compose = fs.readFileSync(path.join(output, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /image: mongo:7/);
  assert.match(compose, /mongodb:\/\/database:27017\/deploy_api/);
  assert.match(compose, /"8100:4100"/);
  assert.match(compose, /condition: service_healthy/);

  const deployment = fs.readFileSync(path.join(output, 'deploy/k8s/deployment.yaml'), 'utf8');
  assert.match(deployment, /replicas: 3/);
  assert.match(deployment, /image: "example\/deploy-api:1\.0\.0"/);
  assert.match(deployment, /readinessProbe:/);
  assert.match(deployment, /livenessProbe:/);
  assert.match(deployment, /cpu: "100m"/);
  assert.match(deployment, /memory: "512Mi"/);

  const configMap = fs.readFileSync(path.join(output, 'deploy/k8s/configmap.yaml'), 'utf8');
  assert.match(configMap, /PUBLIC_ORIGIN: "https:\/\/example\.com"/);
  assert.doesNotMatch(configMap, /MONGODB_URI/);
  assert.doesNotMatch(configMap, /PRIVATE_TOKEN/);

  const secret = fs.readFileSync(path.join(output, 'deploy/k8s/secret.example.yaml'), 'utf8');
  assert.match(secret, /MONGODB_URI: "<set-me>"/);
  assert.match(secret, /PRIVATE_TOKEN: "<set-me>"/);
});

test('generates Prisma-aware Docker deployment and separate worker manifests', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-deploy-pg-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const deploymentSpec = {
    specVersion: '1.0',
    app: {name: 'postgres-deploy', port: 4200},
    database: {type: 'postgresql'},
    deployment: {
      docker: {enabled: true},
      compose: {enabled: true, database: true},
      kubernetes: {enabled: true, image: 'example/postgres-deploy:latest'}
    },
    entities: {
      Product: {fields: {name: {type: 'string', required: true}}}
    }
  };

  const output = path.join(tempRoot, 'app');
  generateApplication(deploymentSpec, output);

  const dockerfile = fs.readFileSync(path.join(output, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /RUN npm run prisma:generate/);

  const compose = fs.readFileSync(path.join(output, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /image: postgres:16-alpine/);
  assert.match(compose, /postgresql:\/\/postgres:postgres@database:5432\/postgres_deploy/);
  assert.match(compose, /  migrate:/);
  assert.match(compose, /target: build/);
  assert.match(compose, /command: \["npm", "run", "db:push"\]/);
  assert.match(compose, /condition: service_completed_successfully/);

  const secret = fs.readFileSync(path.join(output, 'deploy/k8s/secret.example.yaml'), 'utf8');
  assert.match(secret, /DATABASE_URL: "<set-me>"/);
});

test('generates worker deployment when Mongo outbox uses separate worker mode', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-deploy-worker-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const deploymentSpec = {
    specVersion: '1.0',
    app: {name: 'worker-api'},
    database: {type: 'mongodb'},
    deployment: {
      docker: {enabled: true},
      compose: {enabled: true},
      kubernetes: {enabled: true, image: 'example/worker-api:latest'}
    },
    outbox: {worker: 'separate'},
    entities: {
      Order: {fields: {status: {type: 'string'}}}
    },
    events: {'order.done': {webhooks: []}},
    workflows: {
      emitDone: {
        steps: [
          {name: 'emit', action: 'emit', event: 'order.done', payload: {ok: true}}
        ]
      }
    }
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(deploymentSpec, output);
  assert.ok(result.files.includes('deploy/k8s/worker-deployment.yaml'));

  const compose = fs.readFileSync(path.join(output, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /  worker:/);
  assert.match(compose, /command: \["npm", "run", "worker"\]/);

  const worker = fs.readFileSync(path.join(output, 'deploy/k8s/worker-deployment.yaml'), 'utf8');
  assert.match(worker, /name: worker-api-worker/);
  assert.match(worker, /command: \["npm", "run", "worker"\]/);
});


test('generates standalone JavaScript and strongly typed TypeScript SDK clients', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-sdk-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const sdkSpec = {
    specVersion: '1.0',
    app: {name: 'sdk-api', port: 4300, apiPrefix: '/v1'},
    database: {type: 'mongodb'},
    sdk: {
      enabled: true,
      outputDir: 'client',
      languages: ['javascript', 'typescript'],
      packageName: '@example/sdk-api-client',
      private: false,
      baseUrl: 'https://api.example.test',
      includeCustomEndpoints: true
    },
    entities: {
      Category: {
        fields: {
          name: {type: 'string', required: true}
        }
      },
      Product: {
        route: 'catalog-items',
        idParam: 'productId',
        operations: {
          list: {
            method: 'post',
            path: '/search',
            query: {
              filters: ['name', 'price'],
              operators: ['eq', 'gte', 'in'],
              sortParam: 'sort',
              selectParam: 'fields',
              pagination: {enabled: true, pageParam: 'page', limitParam: 'limit'}
            }
          },
          get: {path: '/item/:productId'}
        },
        fields: {
          name: {type: 'string', required: true},
          price: {type: 'number', required: true},
          category: {type: 'reference', ref: 'Category', required: true},
          published: {type: 'boolean', default: false}
        }
      }
    },
    workflows: {
      publishProduct: {
        steps: [
          {name: 'done', action: 'respond', status: 200, body: {ok: true}}
        ]
      }
    },
    endpoints: {
      publishProduct: {
        method: 'post',
        path: '/catalog-items/:productId/publish',
        workflow: 'publishProduct'
      }
    }
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(sdkSpec, output);

  for (const file of [
    'client/package.json',
    'client/README.md',
    'client/javascript/index.js',
    'client/typescript/index.ts',
    'client/tsconfig.json'
  ]) assert.ok(result.files.includes(file), file + ' should be generated');

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'client/package.json'), 'utf8'));
  assert.equal(pkg.name, '@example/sdk-api-client');
  assert.equal(pkg.private, false);
  assert.equal(pkg.main, 'javascript/index.js');
  assert.equal(pkg.types, 'dist/index.d.ts');
  assert.ok(pkg.devDependencies.typescript);

  const jsClient = fs.readFileSync(path.join(output, 'client/javascript/index.js'), 'utf8');
  assert.match(jsClient, /class ApiError extends Error/);
  assert.match(jsClient, /authorization = "Bearer " \+ token/);
  assert.match(jsClient, /catalogItems:/);
  assert.match(jsClient, /list: \(query, options = \{\}\) => request\("POST", "\/v1\/catalog-items\/search"/);
  assert.match(jsClient, /get: \(id, query, options = \{\}\) => request\("GET", "\/v1\/catalog-items\/item\/:productId"/);
  assert.match(jsClient, /publishProduct: \(input = \{\}, options = \{\}\) => request\("POST", "\/v1\/catalog-items\/:productId\/publish"/);
  assert.match(jsClient, /https:\/\/api\.example\.test/);

  const tsClient = fs.readFileSync(path.join(output, 'client/typescript/index.ts'), 'utf8');
  assert.match(tsClient, /export interface Product/);
  assert.match(tsClient, /category: string \| Category/);
  assert.match(tsClient, /export interface ProductCreateInput/);
  assert.match(tsClient, /category: string;/);
  assert.match(tsClient, /"price__gte"\?: number;/);
  assert.match(tsClient, /"price__in"\?: number\[\];/);
  assert.match(tsClient, /catalogItems: ProductClient/);
  assert.match(tsClient, /publishProduct\(input: \{params: \{"productId": string \| number\}/);
  assert.match(tsClient, /export class ApiError extends Error/);

  const checked = spawnSync(process.execPath, ['--check', path.join(output, 'client/javascript/index.js')], {encoding: 'utf8'});
  assert.equal(checked.status, 0, checked.stderr);
});


test('generates a complete configurable React admin UI from entity metadata', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-admin-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const adminSpec = {
    specVersion: '1.0',
    app: {name: 'admin-api', port: 4400, apiPrefix: '/v1'},
    database: {type: 'mongodb'},
    admin: {
      enabled: true,
      outputDir: 'backoffice',
      title: 'Catalog Console',
      baseUrl: 'https://api.example.test',
      devPort: 4180,
      includeCustomActions: true,
      auth: {tokenStorage: 'sessionStorage', tokenKey: 'catalog-token'},
      theme: {brandColor: '#7c3aed', mode: 'dark'},
      entities: {
        Product: {
          label: 'Catalog item',
          pluralLabel: 'Catalog items',
          titleField: 'name',
          listFields: ['name', 'price', 'category', 'published'],
          filterFields: ['name', 'price'],
          readonlyFields: ['published'],
          pageSize: 25,
          fields: {
            name: {label: 'Product name', placeholder: 'Mechanical keyboard'},
            category: {label: 'Category', widget: 'reference'},
            published: {label: 'Published', readonly: true}
          }
        }
      }
    },
    entities: {
      Category: {
        fields: {
          name: {type: 'string', required: true}
        }
      },
      Product: {
        operations: {
          list: {
            populate: ['category'],
            query: {
              filters: ['name', 'price'],
              operators: ['eq', 'gte', 'lte'],
              pagination: {enabled: true, defaultLimit: 20, maxLimit: 100}
            }
          }
        },
        fields: {
          name: {type: 'string', required: true, minLength: 2},
          price: {type: 'number', required: true, min: 0},
          category: {type: 'reference', ref: 'Category', required: true},
          published: {type: 'boolean', default: false}
        }
      }
    },
    workflows: {
      publishProduct: {
        steps: [{name: 'done', action: 'respond', body: {ok: true}}]
      }
    },
    endpoints: {
      publishProduct: {
        method: 'post',
        path: '/products/:id/publish',
        workflow: 'publishProduct'
      }
    }
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(adminSpec, output);

  for (const file of [
    'backoffice/package.json',
    'backoffice/vite.config.js',
    'backoffice/index.html',
    'backoffice/README.md',
    'backoffice/src/config.js',
    'backoffice/src/api.js',
    'backoffice/src/App.jsx',
    'backoffice/src/main.jsx',
    'backoffice/src/styles.css'
  ]) assert.ok(result.files.includes(file), file + ' should be generated');

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'backoffice/package.json'), 'utf8'));
  assert.equal(pkg.name, 'admin-api-admin');
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.dependencies.react);
  assert.ok(pkg.dependencies['react-dom']);
  assert.ok(pkg.devDependencies.vite);

  const config = fs.readFileSync(path.join(output, 'backoffice/src/config.js'), 'utf8');
  assert.match(config, /Catalog Console/);
  assert.match(config, /https:\/\/api\.example\.test/);
  assert.match(config, /sessionStorage/);
  assert.match(config, /catalog-token/);
  assert.match(config, /#7c3aed/);
  assert.match(config, /Catalog items/);
  assert.match(config, /"pageSize": 25/);
  assert.match(config, /"label": "Product name"/);
  assert.match(config, /"widget": "reference"/);
  assert.match(config, /"entity": "Product"/);
  assert.match(config, /"path": "\/v1\/products\/:id\/publish"/);

  const app = fs.readFileSync(path.join(output, 'backoffice/src/App.jsx'), 'utf8');
  assert.match(app, /function RecordForm/);
  assert.match(app, /function EntityPage/);
  assert.match(app, /function ActionDialog/);
  assert.match(app, /window\.confirm/);
  assert.match(app, /relationOptions/);
  assert.match(app, /price__gte|filterFields/);
  assert.match(app, /TokenGate/);

  const api = fs.readFileSync(path.join(output, 'backoffice/src/api.js'), 'utf8');
  assert.match(api, /class ApiError extends Error/);
  assert.match(api, /authorization = 'Bearer '/);
  assert.match(api, /function entity\(resource\)/);
  assert.match(api, /function action\(actionConfig/);

  for (const file of ['src/api.js', 'src/config.js', 'vite.config.js']) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, 'backoffice', file)], {
      cwd: path.join(output, 'backoffice'),
      encoding: 'utf8'
    });
    assert.equal(checked.status, 0, file + ' failed syntax check:\n' + checked.stderr);
  }
});


test('generates PostgreSQL Prisma workflows durable outbox and worker runtime', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-pg-workflow-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const workflowSpec = {
    specVersion: '1.0',
    app: {name: 'pg-workflow-api'},
    database: {type: 'postgresql'},
    entities: {
      Category: {
        fields: {name: {type: 'string', required: true}}
      },
      Product: {
        fields: {
          name: {type: 'string', required: true},
          price: {type: 'number', required: true},
          category: {type: 'reference', ref: 'Category', required: true},
          published: {type: 'boolean', default: false}
        }
      }
    },
    events: {
      'product.published': {webhooks: []}
    },
    workflows: {
      publishProduct: {
        transaction: true,
        steps: [
          {name: 'update', action: 'updateById', entity: 'Product', id: '$params.id', data: {published: true}},
          {name: 'event', action: 'emit', event: 'product.published', payload: {id: '$steps.update.id'}},
          {name: 'done', action: 'respond', status: 200, body: {id: '$steps.update.id'}}
        ]
      },
      createProduct: {
        steps: [
          {
            name: 'create',
            action: 'create',
            entity: 'Product',
            data: {name: '$body.name', price: '$body.price', category: '$body.category'}
          }
        ]
      },
      queueReprice: {
        steps: [
          {name: 'job', action: 'enqueue', job: 'repriceProduct', payload: {id: '$params.id', price: '$body.price'}}
        ]
      },
      repriceProduct: {
        transaction: true,
        steps: [
          {name: 'update', action: 'updateById', entity: 'Product', id: '$body.id', data: {price: '$body.price'}}
        ]
      }
    },
    endpoints: {
      publishProduct: {method: 'post', path: '/products/:id/publish', workflow: 'publishProduct'}
    },
    jobs: {
      repriceProduct: {workflow: 'repriceProduct', queue: 'products', maxAttempts: 4, backoffMs: 25}
    },
    outbox: {
      worker: 'separate',
      pollIntervalMs: 50,
      batchSize: 5,
      lockTimeoutMs: 5000,
      maxAttempts: 4,
      backoffMs: 25
    }
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(workflowSpec, output);

  for (const file of [
    'src/workflows/engine.js',
    'src/workflows/events.js',
    'src/workflows/outbox.js',
    'src/workflows/worker.js',
    'src/routes/CustomRoutes.js',
    'prisma/schema.prisma'
  ]) assert.ok(result.files.includes(file), file + ' should be generated');

  const schema = fs.readFileSync(path.join(output, 'prisma/schema.prisma'), 'utf8');
  assert.match(schema, /model J2EOutbox/);
  assert.match(schema, /payload Json\?/);
  assert.match(schema, /@@index\(\[status, availableAt, queue\]\)/);
  assert.match(schema, /@@map\("_j2e_outbox"\)/);

  const engine = fs.readFileSync(path.join(output, 'src/workflows/engine.js'), 'utf8');
  assert.match(engine, /prisma\.\$transaction/);
  assert.match(engine, /db\[definition\.delegate\]/);
  assert.match(engine, /\{connect: \{id: reference\}\}/);
  assert.match(engine, /eventBus\.publish\(event\.name, event\.payload, \{db\}\)/);
  assert.doesNotMatch(engine, /mongoose/);

  const outbox = fs.readFileSync(path.join(output, 'src/workflows/outbox.js'), 'utf8');
  assert.match(outbox, /prisma\.j2EOutbox/);
  assert.match(outbox, /updateMany/);
  assert.match(outbox, /status: "dead"/);
  assert.match(outbox, /Math\.pow\(2, attempts - 1\)/);
  assert.doesNotMatch(outbox, /mongoose/);

  const worker = fs.readFileSync(path.join(output, 'src/workflows/worker.js'), 'utf8');
  assert.match(worker, /connectDatabase\.disconnect/);
  assert.match(worker, /record\.id \|\| record\._id/);
  assert.doesNotMatch(worker, /mongoose/);

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.worker);
  assert.ok(pkg.scripts['worker:once']);
  assert.ok(pkg.scripts['outbox:retry']);

  for (const relativeFile of result.files.filter(file => file.endsWith('.js'))) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, relativeFile)], {encoding: 'utf8'});
    assert.equal(checked.status, 0, relativeFile + ' failed syntax check:\n' + checked.stderr);
  }
});


test('generates PostgreSQL many-to-many relations across API SDK OpenAPI and admin metadata', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-many-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const manySpec = {
    specVersion: '1.0',
    app: {name: 'many-api'},
    database: {type: 'postgresql'},
    docs: {openapi: {enabled: true}},
    sdk: {enabled: true, languages: ['typescript']},
    admin: {enabled: true},
    entities: {
      Tag: {
        fields: {name: {type: 'string', required: true}}
      },
      Product: {
        operations: {
          list: {
            populate: ['tags'],
            query: {filters: ['tags'], operators: ['eq', 'in']}
          },
          get: {populate: ['tags']},
          create: {populate: ['tags']},
          update: {populate: ['tags']}
        },
        fields: {
          name: {type: 'string', required: true},
          tags: {type: 'reference', ref: 'Tag', many: true, required: true, onDelete: 'nullify'}
        }
      }
    }
  };

  const output = path.join(tempRoot, 'app');
  generateApplication(manySpec, output);

  const schema = fs.readFileSync(path.join(output, 'prisma/schema.prisma'), 'utf8');
  assert.match(schema, /tags Tag\[\] @relation\("Product_tags"\)/);
  assert.match(schema, /Product_tags Product\[\] @relation\("Product_tags"\)/);
  assert.doesNotMatch(schema, /tagsId/);

  const controller = fs.readFileSync(path.join(output, 'src/controllers/ProductController.js'), 'utf8');
  assert.match(controller, /connect: references\.map\(id => \(\{id\}\)\)/);
  assert.match(controller, /set: references\.map\(id => \(\{id\}\)\)/);
  assert.match(controller, /\{some: \{id: value\}\}/);

  const tagController = fs.readFileSync(path.join(output, 'src/controllers/TagController.js'), 'utf8');
  assert.match(tagController, /disconnect: \{id: targetId\}/);
  assert.match(tagController, /withTransaction\(true/);

  const openapi = JSON.parse(fs.readFileSync(path.join(output, 'openapi.json'), 'utf8'));
  assert.equal(openapi.components.schemas.Product.properties.tags.type, 'array');
  assert.equal(openapi.components.schemas.Product.properties.tags.minItems, 1);
  assert.equal(openapi.components.schemas.Product.properties.tags.items.format, 'uuid');
  const listOperation = openapi.paths['/api/products'].get;
  const tagsFilter = listOperation.parameters.find(parameter => parameter.name === 'tags');
  const tagsInFilter = listOperation.parameters.find(parameter => parameter.name === 'tags__in');
  assert.equal(tagsFilter.schema.format, 'uuid');
  assert.equal(tagsInFilter.schema.type, 'array');
  assert.equal(tagsInFilter.schema.items.format, 'uuid');

  const sdk = fs.readFileSync(path.join(output, 'sdk/typescript/index.ts'), 'utf8');
  assert.match(sdk, /tags: Array<string \| Tag>;/);
  assert.match(sdk, /tags: Array<string>;/);

  const admin = fs.readFileSync(path.join(output, 'admin/src/config.js'), 'utf8');
  assert.match(admin, /"name": "tags"/);
  assert.match(admin, /"many": true/);
  assert.match(admin, /"ref": "Tag"/);
});


test('generates GraphQL schema and resolvers from the same normalized IR', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-graphql-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const graphqlSpec = {
    specVersion: '1.0',
    api: {rest: false, graphql: {enabled: true, path: '/gql'}},
    app: {name: 'graphql-api'},
    database: {type: 'postgresql'},
    entities: {
      Tag: {
        fields: {name: {type: 'string', required: true}}
      },
      Product: {
        operations: {
          list: {
            query: {
              filters: ['name', 'price', 'tags'],
              operators: ['eq', 'gte', 'in'],
              pagination: {enabled: true, defaultLimit: 20, maxLimit: 100}
            }
          }
        },
        fields: {
          name: {type: 'string', required: true},
          price: {type: 'number', required: true, min: 0},
          tags: {type: 'reference', ref: 'Tag', many: true}
        }
      }
    }
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(graphqlSpec, output);
  assert.ok(result.files.includes('src/graphql/index.js'));

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies.graphql);
  assert.ok(pkg.dependencies['@graphql-tools/schema']);
  assert.ok(pkg.dependencies.dataloader);

  const app = fs.readFileSync(path.join(output, 'src/app.js'), 'utf8');
  assert.match(app, /app\.all\("\/gql"/);
  assert.doesNotMatch(app, /app\.use\("\/api\/products"/);

  const graphql = fs.readFileSync(path.join(output, 'src/graphql/index.js'), 'utf8');
  assert.match(graphql, /type Product \{/);
  assert.match(graphql, /id: ID!/);
  assert.match(graphql, /tags: \[Tag!\]!/);
  assert.match(graphql, /input ProductCreateInput/);
  assert.match(graphql, /input ProductFilterInput/);
  assert.match(graphql, /tags__in: \[ID!\]/);
  assert.match(graphql, /listProducts/);
  assert.match(graphql, /getProduct/);
  assert.match(graphql, /createProduct/);
  assert.match(graphql, /updateProduct/);
  assert.match(graphql, /deleteProduct/);
  assert.match(graphql, /new DataLoader/);
  assert.match(graphql, /invokeController/);
  assert.match(graphql, /validation\.validateBody/);
  assert.match(graphql, /resolveRelation/);

  const syntax = spawnSync(process.execPath, ['--check', path.join(output, 'src/graphql/index.js')], {
    cwd: output,
    encoding: 'utf8'
  });
  assert.equal(syntax.status, 0, syntax.stderr);
});


test('generates multi-strategy auth stores flows OpenAPI SDK and admin metadata', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-multi-auth-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const authSpec = {
    specVersion: '1.0',
    api: {rest: true, graphql: true},
    app: {name: 'multi-auth-api'},
    database: {type: 'postgresql'},
    auth: {
      enabled: true,
      strategies: ['jwt', 'apiKey', 'session', 'oidc'],
      jwt: {
        secretEnv: 'AUTH_JWT_SECRET',
        accessTtlSeconds: 600,
        refresh: {enabled: true, ttlSeconds: 7200, returnToken: true}
      },
      apiKey: {
        header: 'x-service-key',
        keys: [{env: 'SERVICE_API_KEY', userId: 'service', roles: ['admin']}]
      },
      session: {cookieName: 'app_session', secure: true, sameSite: 'lax'},
      local: {
        enabled: true,
        defaultRoles: ['member'],
        passwordMinLength: 10,
        passwordReset: {webhookUrlEnv: 'RESET_WEBHOOK_URL'}
      },
      oidc: {
        enabled: true,
        issuer: 'https://id.example.test',
        clientIdEnv: 'OIDC_CLIENT_ID',
        clientSecretEnv: 'OIDC_CLIENT_SECRET',
        audience: 'api'
      }
    },
    docs: {openapi: {enabled: true}},
    sdk: {enabled: true, languages: ['javascript', 'typescript']},
    admin: {enabled: true},
    entities: {
      Team: {
        operations: {
          list: {auth: {required: true, roles: ['admin'], strategies: ['apiKey', 'oidc']}}
        },
        fields: {name: {type: 'string', required: true}}
      }
    }
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(authSpec, output);
  assert.ok(result.files.includes('src/middleware/auth.js'));
  assert.ok(result.files.includes('src/config/auth-store.js'));
  assert.ok(result.files.includes('src/routes/AuthRoutes.js'));

  const auth = fs.readFileSync(path.join(output, 'src/middleware/auth.js'), 'utf8');
  assert.match(auth, /crypto\.scryptSync/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(auth, /strategy === "apiKey"/);
  assert.match(auth, /strategy === "session"/);
  assert.match(auth, /strategy === "oidc"/);
  assert.match(auth, /rotateRefreshToken/);
  assert.match(auth, /code_challenge_method/);
  assert.match(auth, /createRemoteJWKSet/);

  const authRoutes = fs.readFileSync(path.join(output, 'src/routes/AuthRoutes.js'), 'utf8');
  assert.match(authRoutes, /\/auth\/register/);
  assert.match(authRoutes, /\/auth\/login/);
  assert.match(authRoutes, /\/auth\/refresh/);
  assert.match(authRoutes, /\/auth\/forgot-password/);
  assert.match(authRoutes, /\/auth\/reset-password/);
  assert.match(authRoutes, /\/auth\/oidc\/login/);
  assert.match(authRoutes, /\/auth\/oidc\/callback/);

  const prisma = fs.readFileSync(path.join(output, 'prisma/schema.prisma'), 'utf8');
  assert.match(prisma, /model J2EAuthUser/);
  assert.match(prisma, /model J2EAuthToken/);
  assert.match(prisma, /@@map\("_j2e_auth_users"\)/);
  assert.match(prisma, /@@map\("_j2e_auth_tokens"\)/);

  const routes = fs.readFileSync(path.join(output, 'src/routes/TeamRoutes.js'), 'utf8');
  assert.match(routes, /"roles":\["admin"\]/);
  assert.match(routes, /"strategies":\["apiKey","oidc"\]/);

  const openapi = JSON.parse(fs.readFileSync(path.join(output, 'openapi.json'), 'utf8'));
  assert.equal(openapi.components.securitySchemes.jwtAuth.type, 'http');
  assert.equal(openapi.components.securitySchemes.apiKeyAuth.name, 'x-service-key');
  assert.equal(openapi.components.securitySchemes.sessionAuth.in, 'cookie');
  assert.equal(openapi.components.securitySchemes.oidcAuth.type, 'openIdConnect');
  assert.deepEqual(openapi.paths['/api/teams'].get.security, [{apiKeyAuth: []}, {oidcAuth: []}]);
  assert.ok(openapi.paths['/auth/login']);
  assert.ok(openapi.paths['/auth/refresh']);

  const env = fs.readFileSync(path.join(output, '.env.example'), 'utf8');
  assert.match(env, /AUTH_JWT_SECRET=change-me/);
  assert.match(env, /SERVICE_API_KEY=change-me/);
  assert.match(env, /OIDC_CLIENT_ID=/);
  assert.match(env, /OIDC_CLIENT_SECRET=/);
  assert.match(env, /RESET_WEBHOOK_URL=/);

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies.jsonwebtoken);
  assert.ok(pkg.dependencies.jose);

  const jsSdk = fs.readFileSync(path.join(output, 'sdk/javascript/index.js'), 'utf8');
  assert.match(jsSdk, /getApiKey/);
  assert.match(jsSdk, /x-service-key/);
  assert.match(jsSdk, /credentials: options\.credentials/);

  let capturedRequest;
  const generatedSdk = require(path.join(output, 'sdk/javascript'));
  const multipartClient = generatedSdk.createClient({
    baseUrl: 'http://example.test',
    fetch: async (url, init) => {
      capturedRequest = {url, init};
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({
          _id: 'asset-1',
          name: 'Example',
          image: {key: 'assets/images/example.png', originalName: 'example.png', mimeType: 'image/png', size: 3, checksumSha256: 'a'.repeat(64), provider: 'local'}
        })
      };
    }
  });
  const multipartResult = await multipartClient.assets.create({
    name: 'Example',
    image: new Blob(['png'], {type: 'image/png'})
  });
  assert.equal(multipartResult.image.mimeType, 'image/png');
  assert.ok(capturedRequest.init.body instanceof FormData);
  assert.ok(capturedRequest.init.body.get('image') instanceof Blob);
  assert.equal(capturedRequest.init.headers['content-type'], undefined);

  const tsSdk = fs.readFileSync(path.join(output, 'sdk/typescript/index.ts'), 'utf8');
  assert.match(tsSdk, /apiKey\?: string/);
  assert.match(tsSdk, /getApiKey\?:/);
  assert.match(tsSdk, /credentials\?: RequestCredentials/);

  const admin = fs.readFileSync(path.join(output, 'admin/src/config.js'), 'utf8');
  assert.match(admin, /"jwtEnabled": true/);
  assert.match(admin, /"sessionEnabled": true/);
  assert.match(admin, /"header": "x-service-key"/);
  assert.match(admin, /"loginPath": "\/auth\/login"/);

  for (const relativeFile of result.files.filter(file => file.endsWith('.js'))) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, relativeFile)], {encoding: 'utf8'});
    assert.equal(checked.status, 0, relativeFile + ' failed syntax check:\n' + checked.stderr);
  }
});


test('generates production observability across HTTP GraphQL workflows workers and health', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-observability-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const spec = {
    specVersion: '1.0',
    api: {rest: true, graphql: true},
    app: {name: 'observable-api'},
    database: {type: 'postgresql'},
    observability: {
      enabled: true,
      logging: {enabled: true, level: 'debug', format: 'json', requestIds: true},
      metrics: {enabled: true, path: '/internal/metrics', collectDefaultMetrics: true, prefix: 'demo_'},
      tracing: {
        enabled: true,
        serviceName: 'observable-api',
        exporter: 'otlp-http',
        endpointEnv: 'TRACE_ENDPOINT',
        sampleRate: 0.5
      },
      health: {
        liveness: {enabled: true, path: '/livez'},
        readiness: {enabled: true, path: '/readyz', database: true, outbox: true}
      }
    },
    entities: {
      Product: {fields: {name: {type: 'string', required: true}, price: {type: 'number'}}}
    },
    events: {'product.changed': {webhooks: []}},
    workflows: {
      reprice: {
        steps: [
          {name: 'update', action: 'updateById', entity: 'Product', id: '$body.id', data: {price: '$body.price'}},
          {name: 'emit', action: 'emit', event: 'product.changed', payload: {id: '$steps.update.id'}}
        ]
      },
      queueReprice: {
        steps: [{name: 'enqueue', action: 'enqueue', job: 'reprice', payload: {id: '$body.id', price: '$body.price'}}]
      }
    },
    jobs: {reprice: {workflow: 'reprice', queue: 'products'}}
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(spec, output);
  assert.ok(result.files.includes('src/config/observability.js'));

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['prom-client']);
  assert.ok(pkg.dependencies['@opentelemetry/api']);
  assert.ok(pkg.dependencies['@opentelemetry/sdk-trace-node']);
  assert.ok(pkg.dependencies['@opentelemetry/exporter-trace-otlp-http']);

  const env = fs.readFileSync(path.join(output, '.env.example'), 'utf8');
  assert.match(env, /TRACE_ENDPOINT=http:\/\/127\.0\.0\.1:4318\/v1\/traces/);

  const app = fs.readFileSync(path.join(output, 'src/app.js'), 'utf8');
  assert.match(app, /observability\.requestMiddleware/);
  assert.match(app, /app\.get\("\/internal\/metrics", observability\.metricsHandler\)/);
  assert.match(app, /app\.get\("\/livez", observability\.livenessHandler\)/);
  assert.match(app, /app\.get\("\/readyz", observability\.readinessHandler\)/);

  const telemetry = fs.readFileSync(path.join(output, 'src/config/observability.js'), 'utf8');
  assert.match(telemetry, /http_requests_total/);
  assert.match(telemetry, /http_request_duration_seconds/);
  assert.match(telemetry, /workflow_executions_total/);
  assert.match(telemetry, /worker_records_total/);
  assert.match(telemetry, /outbox_pending/);
  assert.match(telemetry, /AsyncLocalStorage/);
  assert.match(telemetry, /NodeTracerProvider/);
  assert.match(telemetry, /OTLPTraceExporter/);
  assert.match(telemetry, /requestId/);
  assert.doesNotMatch(telemetry, /req\.body/);
  assert.doesNotMatch(telemetry, /authorization/);

  const database = fs.readFileSync(path.join(output, 'src/config/database.js'), 'utf8');
  assert.match(database, /connectDatabase\.ping/);
  assert.match(database, /SELECT 1/);

  const workflow = fs.readFileSync(path.join(output, 'src/workflows/engine.js'), 'utf8');
  assert.match(workflow, /observability\.instrumentWorkflow\(name, run\)/);
  assert.match(workflow, /observability\.instrumentWorkflowStep/);

  const worker = fs.readFileSync(path.join(output, 'src/workflows/worker.js'), 'utf8');
  assert.match(worker, /observability\.instrumentWorkerRecord/);
  assert.match(worker, /observability\.startTracing/);
  assert.match(worker, /observability\.shutdownTracing/);

  const outbox = fs.readFileSync(path.join(output, 'src/workflows/outbox.js'), 'utf8');
  assert.match(outbox, /async function stats/);
  assert.match(outbox, /status: "pending"/);
  assert.match(outbox, /status: "dead"/);

  const graphql = fs.readFileSync(path.join(output, 'src/graphql/index.js'), 'utf8');
  assert.match(graphql, /observability\.recordGraphql/);
  assert.match(graphql, /observability\.withSpan/);

  for (const relativeFile of result.files.filter(file => file.endsWith('.js'))) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, relativeFile)], {encoding: 'utf8'});
    assert.equal(checked.status, 0, relativeFile + ' failed syntax check:\n' + checked.stderr);
  }
});


test('generates declarative Redis caching with controller and workflow invalidation', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-cache-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const spec = {
    specVersion: '1.0',
    app: {name: 'cached-api'},
    database: {type: 'mongodb'},
    cache: {
      enabled: true,
      provider: 'redis',
      defaultTtlSeconds: 90,
      prefix: 'demo:',
      varyByAuth: true,
      redis: {urlEnv: 'CACHE_URL', connectTimeoutMs: 2500}
    },
    entities: {
      Category: {fields: {name: {type: 'string'}}},
      Product: {
        operations: {
          list: {cache: true},
          get: {cache: {enabled: true, ttlSeconds: 45, varyByAuth: false}}
        },
        fields: {
          name: {type: 'string', required: true},
          category: {type: 'reference', ref: 'Category'}
        }
      }
    },
    workflows: {
      reprice: {
        steps: [{name: 'update', action: 'updateById', entity: 'Product', id: '$body.id', data: {name: '$body.name'}}]
      }
    },
    jobs: {reprice: {workflow: 'reprice', queue: 'products'}},
    outbox: {worker: 'separate'},
    deployment: {
      docker: {enabled: true},
      compose: {enabled: true, database: true},
      kubernetes: {enabled: true, image: 'cached-api:latest', replicas: 2}
    }
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(spec, output);
  assert.ok(result.files.includes('src/config/cache.js'));

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.redis, '^4.7.0');

  const env = fs.readFileSync(path.join(output, '.env.example'), 'utf8');
  assert.match(env, /CACHE_URL=redis:\/\/127\.0\.0\.1:6379/);

  const cache = fs.readFileSync(path.join(output, 'src/config/cache.js'), 'utf8');
  assert.match(cache, /stableStringify/);
  assert.match(cache, /version:/);
  assert.match(cache, /setEx/);
  assert.match(cache, /X-Cache/);
  assert.match(cache, /varyByAuth/);
  assert.match(cache, /affectedEntities/);

  const controller = fs.readFileSync(path.join(output, 'src/controllers/ProductController.js'), 'utf8');
  assert.match(controller, /cache\.cacheController\("Product", "list"/);
  assert.match(controller, /cache\.cacheController\("Product", "get"/);
  assert.match(controller, /cache\.invalidateController\("Product", create\)/);
  assert.match(controller, /cache\.invalidateController\("Product", update\)/);
  assert.match(controller, /cache\.invalidateController\("Product", remove\)/);
  assert.match(controller, /"ttlSeconds":45/);
  assert.match(controller, /"varyByAuth":false/);

  const workflow = fs.readFileSync(path.join(output, 'src/workflows/engine.js'), 'utf8');
  assert.match(workflow, /mutatedEntities: new Set/);
  assert.match(workflow, /context\.mutatedEntities\.add\(step\.entity\)/);
  assert.match(workflow, /cache\.invalidateMany/);

  const worker = fs.readFileSync(path.join(output, 'src/workflows/worker.js'), 'utf8');
  assert.match(worker, /const cache = require/);
  assert.match(worker, /await cache\.disconnect\(\)/);

  const server = fs.readFileSync(path.join(output, 'src/server.js'), 'utf8');
  assert.match(server, /await cache\.disconnect\(\)/);

  const compose = fs.readFileSync(path.join(output, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /image: redis:7-alpine/);
  assert.match(compose, /CACHE_URL: "redis:\/\/cache:6379"/);
  assert.match(compose, /cache:\n\s+condition: service_healthy/);

  const secret = fs.readFileSync(path.join(output, 'deploy/k8s/secret.example.yaml'), 'utf8');
  assert.match(secret, /CACHE_URL: "<set-me>"/);

  for (const relativeFile of result.files.filter(file => file.endsWith('.js'))) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, relativeFile)], {encoding: 'utf8'});
    assert.equal(checked.status, 0, relativeFile + ' failed syntax check:\n' + checked.stderr);
  }
});


test('generates secure local multipart storage across runtime OpenAPI SDK and admin', async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-files-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const spec = {
    specVersion: '1.0',
    app: {name: 'file-api'},
    database: {type: 'mongodb'},
    storage: {
      provider: 'local',
      local: {directory: 'uploads'},
      signedUrls: {enabled: true, expiresSeconds: 300, path: '/files/:token', signingSecretEnv: 'FILE_SECRET'}
    },
    docs: {openapi: {enabled: true}},
    sdk: {enabled: true, languages: ['javascript', 'typescript']},
    admin: {enabled: true},
    api: {graphql: true},
    entities: {
      Asset: {
        fields: {
          name: {type: 'string', required: true},
          image: {
            type: 'file',
            required: true,
            upload: {maxBytes: 1024, mimeTypes: ['image/*'], directory: 'assets/images'}
          },
          attachments: {
            type: 'file',
            many: true,
            upload: {maxBytes: 2048, mimeTypes: ['text/plain']}
          }
        }
      }
    },
    deployment: {
      docker: {enabled: true},
      compose: {enabled: true, database: true}
    }
  };

  const output = path.join(tempRoot, 'app');
  const result = generateApplication(spec, output);
  assert.ok(result.files.includes('src/config/storage.js'));

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.multer, '^1.4.5-lts.1');

  const env = fs.readFileSync(path.join(output, '.env.example'), 'utf8');
  assert.match(env, /FILE_SECRET=change-me/);

  const storage = fs.readFileSync(path.join(output, 'src/config/storage.js'), 'utf8');
  assert.match(storage, /multer\.memoryStorage/);
  assert.match(storage, /crypto\.randomUUID/);
  assert.match(storage, /checksumSha256/);
  assert.match(storage, /timingSafeEqual/);
  assert.match(storage, /cleanupReplaced/);
  assert.match(storage, /cleanupEntity/);
  assert.match(storage, /Invalid storage path/);
  assert.match(storage, /downloadHandler/);

  const model = fs.readFileSync(path.join(output, 'src/models/Asset.js'), 'utf8');
  assert.match(model, /mongoose\.Schema\.Types\.Mixed/);

  const routes = fs.readFileSync(path.join(output, 'src/routes/AssetRoutes.js'), 'utf8');
  assert.match(routes, /storage\.uploadMiddleware\("Asset"\)/);
  assert.ok(routes.indexOf('storage.uploadMiddleware') < routes.indexOf('validation.body'));

  const controller = fs.readFileSync(path.join(output, 'src/controllers/AssetController.js'), 'utf8');
  assert.match(controller, /storage\.commitUploads\(req\)/);
  assert.match(controller, /storage\.cleanupReplaced/);
  assert.match(controller, /storage\.cleanupEntity/);
  assert.match(controller, /storage\.enrich/);

  const app = fs.readFileSync(path.join(output, 'src/app.js'), 'utf8');
  assert.match(app, /app\.get\("\/files\/:token", storage\.downloadHandler\)/);

  const openapi = JSON.parse(fs.readFileSync(path.join(output, 'openapi.json'), 'utf8'));
  const create = openapi.paths['/api/assets'].post;
  assert.equal(create.requestBody.content['multipart/form-data'].schema.properties.image.format, 'binary');
  assert.equal(create.requestBody.content['multipart/form-data'].schema.properties.attachments.type, 'array');
  assert.equal(openapi.components.schemas.Asset.properties.image.properties.checksumSha256.type, 'string');

  const jsSdk = fs.readFileSync(path.join(output, 'sdk/javascript/index.js'), 'utf8');
  assert.match(jsSdk, /function prepareBody/);
  assert.match(jsSdk, /new FormData/);
  assert.match(jsSdk, /config\.body instanceof FormData/);

  const tsSdk = fs.readFileSync(path.join(output, 'sdk/typescript/index.ts'), 'utf8');
  assert.match(tsSdk, /export interface FileMetadata/);
  assert.match(tsSdk, /image: Blob/);
  assert.match(tsSdk, /attachments\?: Array<Blob>/);

  const admin = fs.readFileSync(path.join(output, 'admin/src/App.jsx'), 'utf8');
  assert.match(admin, /type="file"/);
  assert.match(admin, /field\.upload\.maxBytes/);
  assert.match(admin, /multiple=\{field\.many\}/);

  const compose = fs.readFileSync(path.join(output, 'docker-compose.yml'), 'utf8');
  assert.match(compose, /file-data:\/app\/uploads/);
  assert.match(compose, /file-data:/);

  const dockerfile = fs.readFileSync(path.join(output, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /mkdir -p/);
  assert.match(dockerfile, /\/app\/uploads/);

  const graphql = fs.readFileSync(path.join(output, 'src/graphql/index.js'), 'utf8');
  assert.match(graphql, /image: JSON!/);
  assert.doesNotMatch(graphql, /createAsset\(input: AssetCreateInput!/);

  const normalized = result.spec.entities.find(entity => entity.name === 'Asset');
  assert.equal(normalized.operations.get.cache.enabled, false);

  for (const relativeFile of result.files.filter(file => file.endsWith('.js'))) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, relativeFile)], {encoding: 'utf8'});
    assert.equal(checked.status, 0, relativeFile + ' failed syntax check:\n' + checked.stderr);
  }
});

test('generates S3-compatible object storage and signed URL runtime', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-s3-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const output = path.join(tempRoot, 'app');
  generateApplication({
    specVersion: '1.0',
    app: {name: 's3-api'},
    database: {type: 'postgresql'},
    storage: {
      provider: 's3',
      s3: {
        bucketEnv: 'OBJECT_BUCKET',
        regionEnv: 'OBJECT_REGION',
        endpointEnv: 'OBJECT_ENDPOINT',
        accessKeyEnv: 'OBJECT_ACCESS_KEY',
        secretKeyEnv: 'OBJECT_SECRET_KEY',
        forcePathStyle: true
      }
    },
    entities: {
      Document: {
        fields: {
          name: {type: 'string'},
          file: {type: 'file', upload: {maxBytes: 4096, mimeTypes: ['application/pdf']}}
        }
      }
    }
  }, output);

  const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['@aws-sdk/client-s3']);
  assert.ok(pkg.dependencies['@aws-sdk/s3-request-presigner']);

  const storage = fs.readFileSync(path.join(output, 'src/config/storage.js'), 'utf8');
  assert.match(storage, /new S3Client/);
  assert.match(storage, /PutObjectCommand/);
  assert.match(storage, /DeleteObjectCommand/);
  assert.match(storage, /GetObjectCommand/);
  assert.match(storage, /getSignedUrl/);
  assert.match(storage, /forcePathStyle/);

  const prisma = fs.readFileSync(path.join(output, 'prisma/schema.prisma'), 'utf8');
  assert.match(prisma, /file Json\?/);

  const env = fs.readFileSync(path.join(output, '.env.example'), 'utf8');
  assert.match(env, /OBJECT_BUCKET=/);
  assert.match(env, /OBJECT_REGION=/);
  assert.match(env, /OBJECT_ENDPOINT=/);
  assert.match(env, /OBJECT_ACCESS_KEY=/);
  assert.match(env, /OBJECT_SECRET_KEY=/);
});
