'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const {normalizeSpec} = require('../src');
const {buildFiles} = require('../src/generators');

function makeSpec(schemaPath = 'prisma/schema.prisma') {
  return {specVersion: '1.0', app: {name: 'migration-check'}, database: {type: 'postgresql', prisma: {schemaPath}}, entities: {Todo: {fields: {name: {type: 'string', required: true}}}}};
}

test('generates a safe initial migration script and npm command', () => {
  const files = buildFiles(normalizeSpec(makeSpec()));
  const pkg = JSON.parse(files.get('package.json'));
  assert.equal(pkg.scripts['db:migrate:init'], 'node scripts/create-initial-migration.js');
  const source = files.get('scripts/create-initial-migration.js');
  assert.match(source, /--from-empty/);
  assert.match(source, /--to-schema-datamodel/);
  assert.match(source, /Refusing to overwrite existing Prisma migrations/);
  assert.match(source, /migration_lock.toml/);
  new vm.Script(source);
});

test('respects relocated Prisma schema and excludes migrations for MongoDB', () => {
  const relocated = buildFiles(normalizeSpec(makeSpec('database/prisma/schema.prisma')));
  assert.match(relocated.get('scripts/create-initial-migration.js'), /database\/prisma\/schema.prisma/);
  const mongo = makeSpec();
  mongo.database.type = 'mongodb';
  const files = buildFiles(normalizeSpec(mongo));
  assert.equal(files.has('scripts/create-initial-migration.js'), false);
});
