'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {generateApplication} = require('../src');

const spec = {
  app: {name: 'shop-api', port: 4000},
  database: {type: 'mongodb'},
  entities: {
    Product: {
      fields: {
        name: {type: 'string', required: true, minLength: 2},
        price: {type: 'number', required: true, min: 0},
        featured: {type: 'boolean', default: false}
      }
    },
    Category: {
      fields: {name: {type: 'string', required: true, unique: true}}
    }
  }
};

test('generates a complete runnable project skeleton from JSON', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));
  const output = path.join(tempRoot, 'shop-api');
  const result = generateApplication(spec, output);

  assert.ok(result.files.includes('src/models/Product.js'));
  assert.ok(result.files.includes('src/controllers/ProductController.js'));
  assert.ok(result.files.includes('src/routes/ProductRoutes.js'));
  assert.ok(result.files.includes('test/health.test.js'));

  const appSource = fs.readFileSync(path.join(output, 'src/app.js'), 'utf8');
  assert.match(appSource, /\/api\/products/);
  assert.match(appSource, /\/api\/categories/);

  const modelSource = fs.readFileSync(path.join(output, 'src/models/Product.js'), 'utf8');
  assert.match(modelSource, /required: true/);
  assert.match(modelSource, /min: 0/);
  assert.match(modelSource, /default: false/);

  const generatedPackage = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.equal(generatedPackage.scripts.start, 'node src/server.js');
  assert.ok(generatedPackage.dependencies.express);
  assert.ok(generatedPackage.dependencies.mongoose);

  for (const relativeFile of result.files.filter(file => file.endsWith('.js'))) {
    const checked = spawnSync(process.execPath, ['--check', path.join(output, relativeFile)], {encoding: 'utf8'});
    assert.equal(checked.status, 0, relativeFile + ' failed syntax check:\n' + checked.stderr);
  }
});

test('does not overwrite an existing generated directory without force', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-overwrite-'));
  t.after(() => fs.rmSync(tempRoot, {recursive: true, force: true}));
  const output = path.join(tempRoot, 'shop-api');
  generateApplication(spec, output);
  assert.throws(() => generateApplication(spec, output), /--force/);
  assert.doesNotThrow(() => generateApplication(spec, output, {force: true}));
});
