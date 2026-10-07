'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {generateApplication, normalizeSpec} = require('../src');

const spec = {
  app: {
    name: 'shop-api',
    port: 4100,
    portEnv: 'HTTP_PORT',
    apiPrefix: '/v1',
    bodyLimit: '2mb',
    health: {
      enabled: true,
      path: '/ready',
      status: 203,
      response: {service: 'shop', ready: true}
    },
    responses: {
      notFound: 'Nothing here',
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
      scripts: {lint: 'node --check src/app.js'},
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
      schemaOptions: {timestamps: false, versionKey: 'revision'},
      operations: {
        list: {method: 'post', path: '/search', status: 202, lean: false},
        get: {path: '/item/:productId', status: 202, notFoundStatus: 410},
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

test('normalizes every configurable application layer', () => {
  const normalized = normalizeSpec(spec);
  assert.equal(normalized.app.apiPrefix, '/v1');
  assert.equal(normalized.app.portEnv, 'HTTP_PORT');
  assert.equal(normalized.app.package.name, 'custom-shop-service');
  assert.equal(normalized.app.package.dependencies.express, '^5.1.0');
  assert.equal(normalized.database.options.maxPoolSize, 12);
  assert.equal(normalized.entities[0].schemaOptions.versionKey, 'revision');
  assert.equal(normalized.entities[0].operations.create.enabled, false);
  assert.equal(normalized.entities[0].operations.update.method, 'put');
  assert.equal(normalized.entities[1].operations.delete.enabled, false);
});

test('generates configured application behavior from JSON', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));
  const output = path.join(tempRoot, 'shop-api');
  const result = generateApplication(spec, output);

  assert.ok(result.files.includes('src/models/Product.js'));
  assert.ok(result.files.includes('src/controllers/ProductController.js'));
  assert.ok(result.files.includes('src/routes/ProductRoutes.js'));
  assert.ok(result.files.includes('test/health.test.js'));

  const appSource = fs.readFileSync(path.join(output, 'src/app.js'), 'utf8');
  assert.match(appSource, /\/v1\/catalog/);
  assert.match(appSource, /\/ready/);
  assert.match(appSource, /2mb/);
  assert.match(appSource, /Nothing here/);
  assert.match(appSource, /status\(410\)/);

  const routesSource = fs.readFileSync(path.join(output, 'src/routes/ProductRoutes.js'), 'utf8');
  assert.match(routesSource, /router\.post\("\/search"/);
  assert.match(routesSource, /router\.put\("\/item\/:productId"/);
  assert.doesNotMatch(routesSource, /controller\.create/);

  const controllerSource = fs.readFileSync(path.join(output, 'src/controllers/ProductController.js'), 'utf8');
  assert.match(controllerSource, /req\.params\["productId"\]/);
  assert.match(controllerSource, /runValidators: false/);
  assert.match(controllerSource, /status\(200\)\.json\(item\)/);

  const modelSource = fs.readFileSync(path.join(output, 'src/models/Product.js'), 'utf8');
  assert.match(modelSource, /trim: true/);
  assert.match(modelSource, /index: true/);
  assert.match(modelSource, /catalog_items/);
  assert.match(modelSource, /"timestamps":false/);
  assert.match(modelSource, /"versionKey":"revision"/);

  const dbSource = fs.readFileSync(path.join(output, 'src/config/database.js'), 'utf8');
  assert.match(dbSource, /SHOP_MONGO_URL/);
  assert.match(dbSource, /"maxPoolSize":12/);

  const env = fs.readFileSync(path.join(output, '.env.example'), 'utf8');
  assert.match(env, /HTTP_PORT=4100/);
  assert.match(env, /SHOP_MONGO_URL=mongodb:\/\/db\.internal\/custom-shop/);

  const generatedPackage = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.equal(generatedPackage.name, 'custom-shop-service');
  assert.equal(generatedPackage.version, '2.3.4');
  assert.equal(generatedPackage.private, false);
  assert.equal(generatedPackage.scripts.lint, 'node --check src/app.js');
  assert.equal(generatedPackage.dependencies.express, '^5.1.0');
  assert.equal(generatedPackage.engines.node, '>=20');

  for (const relativeFile of result.files.filter(file => file.endsWith('.js'))) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, relativeFile)], {encoding: 'utf8'});
    assert.equal(checked.status, 0, relativeFile + ' failed syntax check:\n' + checked.stderr);
  }
});

test('can disable health and individual CRUD operations', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-disabled-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));

  const minimal = JSON.parse(JSON.stringify(spec));
  minimal.app.health.enabled = false;
  minimal.entities.Product.operations = {
    list: false,
    get: false,
    create: true,
    update: false,
    delete: false
  };

  const output = path.join(tempRoot, 'service');
  const result = generateApplication(minimal, output);
  assert.equal(result.files.includes('test/health.test.js'), false);

  const routes = fs.readFileSync(path.join(output, 'src/routes/ProductRoutes.js'), 'utf8');
  assert.match(routes, /controller\.create/);
  assert.doesNotMatch(routes, /controller\.list/);
  assert.doesNotMatch(routes, /controller\.get/);
  assert.doesNotMatch(routes, /controller\.update/);
  assert.doesNotMatch(routes, /controller\.remove/);
});

test('does not overwrite an existing generated directory without force', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-overwrite-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));
  const output = path.join(tempRoot, 'shop-api');
  generateApplication(spec, output);
  assert.throws(() => generateApplication(spec, output), /--force/);
  assert.doesNotThrow(() => generateApplication(spec, output, {force: true}));
});
