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
    'src/plugins.js',
    'src/plugin-worker.js',
    'src/plugin-registry.js',
    'src/plugin-cli.js',
    'registry/catalog.json',
    'docs/PLUGIN-REGISTRY.md',
    'examples/plugin-starter/package.json',
    'examples/consumers/helpdesk-mongo.json',
    'examples/consumers/ledger-postgres.json',
    'examples/plugin-starter/index.js',
    'docs/PLUGINS.md',
    'examples/plugins/flatfile-provider.js',
    'examples/plugins/flatfile-spec.json',
    'src/onboarding.js',
    'src/doctor.js',
    'templates/crud.json',
    'templates/saas.json',
    'templates/ecommerce.json',
    'schema/application.schema.json',
    'ci/p9/contracts.json',
    'ci/p9/consumer-matrix.json',
    'docs/GETTING-STARTED.md',
    'docs/GENERATOR-API.md',
    'docs/UPGRADE-GUARANTEES.md',
    'docs/EXAMPLES.md',
    'docs/REFERENCE.md',
    'scripts/p9-contract-check.js',
    'scripts/p9-consumer-contract.js',
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
  const starterWorkspace = path.join(temporary, 'starter');
  run(process.execPath, [cli, 'init', 'starter-api', '--template', 'saas',
    '--framework', 'express', '--deployment', 'none', '--yes', '--output', starterWorkspace]);
  assert.ok(fs.existsSync(path.join(starterWorkspace, 'app.j2e.json')));
  assert.ok(fs.existsSync(path.join(starterWorkspace, 'server', '.j2e-manifest.json')));
  const doctor = JSON.parse(run(process.execPath, [cli, 'doctor',
    path.join(starterWorkspace, 'app.j2e.json'), '--output', path.join(starterWorkspace, 'server'), '--json']));
  assert.equal(doctor.ok, true);
  const customSpec = path.join(installRoot, 'node_modules', 'json-to-express',
    'examples', 'plugins', 'flatfile-spec.json');
  const customOutput = path.join(temporary, 'flatfile-custom-provider');
  run(process.execPath, [cli, 'validate', customSpec]);
  run(process.execPath, [cli, 'generate', customSpec, '--output', customOutput]);
  assert.ok(fs.existsSync(path.join(customOutput, 'src', 'server.js')));
  const generatedPluginPkg = JSON.parse(fs.readFileSync(path.join(customOutput, 'package.json')));
  assert.equal(generatedPluginPkg.name, 'flatfile-notes');
  const catalog = run(process.execPath, [cli, 'plugin', 'catalog']);
  assert.match(catalog, /Flatfile demo/);
  const publisherStarter = path.join(installRoot, 'node_modules', 'json-to-express',
    'examples', 'plugin-starter', 'package.json');
  const publisherMetadata = JSON.parse(fs.readFileSync(publisherStarter, 'utf8'));
  assert.equal(publisherMetadata.j2ePlugin.apiVersion, 1);
  const packageInfo = require(path.join(installRoot, 'node_modules', 'json-to-express',
    'src', 'plugin-registry.js'));
  assert.equal(packageInfo.validatePackage(publisherMetadata).kind, 'generator');
  console.log('Verified npm package, starters, external provider and plugin registry.');

} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
