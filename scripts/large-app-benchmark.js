#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {
  ENTRY, temporary, run, makeSpec
} = require('./compatibility-utils');

const BASELINE_RELEASE = '0.2.0-beta.2';
const BUDGET = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ci/performance-budgets.json')));
const combinations = [
  ['express', 'mongodb'], ['express', 'postgresql'],
  ['fastify', 'mongodb'], ['fastify', 'postgresql']
];
function buildLargeSpec(framework, database) {
  const spec = makeSpec(framework, database);
  spec.app.name = 'large-' + framework + '-' + database;
  const entities = {};
  for (let i = 1; i <= BUDGET.entities; i++) {
    const name = 'Record' + String(i).padStart(2, '0');
    const fields = {
      title: {type: 'string', required: true},
      description: {type: 'string'},
      slug: {type: 'string', unique: true},
      score: {type: 'number'},
      enabled: {type: 'boolean', default: false},
      reviewedAt: {type: 'date'},
      group: {type: 'string'},
      priority: {type: 'number'}
    };
    if (i > 1) fields.parent = {type: 'reference', ref: 'Record' + String(i - 1).padStart(2, '0')};
    entities[name] = {fields};
  }
  spec.entities = entities;
  return spec;
}
function measure(cli, specFile, output) {
  const start = performance.now();
  run(process.execPath, [cli, 'generate', specFile, '--output', output]);
  const elapsedMs = Math.round(performance.now() - start);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, '.j2e-manifest.json')));
  const fileCount = Object.keys(manifest.files).length;
  const bytes = Object.keys(manifest.files).reduce((total, file) =>
    total + fs.statSync(path.join(output, file)).size, 0);
  return {elapsedMs, fileCount, generatedBytes: bytes};
}
const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function main() {
  const root = temporary();
  try {
    const pack = JSON.parse(run('npm', ['pack', 'json-to-express@' + BASELINE_RELEASE,
      '--json', '--pack-destination', root]))[0];
    assert.equal(pack.name, 'json-to-express');
    assert.equal(pack.version, BASELINE_RELEASE);
    const baselineDir = path.join(root, 'baseline');
    fs.mkdirSync(baselineDir);
    run('tar', ['-xzf', path.join(root, pack.filename), '-C', baselineDir]);
    const oldCLI = path.join(baselineDir, 'package/bin/json-to-express.js');
    const results = [];
    for (const [framework, database] of combinations) {
      const spec = buildLargeSpec(framework, database);
      const specPath = path.join(root, framework + '-' + database + '.json');
      fs.writeFileSync(specPath, JSON.stringify(spec));
      const oldSamples = [];
      const currentSamples = [];
      for (let i = 0; i < BUDGET.iterations; i++) {
        oldSamples.push(measure(oldCLI, specPath,
          path.join(root, 'old-' + framework + '-' + database + '-' + i)));
        currentSamples.push(measure(ENTRY, specPath,
          path.join(root, 'current-' + framework + '-' + database + '-' + i)));
      }
      const oldMs = median(oldSamples.map(x => x.elapsedMs));
      const currentMs = median(currentSamples.map(x => x.elapsedMs));
      const files = currentSamples[0].fileCount;
      assert.ok(files >= BUDGET.minimumFiles,
        'Insufficient generated output for ' + framework + '/' + database + ': ' + files);
      assert.ok(currentMs <= Math.max(BUDGET.absoluteMaxMs, oldMs * BUDGET.maxRatio),
        'Generation performance regression ' + framework + '/' + database +
        ' (current ' + currentMs + 'ms vs baseline ' + oldMs + 'ms)');
      results.push({framework, database, baselineMs: oldMs, currentMs,
        ratio: Number((currentMs / Math.max(oldMs, 1)).toFixed(3)), files,
        generatedBytes: currentSamples[0].generatedBytes,
        historicalSamples: oldSamples, currentSamples});
    }
    const report = {
      name: 'j2e-generation-baseline',
      historicalVersion: BASELINE_RELEASE,
      historicalTarballIntegrity: pack.integrity || null,
      currentVersion: require('../package.json').version,
      node: process.version, platform: process.platform,
      entitiesPerSpec: BUDGET.entities, samples: BUDGET.iterations,
      thresholds: BUDGET, results
    };
    const file = process.env.J2E_PERFORMANCE_REPORT;
    if (file) {
      fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
      fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}
try {main();}
catch (error) {console.error(error); process.exitCode = 1;}
