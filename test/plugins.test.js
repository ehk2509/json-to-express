'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {generateApplication, planApplication, PLUGIN_API_VERSION, PLUGIN_KINDS} = require('../src');
const {safeArtifactPath, validateDeclarations} = require('../src/plugins');

const baseSpec = () => ({
  app: {name: 'plugin-example'},
  database: {type: 'mongodb'},
  entities: {Note: {fields: {title: {type: 'string', required: true}}}}
});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-plugins-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, output: path.join(root, 'generated')};
}
function moduleAt(root, name, body) {
  const filename = path.join(root, name + '.js');
  fs.writeFileSync(filename, body);
  return filename;
}
function declaration(file, kind, extras = {}) {
  return {module: file, kind, ...extras};
}
function buildModule(kind, contents) {
  return "module.exports={apiVersion:1,id:'example." + kind + "',kind:'" +
    kind + "',generate(){return " + JSON.stringify(contents) + ";}};";
}

test('exports a versioned contract with all five extension kinds', () => {
  assert.equal(PLUGIN_API_VERSION, 1);
  assert.deepEqual([...PLUGIN_KINDS],
    ['generator', 'database', 'middleware', 'authentication', 'storage']);
  assert.throws(() => safeArtifactPath('../outside'), /Unsafe/);
  assert.throws(() => safeArtifactPath('.j2e-manifest.json'), /Unsafe/);
  assert.throws(() => validateDeclarations([{module: 'x', kind: 'unsafe'}]), /Invalid/);
});

test('standalone third-party database provider generates a working persistent API', async t => {
  const {output} = fixture(t);
  const pluginRoot = path.resolve(__dirname, '../examples/plugins');
  const spec = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'flatfile-spec.json'), 'utf8'));
  const dryRun = planApplication(spec, output, {pluginRoot});
  assert.equal(fs.existsSync(output), false);
  assert.ok(dryRun.actions.some(x => x.path === 'src/server.js' && x.status === 'add'));
  const result = generateApplication(spec, output, {pluginRoot});
  assert.ok(result.files.includes('src/server.js'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, '.j2e-manifest.json'))).schema.database, 'flatfile');
  assert.ok(planApplication(spec, output, {pluginRoot}).summary.unchanged > 0);

  const child = spawn(process.execPath, [path.join(output, 'src/server.js')], {
    env: {...process.env, PORT: '0'}, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {if (!child.killed) child.kill();});
  let printed = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Provider demo did not start')), 5000);
    child.stdout.on('data', buffer => {
      printed += buffer.toString();
      const match = /Listening on (\d+)/.exec(printed);
      if (match) {clearTimeout(timer); resolve(Number(match[1]));}
    });
    child.once('exit', code => {clearTimeout(timer); reject(new Error('Provider server exited ' + code));});
  });
  const url = 'http://127.0.0.1:' + port;
  const health = await fetch(url + '/health');
  assert.equal(health.status, 200);
  const create = await fetch(url + '/api/notes', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({title: 'from plugin provider'})
  });
  assert.equal(create.status, 201);
  const record = await create.json();
  assert.ok(record.id);
  assert.equal(record.title, 'from plugin provider');
  const list = await (await fetch(url + '/api/notes')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, record.id);
});

test('external generator lifecycle runs in order and preview stays read-only', t => {
  const {root, output} = fixture(t);
  const source = "'use strict'; let stage=0; module.exports={" +
    "apiVersion:1,id:'ext.generator',kind:'generator'," +
    "validate(){if(stage!==0)throw Error('validate order');stage=1;}," +
    "beforeGenerate(){if(stage!==1)throw Error('before order');stage=2;}," +
    "generate(){if(stage!==2)throw Error('generate order');stage=3;return {files:{'extensions/report.txt':'report'}};}," +
    "afterGenerate(ctx,result){if(stage!==3||!result.files['extensions/report.txt'])throw Error('after order');}" +
    "};";
  const mod = moduleAt(root, 'generator', source);
  const spec = baseSpec();
  spec.plugins = [declaration(mod, 'generator')];
  const before = planApplication(spec, output);
  assert.equal(fs.existsSync(output), false);
  assert.ok(before.actions.some(x => x.path === 'extensions/report.txt'));
  generateApplication(spec, output);
  assert.equal(fs.readFileSync(path.join(output, 'extensions/report.txt'), 'utf8'), 'report');
});

test('external middleware, authentication, storage and database adapters can replace owned runtime modules', t => {
  const {root, output} = fixture(t);
  const spec = baseSpec();
  spec.auth = {enabled: true, strategies: ['jwt'], jwt: {enabled: true}};
  spec.storage = {enabled: true, provider: 'local'};
  const extensions = [
    ['middleware', 'extensions/request-context.js', false],
    ['authentication', 'src/middleware/auth.js', true],
    ['storage', 'src/config/storage.js', true],
    ['database', 'src/config/database.js', true]
  ];
  spec.plugins = extensions.map(([kind, filename, override]) => {
    const files = {[filename]: '// external ' + kind + ' adapter\nmodule.exports = {};\n'};
    const mod = moduleAt(root, kind, buildModule(kind, {
      files, overrides: override ? [filename] : []
    }));
    return declaration(mod, kind, override ? {allowOverrides: [filename]} : {});
  });
  generateApplication(spec, output);
  for (const [kind, filename] of extensions) {
    assert.match(fs.readFileSync(path.join(output, filename), 'utf8'),
      new RegExp('external ' + kind + ' adapter'));
  }
  assert.ok(planApplication(spec, output).summary.unchanged > 0);
});

test('unapproved overrides fail closed and leave existing generator output untouched', t => {
  const {root, output} = fixture(t);
  const spec = baseSpec();
  generateApplication(spec, output);
  const databasePath = path.join(output, 'src/config/database.js');
  const before = fs.readFileSync(databasePath, 'utf8');
  const mod = moduleAt(root, 'override', buildModule('database', {
    files: {'src/config/database.js': 'replacement'}, overrides: ['src/config/database.js']
  }));
  spec.plugins = [declaration(mod, 'database')];
  assert.throws(() => generateApplication(spec, output), /undeclared file override/);
  assert.equal(fs.readFileSync(databasePath, 'utf8'), before);
});

test('plugin collisions, traversal, invalid versions and failing hooks never create output', t => {
  const {root, output} = fixture(t);
  const samples = [
    ['traversal', buildModule('generator', {files: {'../escaped.js': 'x'}}), /Unsafe plugin output path/],
    ['collision', buildModule('generator', {files: {'package.json': 'x'}}), /collision/],
    ['version', "module.exports={apiVersion:2,id:'bad',kind:'generator',generate(){return {files:{}}}};", /failed/],
    ['hook', "module.exports={apiVersion:1,id:'bad',kind:'generator',generate(){return {files:{'extensions/x':'x'}}},afterGenerate(){throw Error('blocked after hook')}};", /blocked after hook/]
  ];
  for (const [name, source, error] of samples) {
    const mod = moduleAt(root, name, source);
    const spec = baseSpec();
    spec.plugins = [declaration(mod, 'generator')];
    assert.throws(() => generateApplication(spec, output), error, name);
    assert.equal(fs.existsSync(output), false);
  }
});

test('worker has bounded environment and runaway plugin times out without changing files', t => {
  const {root, output} = fixture(t);
  const old = process.env.J2E_SECRET_TEST;
  process.env.J2E_SECRET_TEST = 'sensitive-test';
  t.after(() => {if (old === undefined) delete process.env.J2E_SECRET_TEST; else process.env.J2E_SECRET_TEST = old;});
  const envModule = moduleAt(root, 'env',
    "module.exports={apiVersion:1,id:'test.env',kind:'generator',generate(){" +
    "return {files:{'extensions/result.txt':String(process.env.J2E_SECRET_TEST||'not-passed')}}}};");
  const spec = baseSpec(); spec.plugins = [declaration(envModule, 'generator')];
  generateApplication(spec, output);
  assert.equal(fs.readFileSync(path.join(output, 'extensions/result.txt'), 'utf8'), 'not-passed');
  const hang = moduleAt(root, 'hang',
    "module.exports={apiVersion:1,id:'test.hang',kind:'generator',generate(){while(true){}}};");
  spec.plugins = [declaration(hang, 'generator')];
  assert.throws(() => generateApplication(spec, output), /Plugin process failed/);
  assert.equal(fs.readFileSync(path.join(output, 'extensions/result.txt'), 'utf8'), 'not-passed');
});

test('CLI resolves provider modules relative to their specification directory', t => {
  const {root, output} = fixture(t);
  const pluginRoot = path.resolve(__dirname, '../examples/plugins');
  const spec = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'flatfile-spec.json'), 'utf8'));
  const external = path.join(root, 'specs');
  fs.mkdirSync(external);
  fs.copyFileSync(path.join(pluginRoot, 'flatfile-provider.js'),
    path.join(external, 'flatfile-provider.js'));
  const specPath = path.join(external, 'application.json');
  fs.writeFileSync(specPath, JSON.stringify(spec));
  const cli = path.resolve(__dirname, '../bin/json-to-express.js');
  for (const args of [
    ['validate', specPath],
    ['plan', specPath, '--output', output],
    ['generate', specPath, '--output', output]
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args],
      {encoding: 'utf8', timeout: 15000});
    assert.equal(result.status, 0, result.stderr);
  }
  assert.ok(fs.existsSync(path.join(output, 'src/server.js')));
});
