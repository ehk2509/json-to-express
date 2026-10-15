'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(PROJECT_ROOT, 'bin/json-to-express.js');
const DATABASES = Object.freeze({
  mongodb: 'mongodb://127.0.0.1:27017/j2e_compatibility',
  postgresql: 'postgresql://postgres:postgres@127.0.0.1:5432/j2e_compatibility'
});

function temporary() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-compat-'));
}
function run(program, args, cwd = PROJECT_ROOT, env = {}) {
  const result = spawnSync(program, args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 240000,
    env: {...process.env, ...env}, maxBuffer: 4 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error([program, ...args].join(' ') + ': ' +
      String(result.error || result.stderr || result.stdout).slice(-5000));
  }
  return result.stdout.trim();
}
function makeSpec(framework, database) {
  assert.ok(['express', 'fastify'].includes(framework));
  assert.ok(Object.hasOwn(DATABASES, database));
  const spec = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'templates/crud.json')));
  spec.app.framework = framework;
  spec.app.name = 'compat-' + framework + '-' + database;
  spec.database.type = database;
  return spec;
}
function install(dir) {
  run('npm', ['install', '--no-audit', '--no-fund'], dir);
}
function migrate(dir) {
  run('npm', ['run', 'db:migrate:init'], dir, {DATABASE_URL: DATABASES.postgresql});
  run('npm', ['run', 'db:migrate:deploy'], dir, {DATABASE_URL: DATABASES.postgresql});
  run('npm', ['run', 'db:migrate:verify'], dir, {DATABASE_URL: DATABASES.postgresql});
}
async function waitForServer(url, child, logs) {
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error('Generated server exited early: ' + logs().slice(-3000));
    try {
      const result = await fetch(url + '/health');
      if (result.status === 200) return;
    } catch (_) {/* Startup in progress. */}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Generated app failed health check: ' + logs().slice(-3000));
}
async function startServer(dir, database, port = 3877) {
  const env = {
    ...process.env, PORT: String(port), HOST: '127.0.0.1',
    MONGODB_URI: DATABASES.mongodb, DATABASE_URL: DATABASES.postgresql
  };
  const server = spawn(process.execPath, [path.join(dir, 'src/server.js')], {
    cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', chunk => {output += chunk.toString();});
  server.stderr.on('data', chunk => {output += chunk.toString();});
  const url = 'http://127.0.0.1:' + port;
  try {await waitForServer(url, server, () => output);}
  catch (error) {server.kill('SIGKILL'); throw error;}
  return {server, url, logs: () => output};
}
async function stopServer(started) {
  if (started.server.exitCode !== null) return;
  started.server.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => started.server.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 4000))
  ]);
  if (started.server.exitCode === null) started.server.kill('SIGKILL');
}
async function exerciseCrud(started, id = null) {
  const base = started.url + '/api/tasks';
  if (!id) {
    const created = await fetch(base, {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({title: 'Compatibility fixture', completed: false})
    });
    assert.equal(created.status, 201, 'POST /api/tasks: ' + await created.text());
    const row = await created.json();
    id = row._id || row.id;
    assert.ok(id, 'new record ID');
  }
  const found = await fetch(base + '/' + id);
  assert.equal(found.status, 200, 'GET /api/tasks/:id: ' + await found.text());
  assert.equal((await found.json()).title, 'Compatibility fixture');
  const list = await fetch(base);
  assert.equal(list.status, 200);
  const rows = await list.json();
  assert.ok(Array.isArray(rows) && rows.some(row => (row._id || row.id) === id));
  return id;
}
function assertGeneratedEngine(dir, framework) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, framework === 'fastify' ? '>=20' : '>=18');
}
module.exports = {
  PROJECT_ROOT, ENTRY, DATABASES, temporary, run, makeSpec,
  install, migrate, startServer, stopServer, exerciseCrud, assertGeneratedEngine
};
