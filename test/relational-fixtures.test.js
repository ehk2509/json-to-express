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
  assert.match(seed, /getModel\(tx,ref.target\).findUnique/);
  assert.match(seed, /Unresolvable required fixture dependency order/);
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

test('allows nullable relational cycles and rejects required dependency cycles', () => {
  const optional = specimen();
  optional.entities.Category.fields.product = {type: 'reference', ref: 'Product'};
  optional.fixtures.Category[0].data.product = {where: {sku: 'SKU-1'}};
  assert.doesNotThrow(() => validateSpec(optional));
  const required = specimen();
  required.entities.Category.fields.product = {type: 'reference', ref: 'Product', required: true};
  required.fixtures.Category[0].data.product = {where: {sku: 'SKU-1'}};
  assert.throws(() => validateSpec(required), /required dependency cycle/);
});
