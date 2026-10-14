'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {PassThrough, Writable} = require('node:stream');
const {validateSpec} = require('../src');
const {
  TEMPLATES, parseInitArgs, loadTemplate, buildStarter,
  initialize, resolveConfig
} = require('../src/onboarding');
const {parseDoctorArgs, diagnose} = require('../src/doctor');

const cli = path.resolve(__dirname, '../bin/json-to-express.js');
const exec = (args, opts = {}) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', timeout: 20000, ...opts
});
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-onboard-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test('bundled CRUD, SaaS, and e-commerce templates match schema and contain useful entities', () => {
  for (const name of Object.keys(TEMPLATES)) {
    const spec = loadTemplate(name);
    assert.ok(Object.keys(spec.entities).length >= 1);
    assert.equal(validateSpec(spec), undefined);
    for (const database of ['mongodb', 'postgresql']) {
      const converted = buildStarter({
        template: name, name: 'demo-api', framework: 'express',
        database, auth: 'none', deployment: 'compose'
      });
      validateSpec(converted);
      assert.equal(converted.database.type, database);
      assert.equal(converted.deployment.docker.enabled, true);
      assert.equal(converted.generation.outputDir, 'server');
    }
  }
});

test('auth and deployment presets are valid, explicit and contain no secrets', () => {
  for (const auth of ['none', 'jwt', 'local', 'api-key', 'oidc']) {
    const spec = buildStarter({
      template: 'crud', name: 'demo-api', framework: 'fastify',
      database: 'postgresql', auth, issuer: 'https://identity.example.test',
      deployment: 'kubernetes'
    });
    validateSpec(spec);
    assert.equal(spec.deployment.kubernetes.enabled, true);
    assert.equal(spec.deployment.docker.enabled, true);
    assert.doesNotMatch(JSON.stringify(spec), /super-secret|password123/);
  }
  assert.throws(() => buildStarter({auth: 'oidc'}), /requires --issuer/);
  assert.throws(() => buildStarter({auth: 'oidc', issuer: 'http:\/\/example.test'}), /HTTPS/);
});

test('safe init parsing rejects invalid templates, injection-shaped names and extra arguments', () => {
  assert.equal(parseInitArgs(['demo-api', '--template', 'saas', '--yes']).name, 'demo-api');
  assert.throws(() => parseInitArgs(['../sneaky', '--yes']), /lowercase kebab-case/);
  assert.throws(() => parseInitArgs(['demo', '--template', 'other']), /must be one of/);
  assert.throws(() => parseInitArgs(['demo', '--yes', '--yes']), /Duplicate/);
  assert.throws(() => parseInitArgs(['demo', '--unknown']), /Unknown/);
});

test('noninteractive init creates a real generated app and exact selected specification', async t => {
  const root = temporary(t);
  const workspace = path.join(root, 'new-service');
  const options = parseInitArgs([
    'my-store', '--template', 'ecommerce', '--framework', 'express',
    '--database', 'mongodb', '--auth', 'api-key', '--deployment', 'compose',
    '--output', workspace, '--yes'
  ]);
  const result = await initialize(options);
  assert.equal(result.generated, true);
  const spec = JSON.parse(fs.readFileSync(result.specFile, 'utf8'));
  assert.equal(spec.app.name, 'my-store');
  assert.equal(spec.auth.apiKey.keys[0].env, 'API_KEY');
  assert.ok(spec.entities.OrderItem);
  assert.ok(fs.existsSync(path.join(result.appDir, '.j2e-manifest.json')));
  assert.ok(fs.existsSync(path.join(result.appDir, 'docker-compose.yml')));
  assert.equal(validateSpec(spec), undefined);

  const plan = exec(['plan', result.specFile, '--output', result.appDir, '--json']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).status, 'tracked');
});

test('dry-run creates no workspace while validating full generated plan', async t => {
  const root = temporary(t);
  const dest = path.join(root, 'preview');
  const options = parseInitArgs(['preview-api', '--yes', '--dry-run', '--output', dest]);
  const result = await initialize(options);
  assert.equal(result.dryRun, true);
  assert.ok(result.plan.actions.length > 0);
  assert.equal(fs.existsSync(dest), false);
});

test('init refuses nonempty workspaces and preserves user files', async t => {
  const root = temporary(t);
  const dest = path.join(root, 'existing');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'keep.txt'), 'developer work');
  const options = parseInitArgs(['demo-app', '--yes', '--output', dest]);
  await assert.rejects(initialize(options), /nonempty directory/);
  assert.equal(fs.readFileSync(path.join(dest, 'keep.txt'), 'utf8'), 'developer work');
});

test('missing interactive terminal requires --yes for deterministic CI use', async () => {
  await assert.rejects(resolveConfig({}, {input: {isTTY: false}, output: {isTTY: false}}), /--yes/);
  const config = await resolveConfig({'--yes': true, '--template': 'saas'},
    {input: {isTTY: false}, output: {isTTY: false}});
  assert.equal(config.auth, 'local');
  assert.equal(config.database, 'postgresql');
});

test('interactive flow retries invalid selections and confirms validated configuration', async t => {
  const input = new PassThrough();
  input.isTTY = true;
  const answers = ['no-such-template', '', '', '', '', '', '', ''];
  let transcript = '';
  const output = new Writable({
    write(chunk, encoding, cb) {
      const text = chunk.toString();
      transcript += text;
      if (text.includes(']: ')) {
        const answer = answers.shift();
        setImmediate(() => input.write((answer === undefined ? '' : answer) + '\n'));
      }
      cb();
    }
  });
  output.isTTY = true;
  t.after(() => {input.destroy(); output.destroy();});
  const config = await resolveConfig({}, {input, output});
  assert.equal(config.template, 'crud');
  assert.equal(config.framework, 'express');
  assert.match(transcript, /Invalid choice/);
  validateSpec(buildStarter(config));
});

test('doctor reports correct spec and output health without disclosing secret values', async t => {
  const root = temporary(t);
  const workspace = path.join(root, 'service');
  const result = await initialize(parseInitArgs(['demo-service', '--yes', '--deployment', 'none', '--output', workspace]));
  const opts = parseDoctorArgs([result.specFile, '--output', result.appDir]);
  const report = diagnose(opts);
  assert.equal(report.errors, 0, JSON.stringify(report));
  assert.ok(report.checks.some(check => check.code === 'generation' && check.level === 'ok'));
  const json = exec(['doctor', result.specFile, '--output', result.appDir, '--json']);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).ok, true);
  assert.doesNotMatch(json.stdout, /password123|secret-value/);
});

test('doctor fails invalid spec and warns about runtime dependencies without exposing credentials', t => {
  const root = temporary(t);
  const file = path.join(root, 'invalid.json');
  fs.writeFileSync(file, '{"app":{}}');
  const report = exec(['doctor', file, '--json']);
  assert.notEqual(report.status, 0);
  const parsed = JSON.parse(report.stdout);
  assert.ok(parsed.checks.some(check => check.code === 'specification' && check.level === 'error'));
  assert.ok(diagnose({}).checks.some(check => check.code === 'node'));
});

test('installed CLI init and doctor support real noninteractive usage', t => {
  const root = temporary(t);
  const workspace = path.join(root, 'cli-service');
  const init = exec(['init', 'cli-service', '--template', 'crud', '--yes', '--deployment', 'none', '--output', workspace]);
  assert.equal(init.status, 0, init.stderr);
  const doctor = exec(['doctor', path.join(workspace, 'app.j2e.json'),
    '--output', path.join(workspace, 'server'), '--json']);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).ok, true);
  const listing = exec(['init', '--list-templates']);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /ecommerce/);
});
