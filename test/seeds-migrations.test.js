'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const {normalizeSpec, validateSpec} = require('../src');
const {buildFiles} = require('../src/generators');

function makeSpec() {
  return {
    specVersion: '1.0',
    app: {name: 'seed-test'},
    database: {type: 'postgresql'},
    entities: {
      Category: {fields: {name: {type: 'string', required: true, unique: true}}}
    },
    seeds: {Category: [{name: 'Hardware'}, {name: 'Books'}]}
  };
}

test('generates Prisma migration commands and executable seed source', () => {
  const spec = normalizeSpec(makeSpec());
  const files = buildFiles(spec);
  const pkg = JSON.parse(files.get('package.json'));
  assert.match(pkg.scripts['db:migrate:dev'], /prisma migrate dev --schema/);
  assert.match(pkg.scripts['db:migrate:deploy'], /prisma migrate deploy --schema/);
  assert.match(pkg.scripts['db:migrate:status'], /prisma migrate status --schema/);
  assert.equal(pkg.scripts['db:seed'], 'node prisma/seed.js');
  const source = files.get('prisma/seed.js');
  assert.match(source, /Hardware/);
  assert.match(source, /skipDuplicates: true/);
  new vm.Script(source);
});

test('rejects seeds on MongoDB and unknown entities', () => {
  const mongo = makeSpec();
  mongo.database.type = 'mongodb';
  assert.throws(() => validateSpec(mongo), /only for postgresql/);
  const unknown = makeSpec();
  unknown.seeds.Missing = [{name: 'x'}];
  assert.throws(() => validateSpec(unknown), /unknown entity/);
});

test('rejects reference and nonexistent seed fields', () => {
  const spec = makeSpec();
  spec.entities.Category.fields.parent = {type: 'reference', ref: 'Category'};
  spec.seeds.Category = [{name: 'Hardware', parent: 'a', missing: true}];
  assert.throws(() => validateSpec(spec), /cannot seed references or files/);
  assert.throws(() => validateSpec(spec), /is not an entity field/);
});

test('does not emit a seed file when no data is declared', () => {
  const spec = makeSpec();
  delete spec.seeds;
  assert.equal(buildFiles(normalizeSpec(spec)).has('prisma/seed.js'), false);
});
