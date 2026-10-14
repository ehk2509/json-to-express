#!/usr/bin/env node
'use strict';

// Verify the actual npm tarball, not the repository checkout. This catches
// missing publishable files or runtime imports that only work in the monorepo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-tarball-'));
function run(program, args, opts = {}) {
  return execFileSync(program, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts
  });
}

try {
  const manifest = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary]))[0];
  assert.equal(manifest.name, 'json-to-express');
  const packageFiles = new Set(manifest.files.map(entry => entry.path));
  for (const entry of [
    'bin/json-to-express.js',
    'src/index.js',
    'schema/application.schema.json',
    'README.md',
    'LICENSE'
  ]) assert.ok(packageFiles.has(entry), 'Missing from npm pack: ' + entry);

  const installRoot = path.join(temporary, 'consumer');
  fs.mkdirSync(installRoot);
  run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund',
    '--prefix', installRoot, path.join(temporary, manifest.filename)
  ]);

  const cli = path.join(installRoot, 'node_modules', 'json-to-express', 'bin', 'json-to-express.js');
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  assert.equal(run(process.execPath, [cli, '--version']).trim(), version);

  const specPath = path.join(temporary, 'sample.json');
  fs.writeFileSync(specPath, JSON.stringify({
    app: {name: 'tarball-smoke'},
    database: {type: 'mongodb'},
    entities: {Todo: {fields: {title: {type: 'string', required: true}}}}
  }));

  run(process.execPath, [cli, 'validate', specPath]);
  const output = path.join(temporary, 'generated');
  run(process.execPath, [cli, 'generate', specPath, '--output', output]);
  for (const entry of ['package.json', '.j2e-manifest.json']) {
    assert.ok(fs.existsSync(path.join(output, entry)), 'Missing generated file: ' + entry);
  }
  console.log('Verified published tarball, CLI validation, generation, and manifest.');
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
