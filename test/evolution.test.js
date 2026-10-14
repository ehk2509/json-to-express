'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {generateApplication, planApplication} = require('../src');
const {hash} = require('../src/manifest');

const original = () => ({
  app: {name: 'evolution-app'},
  database: {type: 'mongodb'},
  entities: {
    Product: {fields: {title: {type: 'string', required: false}, sku: {type: 'string', unique: true}}}
  }
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-evolution-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, output: path.join(root, 'generated')};
}
function manifest(output) {
  return JSON.parse(fs.readFileSync(path.join(output, '.j2e-manifest.json'), 'utf8'));
}
const has = (plan, severity, code) => plan.schemaChanges.some(x => x.severity === severity && x.code === code);

test('new projects produce a deterministic dry-run without touching disk', t => {
  const {output} = fixture(t);
  const plan = planApplication(original(), output);
  assert.equal(plan.status, 'new');
  assert.equal(plan.summary.add > 0, true);
  assert.equal(plan.schemaChanges.length, 0);
  assert.equal(fs.existsSync(output), false);
  assert.equal(plan.schemaFingerprint.length, 64);
});

test('manifest v2 stores reduced schema only, without runtime secrets or seed records', t => {
  const {output} = fixture(t);
  const spec = original();
  spec.app.package = {description: 'private-credential-should-not-be-stored'};
  spec.seeds = {Product: [{title: 'seed-secret-should-not-be-stored', sku: 'S1'}]};
  generateApplication(spec, output);
  const raw = fs.readFileSync(path.join(output, '.j2e-manifest.json'), 'utf8');
  const saved = JSON.parse(raw);
  assert.equal(saved.version, 2);
  assert.equal(saved.schema.database, 'mongodb');
  assert.equal(saved.schema.entities.Product.fields.title.type, 'string');
  assert.doesNotMatch(raw, /private-credential-should-not-be-stored|seed-secret-should-not-be-stored/);
});

test('safe optional additions are permitted and update the snapshot', t => {
  const {output} = fixture(t);
  const old = original();
  generateApplication(old, output);
  const next = original();
  next.entities.Product.fields.description = {type: 'string'};
  const plan = planApplication(next, output);
  assert.ok(has(plan, 'safe', 'field-added'));
  assert.doesNotThrow(() => generateApplication(next, output));
  assert.ok(manifest(output).schema.entities.Product.fields.description);
});

test('required field additions are blocked until destructive change is acknowledged', t => {
  const {output} = fixture(t);
  generateApplication(original(), output);
  const before = fs.readFileSync(path.join(output, '.j2e-manifest.json'), 'utf8');
  const next = original();
  next.entities.Product.fields.mustExist = {type: 'string', required: true};
  assert.ok(has(planApplication(next, output), 'breaking', 'field-added'));
  assert.throws(() => generateApplication(next, output), /Unsafe schema evolution/);
  assert.equal(fs.readFileSync(path.join(output, '.j2e-manifest.json'), 'utf8'), before);
  assert.doesNotThrow(() => generateApplication(next, output, {allowDestructive: true}));
});

test('field removals, type changes, and reference cardinality changes are breaking', t => {
  const {output} = fixture(t);
  const start = original();
  start.entities.Category = {fields: {name: {type: 'string'}}};
  start.entities.Product.fields.category = {type: 'reference', ref: 'Category', onDelete: 'restrict'};
  generateApplication(start, output);
  const next = structuredClone(start);
  delete next.entities.Product.fields.sku;
  next.entities.Product.fields.title.type = 'number';
  next.entities.Product.fields.category.many = true;
  next.entities.Product.fields.category.onDelete = 'cascade';
  const plan = planApplication(next, output);
  assert.ok(has(plan, 'breaking', 'field-removed'));
  assert.ok(has(plan, 'breaking', 'field-type-changed'));
  assert.ok(has(plan, 'breaking', 'field-many-changed'));
  assert.ok(has(plan, 'breaking', 'field-onDelete-changed'));
});

test('route and index changes require explicit schema review', t => {
  const {output} = fixture(t);
  generateApplication(original(), output);
  const next = original();
  next.entities.Product.route = 'items';
  next.entities.Product.indexes = [{fields: {title: 1}}];
  const plan = planApplication(next, output);
  assert.ok(has(plan, 'review', 'route-changed'));
  assert.ok(has(plan, 'review', 'indexes-changed'));
  assert.throws(() => generateApplication(next, output), /approve-schema/);
  assert.doesNotThrow(() => generateApplication(next, output, {approveSchema: true}));
});

test('database target changes are classified as breaking', t => {
  const {output} = fixture(t);
  generateApplication(original(), output);
  const next = original();
  next.database.type = 'postgresql';
  assert.ok(has(planApplication(next, output), 'breaking', 'database-changed'));
  assert.throws(() => generateApplication(next, output), /allow-destructive/);
});

test('modified generated files are identified before any disk writes', t => {
  const {output} = fixture(t);
  generateApplication(original(), output);
  const model = path.join(output, 'src/models/Product.js');
  fs.appendFileSync(model, '\n// developer edit\n');
  fs.writeFileSync(path.join(output, 'NOTES.md'), 'user-owned');
  const plan = planApplication(original(), output);
  assert.ok(plan.blocking.modifiedFiles.includes('src/models/Product.js'));
  assert.throws(() => generateApplication(original(), output), /developer-modified/);
  generateApplication(original(), output, {force: true});
  assert.doesNotMatch(fs.readFileSync(model, 'utf8'), /developer edit/);
  assert.equal(fs.readFileSync(path.join(output, 'NOTES.md'), 'utf8'), 'user-owned');
});

test('file additions cannot overwrite unowned files, even with force', t => {
  const {output} = fixture(t);
  const spec = original();
  spec.app.health = {enabled: false};
  generateApplication(spec, output);
  const file = path.join(output, 'test/health.test.js');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, 'developer code');
  const next = original();
  assert.throws(() => planApplication(next, output), /unowned file/);
  assert.throws(() => generateApplication(next, output, {force: true}), /unowned file/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'developer code');
});

test('stale files are removed only if owned and unchanged or explicitly forced', t => {
  const {output} = fixture(t);
  generateApplication(original(), output);
  const spec = original();
  spec.app.health = {enabled: false};
  const plan = planApplication(spec, output);
  assert.ok(plan.actions.some(x => x.status === 'remove' && x.path === 'test/health.test.js'));
  fs.appendFileSync(path.join(output, 'test/health.test.js'), '\n// developer edit');
  const changed = planApplication(spec, output);
  assert.ok(changed.actions.some(x => x.status === 'stale-conflict'));
  assert.throws(() => generateApplication(spec, output), /developer-modified/);
  generateApplication(spec, output, {force: true});
  assert.equal(fs.existsSync(path.join(output, 'test/health.test.js')), false);
});

test('legacy manifests preserve files but require explicit unknown-schema acknowledgement', t => {
  const {output} = fixture(t);
  generateApplication(original(), output);
  const saved = manifest(output);
  fs.writeFileSync(path.join(output, '.j2e-manifest.json'),
    JSON.stringify({version: 1, files: saved.files}, null, 2));
  const plan = planApplication(original(), output);
  assert.equal(plan.status, 'legacy');
  assert.ok(has(plan, 'unknown', 'no-history'));
  assert.throws(() => generateApplication(original(), output), /allow-unknown-schema/);
  generateApplication(original(), output, {allowUnknownSchema: true});
  assert.equal(manifest(output).version, 2);
});

test('symlinked files and directories are refused, including force', t => {
  const {root, output} = fixture(t);
  generateApplication(original(), output);
  const external = path.join(root, 'external.txt');
  fs.writeFileSync(external, 'do not touch');
  const ownedFile = path.join(output, 'src/models/Product.js');
  fs.rmSync(ownedFile);
  fs.symlinkSync(external, ownedFile);
  assert.throws(() => planApplication(original(), output), /symbolic link/);
  assert.throws(() => generateApplication(original(), output, {force: true}), /symbolic link/);
  assert.equal(fs.readFileSync(external, 'utf8'), 'do not touch');
});

test('malicious manifest traversal is rejected before any operation', t => {
  const {root, output} = fixture(t);
  generateApplication(original(), output);
  const saved = manifest(output);
  saved.files['../bad'] = hash('payload');
  fs.writeFileSync(path.join(output, '.j2e-manifest.json'), JSON.stringify(saved));
  assert.throws(() => planApplication(original(), output), /Unsafe generated file path/);
  assert.equal(fs.existsSync(path.join(root, 'bad')), false);
});

test('CLI supports machine-readable diff/plan and refuses unsafe upgrade', t => {
  const {root, output} = fixture(t);
  const filename = path.join(root, 'spec.json');
  const spec = original();
  fs.writeFileSync(filename, JSON.stringify(spec));
  const bin = path.resolve(__dirname, '../bin/json-to-express.js');
  const run = args => spawnSync(process.execPath, [bin, ...args], {encoding: 'utf8'});
  const first = run(['generate', filename, '--output', output]);
  assert.equal(first.status, 0, first.stderr);
  const next = original();
  next.entities.Product.fields.title.required = true;
  fs.writeFileSync(filename, JSON.stringify(next));
  const diff = run(['diff', filename, '--output', output, '--json']);
  assert.equal(diff.status, 0, diff.stderr);
  assert.ok(Array.isArray(JSON.parse(diff.stdout).actions));
  const plan = run(['plan', filename, '--output', output, '--json']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.ok(JSON.parse(plan.stdout).schemaChanges.some(x => x.severity === 'breaking'));
  const denied = run(['upgrade', filename, '--output', output]);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /allow-destructive/);
  const allowed = run(['upgrade', filename, '--output', output, '--allow-destructive']);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /Review schema changes/);
});
