'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const {normalizeSpec, validateSpec} = require('../src');
const {buildFiles} = require('../src/generators');

function specimen() {
  return {
    specVersion: '1.0', app: {name: 'fixture-app'},
    database: {type: 'postgresql'},
    entities: {
      Category: {fields: {name: {type: 'string', required: true, unique: true}}},
      Product: {fields: {
        sku: {type: 'string', required: true, unique: true},
        category: {type: 'reference', ref: 'Category', required: true}
      }}
    },
    fixtures: {
      Product: [{where: {sku: 'SKU-1'}, data: {sku: 'SKU-1', category: {where: {name: 'Hardware'}}}}],
      Category: [{where: {name: 'Hardware'}, data: {name: 'Hardware'}}]
    }
  };
}

test('generates idempotent dependency-ordered relational fixture runner', () => {
  const files = buildFiles(normalizeSpec(specimen()));
  const seed = files.get('prisma/seed.js');
  assert.match(seed, /model.upsert/);
  assert.match(seed, /targetModel.findUnique/);
  assert.match(seed, /Unresolvable fixture dependency order/);
  new vm.Script(seed);
  assert.ok(JSON.parse(files.get('package.json')).scripts['db:seed']);
});

test('rejects missing unique selector', () => {
  const input = specimen();
  input.fixtures.Category[0].where = {name: 'Hardware', other: 1};
  assert.throws(() => validateSpec(input), /where must select one declared unique scalar field/);
});

test('rejects missing fixture relation dependency', () => {
  const input = specimen();
  delete input.fixtures.Category;
  assert.throws(() => validateSpec(input), /requires fixture rows for dependency/);
});

test('rejects cyclic fixture references', () => {
  const input = specimen();
  input.entities.Category.fields.product = {type: 'reference', ref: 'Product'};
  input.fixtures.Category[0].data.product = {where: {sku: 'SKU-1'}};
  assert.throws(() => validateSpec(input), /fixtures dependency cycle/);
});
