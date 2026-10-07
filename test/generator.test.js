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
