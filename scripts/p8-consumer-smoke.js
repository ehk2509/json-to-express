#!/usr/bin/env node
'use strict';

// Runs a *packaged* CLI in an isolated consumer workspace, using real databases.
// This is controlled integration evidence, NOT evidence of independent adoption.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {validateCase, publicReport, percentile} = require('./p8-validation-core');

const ROOT = path.resolve(__dirname, '..');

function argumentsFrom(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--case', '--report'].includes(key) || options[key] || !args[i + 1]) {
      throw new Error('Usage: node scripts/p8-consumer-smoke.js --case <case.json> --report <report.json>');
    }
    options[key] = path.resolve(args[++i]);
  }
  if (!options['--case'] || !options['--report']) throw new Error('Missing case/report');
  return options;
}
function exec(program, args, cwd, env = process.env, timeout = 240000) {
  const result = spawnSync(program, args, {cwd, env, windowsHide: true,
    timeout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
  if (result.error || result.status !== 0) {
    // Never print CLI stderr; it may contain a database connection URI.
    throw new Error('Step failed: ' + path.basename(program) + ' (exit ' + result.status + ')');
  }
  return result.stdout;
}
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));

async function launch(output, pilot, env) {
  const port = Number(process.env.P8_PORT || 3957);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid P8_PORT');
  const target = 'http://127.0.0.1:' + port;
  const appEnv = {...env,
    [pilot.spec.app.portEnv || 'PORT']: String(port),
    [pilot.spec.app.hostEnv || 'HOST']: '127.0.0.1'};
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: output, env: appEnv, stdio: 'ignore', windowsHide: true
  });
  try {
    for (let attempt = 0; attempt < 70; attempt++) {
      if (child.exitCode !== null) throw new Error('Generated server exited before health check');
      try {
        const response = await fetch(target + (pilot.spec.app.health?.path || '/health'),
          {signal: AbortSignal.timeout(2000)});
        if (response.status === 200) return {child, target};
      } catch (_) { /* Startup in progress. */ }
      await sleep(450);
    }
    throw new Error('Timed out starting generated consumer API');
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}
async function stop(started) {
  if (!started) return;
  const {child} = started;
  if (child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(3000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, sleep(1500)]);
  }
}
async function query(url, method = 'GET', body = undefined) {
  const started = performance.now();
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : {'content-type':'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(9000)
  });
  const raw = await response.text();
  let parsed;
  try {parsed = JSON.parse(raw);} catch (_) {parsed = null;}
  return {status: response.status, data: parsed, elapsedMs: Number((performance.now()-started).toFixed(2))};
}
function recordIdentifier(row) {
  const id = row && (row._id || row.id);
  if (typeof id !== 'string' || !id || id.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Generated API returned an invalid primary key');
  }
  return id;
}
async function probe(started, pilot, checks, timings) {
  const url = started.target + pilot.probe.route;
  let response = await query(url, 'POST', pilot.probe.payload);
  assert.equal(response.status, 201, 'Expected 201 from create');
  const id = recordIdentifier(response.data);
  checks.create = true;
  timings.createMs = response.elapsedMs;
  response = await query(url + '/' + encodeURIComponent(id));
  assert.equal(response.status, 200, 'Expected 200 for persisted entity');
  assert.equal(response.data[pilot.probe.assertField], pilot.probe.assertValue);
  checks.retrieve = true;
  response = await query(url, 'POST', {});
  assert.ok(response.status >= 400 && response.status < 500, 'Invalid request accepted');
  checks.validation = true;
  return {id, url};
}
async function soak(url, id, checks, timings) {
  const samples = [];
  for (let batch = 0; batch < 6; batch++) {
    const responses = await Promise.all(Array.from({length: 10},
      () => query(url + '/' + encodeURIComponent(id))));
    for (const response of responses) {
      assert.equal(response.status, 200, 'Read workload returned a non-200 status');
      samples.push(response.elapsedMs);
    }
  }
  timings.soakRequests = samples.length;
  timings.soakP50Ms = percentile(samples, .50);
  timings.soakP95Ms = percentile(samples, .95);
  checks.soak = true;
}
async function exercise(output, pilot, env, checks, timings) {
  let running;
  try {
    running = await launch(output, pilot, env);
    const created = await probe(running, pilot, checks, timings);
    await soak(created.url, created.id, checks, timings);
    await stop(running);
    running = await launch(output, pilot, env);
    const persisted = await query(running.target + pilot.probe.route +
      '/' + encodeURIComponent(created.id));
    assert.equal(persisted.status, 200, 'Record missing after server restart');
    assert.equal(persisted.data[pilot.probe.assertField], pilot.probe.assertValue);
    checks.restartPersistence = true;
    const removed = await query(running.target + pilot.probe.route +
      '/' + encodeURIComponent(created.id), 'DELETE');
    assert.equal(removed.status, 204, 'DELETE did not succeed');
    const gone = await query(running.target + pilot.probe.route +
      '/' + encodeURIComponent(created.id));
    assert.equal(gone.status, 404, 'Deleted record remained accessible');
    checks.delete = true;
  } finally {await stop(running);}
}
async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const pilot = validateCase(JSON.parse(fs.readFileSync(options['--case'], 'utf8')));
  const variable = pilot.spec.database.uriEnv ||
    (pilot.spec.database.type === 'postgresql' ? 'DATABASE_URL' : 'MONGODB_URI');
  if (!process.env[variable]) throw new Error('Missing P8 database environment variable: ' + variable);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-p8-consumer-'));
  const report = options['--report'];
  const checks = {};
  const timings = {};
  let outcome = 'fail', tarballIntegrity = null, errorCode = null;
  try {
    const pack = JSON.parse(exec('npm', ['pack', '--json', '--pack-destination', root], ROOT))[0];
    assert.equal(pack.name, 'json-to-express');
    tarballIntegrity = pack.integrity;
    const consumer = path.join(root, 'independent-consumer');
    fs.mkdirSync(consumer);
    exec('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts',
      '--prefix', consumer, path.join(root, pack.filename)], ROOT);
    const cli = path.join(consumer, 'node_modules/json-to-express/bin/json-to-express.js');
    const specFile = path.join(root, 'consumer-spec.json');
    fs.writeFileSync(specFile, JSON.stringify(pilot.spec, null, 2), {mode: 0o600});
    const output = path.join(root, 'generated-api');
    const started = performance.now();
    exec(process.execPath, [cli, 'validate', specFile], root);
    exec(process.execPath, [cli, 'generate', specFile, '--output', output], root);
    timings.generationMs = Math.round(performance.now() - started);
    const outputPkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json')));
    assert.equal(outputPkg.name, pilot.spec.app.name);
    exec('npm', ['install', '--no-audit', '--no-fund'], output, process.env, 360000);
    if (pilot.spec.database.type === 'postgresql') {
      exec('npm', ['run', 'db:migrate:init'], output);
      exec('npm', ['run', 'db:migrate:deploy'], output);
      exec('npm', ['run', 'db:migrate:verify'], output);
    }
    await exercise(output, pilot, process.env, checks, timings);
    outcome = 'pass';
  } catch (error) {
    // Only include a fixed error category, never stderr or an untrusted URI.
    errorCode = (error && error.code && /^[A-Z_]+$/.test(error.code)) ?
      error.code : 'P8_CONSUMER_FAILED';
    process.exitCode = 1;
  } finally {
    const payload = publicReport({pilot, checks, timings,
      commit:process.env.GITHUB_SHA || process.env.P8_TARGET_SHA || '',
      tarballIntegrity, outcome});
    if (errorCode) payload.failureCode = errorCode;
    fs.mkdirSync(path.dirname(report), {recursive:true});
    fs.writeFileSync(report, JSON.stringify(payload, null, 2) + '\n', {mode:0o600});
    fs.rmSync(root, {recursive:true, force:true});
    console.log('P8 ' + outcome.toUpperCase() + ': ' + pilot.id +
      ' (simulation, not an external production deployment); report: ' + report);
  }
}
if (require.main === module) main().catch(error => {
  console.error('P8 runner:', String(error.message).replace(/(mongodb(?:\+srv)?|postgresql):\/\/\S+/gi,
    '[redacted-uri]'));
  process.exitCode = 1;
});
module.exports = {argumentsFrom, recordIdentifier};
