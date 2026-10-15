'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {generateApplication, planApplication, recoverTransaction} = require('../src');
const {locations} = require('../src/transaction');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-transaction-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, output: path.join(root, 'project')};
}
const spec = () => ({app: {name: 'transaction-app'}, database: {type: 'mongodb'},
  entities: {Task: {fields: {title: {type: 'string', required: true}}}}});
function upgraded() {
  const value = spec();
  value.entities.Task.fields.description = {type: 'string'};
  value.app.health = {enabled: false};
  return value;
}
function manifest(output) {
  return JSON.parse(fs.readFileSync(path.join(output, '.j2e-manifest.json'), 'utf8'));
}
function treeSnapshot(root) {
  if (!fs.existsSync(root)) return null;
  const entries = {};
  function visit(dir, prefix = '') {
    for (const file of fs.readdirSync(dir).sort()) {
      const relative = prefix ? prefix + '/' + file : file;
      const absolute = path.join(dir, file), stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute, relative);
      else if (stat.isSymbolicLink()) entries[relative] = 'link:' + fs.readlinkSync(absolute);
      else entries[relative] = fs.readFileSync(absolute).toString('base64');
    }
  }
  visit(root);
  return entries;
}
function crashGeneration(output, newSpec, phase, root) {
  const filename = path.join(root, 'crash-spec.json');
  fs.writeFileSync(filename, JSON.stringify(newSpec));
  const code = [
    "const fs = require('node:fs');",
    "const {generateApplication} = require(" + JSON.stringify(path.resolve(__dirname, '../src')) + ");",
    "generateApplication(JSON.parse(fs.readFileSync(" + JSON.stringify(filename) + ")),",
    JSON.stringify(output) + ", {transactionFault: at => {",
    "if(at === " + JSON.stringify(phase) + ") process.kill(process.pid, 'SIGKILL');",
    "}});"
  ].join('\n');
  const child = spawnSync(process.execPath, ['-e', code], {encoding: 'utf8', timeout: 20000});
  assert.equal(child.signal, 'SIGKILL', 'Expected crash at ' + phase + ': ' + child.stderr);
}
function assertClean(output) {
  assert.equal(fs.existsSync(locations(output).journal), false, 'Journal must be removed');
  assert.equal(fs.existsSync(locations(output).lock), false, 'Lock must be released');
}

test('success stages all files, retains user data and drops obsolete owned files', t => {
  const {output} = workspace(t);
  generateApplication(spec(), output);
  fs.mkdirSync(path.join(output, 'data'));
  fs.writeFileSync(path.join(output, 'data/user-record.json'), '{"keep":true}');
  fs.writeFileSync(path.join(output, '.env'), 'MY_SECRET=private');
  assert.ok(fs.existsSync(path.join(output, 'test/health.test.js')));
  generateApplication(upgraded(), output);
  assert.ok(manifest(output).schema.entities.Task.fields.description);
  assert.equal(fs.existsSync(path.join(output, 'test/health.test.js')), false);
  assert.equal(fs.readFileSync(path.join(output, 'data/user-record.json'), 'utf8'), '{"keep":true}');
  assert.equal(fs.readFileSync(path.join(output, '.env'), 'utf8'), 'MY_SECRET=private');
  assertClean(output);
  assert.equal(planApplication(upgraded(), output).blocking.modifiedFiles.length, 0);
});

test('injected exceptions at each boundary roll back the original tree', t => {
  for (const phase of ['after-stage', 'after-backup', 'after-promote']) {
    const {output} = workspace(t);
    generateApplication(spec(), output);
    const original = treeSnapshot(output);
    assert.throws(() => generateApplication(upgraded(), output, {
      transactionFault: at => {if (at === phase) throw new Error('injected-' + phase);}
    }), new RegExp('injected-' + phase));
    assert.deepEqual(treeSnapshot(output), original, 'Original output must survive ' + phase);
    assertClean(output);
  }
});

test('SIGKILL after staging leaves original intact and recover clears orphan stage', t => {
  const {root, output} = workspace(t);
  generateApplication(spec(), output);
  fs.writeFileSync(path.join(output, 'unowned.txt'), 'kept after crash');
  const old = treeSnapshot(output);
  crashGeneration(output, upgraded(), 'after-stage', root);
  assert.ok(fs.existsSync(locations(output).journal));
  assert.throws(() => planApplication(upgraded(), output), /Interrupted generation/);
  assert.equal(recoverTransaction(output).status, 'aborted-staging');
  assert.deepEqual(treeSnapshot(output), old);
  assertClean(output);
});

test('SIGKILL after moving original restores backup when target is absent', t => {
  const {root, output} = workspace(t);
  generateApplication(spec(), output);
  fs.writeFileSync(path.join(output, 'personal.json'), '{"value":17}');
  const old = treeSnapshot(output);
  crashGeneration(output, upgraded(), 'after-backup', root);
  assert.equal(fs.existsSync(output), false);
  assert.equal(recoverTransaction(output).status, 'rolled-back');
  assert.deepEqual(treeSnapshot(output), old);
  assertClean(output);
  generateApplication(upgraded(), output);
  assert.ok(manifest(output).schema.entities.Task.fields.description);
});

test('SIGKILL after promotion quarantines complete candidate and restores old files', t => {
  const {root, output} = workspace(t);
  generateApplication(spec(), output);
  fs.writeFileSync(path.join(output, 'notes.md'), 'valuable user notes');
  const old = treeSnapshot(output);
  crashGeneration(output, upgraded(), 'after-promote', root);
  const result = recoverTransaction(output);
  assert.equal(result.status, 'rolled-back');
  assert.ok(fs.existsSync(result.quarantine));
  assert.ok(manifest(result.quarantine).schema.entities.Task.fields.description);
  assert.deepEqual(treeSnapshot(output), old);
  assertClean(output);
});

test('SIGKILL after committed marker finalizes new project with intact user data', t => {
  const {root, output} = workspace(t);
  generateApplication(spec(), output);
  fs.writeFileSync(path.join(output, 'owner.txt'), 'owner-data');
  crashGeneration(output, upgraded(), 'after-commit', root);
  assert.equal(recoverTransaction(output).status, 'committed');
  assert.ok(manifest(output).schema.entities.Task.fields.description);
  assert.equal(fs.readFileSync(path.join(output, 'owner.txt'), 'utf8'), 'owner-data');
  assertClean(output);
});

test('next generate automatically resolves stale journal before replanning', t => {
  const {root, output} = workspace(t);
  generateApplication(spec(), output);
  crashGeneration(output, upgraded(), 'after-backup', root);
  generateApplication(upgraded(), output);
  assert.ok(manifest(output).schema.entities.Task.fields.description);
  assertClean(output);
});

test('new project interrupted at stage or promote is never half-written', t => {
  for (const phase of ['after-stage', 'after-promote']) {
    const {root, output} = workspace(t);
    crashGeneration(output, spec(), phase, root);
    const result = recoverTransaction(output);
    if (phase === 'after-stage') {
      assert.equal(result.status, 'aborted-staging');
      assert.equal(fs.existsSync(output), false);
    } else {
      assert.equal(result.status, 'committed-new');
      assert.ok(manifest(output).schema.entities.Task);
    }
    assertClean(output);
  }
});

test('independent processes cannot regenerate the same output simultaneously', async t => {
  const {output} = workspace(t);
  generateApplication(spec(), output);
  const code = [
    "const {generateApplication}=require(" + JSON.stringify(path.resolve(__dirname, '../src')) + ");",
    "generateApplication(" + JSON.stringify(upgraded()) + "," + JSON.stringify(output) + ",{",
    "transactionFault: phase => {if(phase==='after-stage') ",
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1800);}});"
  ].join('\n');
  const child = spawn(process.execPath, ['-e', code], {stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', b => {stderr += b;});
  t.after(() => {if (child.exitCode === null) child.kill('SIGKILL');});
  const lock = locations(output).lock;
  let acquired = false;
  for (let n = 0; n < 100; n++) {
    if (fs.existsSync(lock)) {acquired = true; break;}
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.ok(acquired, 'First process should acquire lock');
  assert.throws(() => generateApplication(upgraded(), output), /Generation locked/);
  const exit = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(exit, 0, stderr);
  assert.ok(manifest(output).schema.entities.Task.fields.description);
  assertClean(output);
});

test('tampered promoted generated files block unsafe automatic recovery', t => {
  const {root, output} = workspace(t);
  generateApplication(spec(), output);
  crashGeneration(output, upgraded(), 'after-promote', root);
  fs.appendFileSync(path.join(output, 'package.json'), '\n// user mutation');
  assert.throws(() => recoverTransaction(output), /modified/);
  assert.ok(fs.existsSync(locations(output).journal));
});

test('CLI recovery works after a crash without needing a spec', t => {
  const {root, output} = workspace(t);
  generateApplication(spec(), output);
  crashGeneration(output, upgraded(), 'after-backup', root);
  const result = spawnSync(process.execPath,
    [path.resolve(__dirname, '../bin/json-to-express.js'), 'recover', '--output', output],
    {encoding: 'utf8', timeout: 15000});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Recovery: rolled-back/);
  assert.equal(manifest(output).schema.entities.Task.fields.description, undefined);
  assertClean(output);
});
