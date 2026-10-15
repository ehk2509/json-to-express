#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {
  ENTRY, temporary, run, makeSpec, install, migrate,
  startServer, stopServer, exerciseCrud, assertGeneratedEngine
} = require('./compatibility-utils');

const HISTORICAL = new Set(['0.2.0-beta.1', '0.2.0-beta.2']);

function expectFailure(args) {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    encoding: 'utf8', timeout: 30000
  });
  assert.notEqual(result.status, 0, 'Unsafe upgrade unexpectedly succeeded');
  assert.match(result.stderr, /developer-modified|Unsafe schema evolution|allow-unknown-schema/);
}
function historicalCli(root, version) {
  const pack = JSON.parse(run('npm', [
    'pack', 'json-to-express@' + version, '--json', '--pack-destination', root
  ]));
  assert.equal(pack.length, 1);
  assert.equal(pack[0].name, 'json-to-express');
  assert.equal(pack[0].version, version);
  const folder = path.join(root, 'old-' + version);
  fs.mkdirSync(folder);
  run('tar', ['-xzf', path.join(root, pack[0].filename), '-C', folder]);
  const packageDir = path.join(folder, 'package');
  const versionInTarball = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'))).version;
  assert.equal(versionInTarball, version);
  return path.join(packageDir, 'bin/json-to-express.js');
}

async function main() {
  const [version, framework, database] = process.argv.slice(2);
  if (!HISTORICAL.has(version)) throw new Error('Historical release must be pinned to an immutable beta');
  const root = temporary();
  const spec = makeSpec(framework, database);
  const filename = path.join(root, 'spec.json');
  const output = path.join(root, 'generated');
  const marker = path.join(output, 'custom-owner-file.txt');
  try {
    fs.writeFileSync(filename, JSON.stringify(spec));
    const legacy = historicalCli(root, version);
    run(process.execPath, [legacy, 'generate', filename, '--output', output]);
    const oldManifest = JSON.parse(fs.readFileSync(path.join(output, '.j2e-manifest.json')));
    assert.equal(oldManifest.version, 1, 'Historical manifest format must be real, not synthetic');
    fs.writeFileSync(marker, 'developer-owned; must survive every regeneration');
    install(output);
    if (database === 'postgresql') migrate(output);

    let id;
    let server = await startServer(output, database);
    try {id = await exerciseCrud(server);}
    finally {await stopServer(server);}

    const file = path.join(output, 'README.md');
    fs.appendFileSync(file, '\n// developer edit used for regression test\n');
    expectFailure(['upgrade', filename, '--output', output, '--allow-unknown-schema']);
    assert.match(fs.readFileSync(file, 'utf8'), /developer edit used for regression test/);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'developer-owned; must survive every regeneration');

    // Force can replace generator-owned edits; unknown history must be
    // acknowledged separately and cannot be interpreted as live schema proof.
    run(process.execPath, [ENTRY, 'upgrade', filename, '--output', output,
      '--allow-unknown-schema', '--force']);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, '.j2e-manifest.json')));
    assert.equal(manifest.version, 2);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /developer edit used for regression test/);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'developer-owned; must survive every regeneration');
    assertGeneratedEngine(output, framework);

    run(process.execPath, [ENTRY, 'upgrade', filename, '--output', output]);
    const plan = JSON.parse(run(process.execPath,
      [ENTRY, 'plan', filename, '--output', output, '--json']));
    assert.equal(plan.status, 'tracked');
    assert.equal(plan.blocking.modifiedFiles.length, 0);
    assert.equal(plan.blocking.schema.length, 0);
    install(output);
    server = await startServer(output, database);
    try {
      const persistedId = await exerciseCrud(server, id);
      assert.equal(persistedId, id, 'Existing DB records must survive generator upgrade');
    } finally {
      await stopServer(server);
    }
    console.log('PASS upgrade + persisted data:', version, framework, database);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
