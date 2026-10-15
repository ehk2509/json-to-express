#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {ENTRY, temporary, run, makeSpec} = require('./compatibility-utils');

function main() {
  const [framework, database] = process.argv.slice(2);
  const root = temporary();
  try {
    const spec = makeSpec(framework, database);
    spec.deployment = {
      docker: {enabled: true},
      compose: {enabled: true, database: true},
      kubernetes: {enabled: true}
    };
    const specPath = path.join(root, 'spec.json');
    const output = path.join(root, 'generated');
    fs.writeFileSync(specPath, JSON.stringify(spec));
    run(process.execPath, [ENTRY, 'generate', specPath, '--output', output]);
    // NPM audit covers production dependency resolution for the exact
    // generated framework/database combination, not just the generator CLI.
    run('npm', ['install', '--package-lock-only', '--ignore-scripts',
      '--no-audit', '--no-fund'], output);
    run('npm', ['audit', '--omit=dev', '--audit-level=high'], output);
    run('docker', ['compose', '-f', 'docker-compose.yml', 'config', '--quiet'], output);
    const k8sDir = path.join(output, 'deploy/k8s');
    assert.ok(fs.existsSync(k8sDir), 'Missing generated K8s files');
    run('python3', [path.join(__dirname, 'validate-deployment.py'), k8sDir]);
    const dockerfile = fs.readFileSync(path.join(output, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /FROM /);
    console.log('PASS production dependency and deployment manifests:', framework, database);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}
try {main();}
catch (error) {console.error(error); process.exitCode = 1;}
