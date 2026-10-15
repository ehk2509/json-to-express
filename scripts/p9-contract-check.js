#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'ci/p9/contracts.json');
const api = require('../src');
const {MANIFEST_VERSION, readManifest} = require('../src/manifest');
const {validateDeclarations} = require('../src/plugins');

function hasKeys(actual, required, label) {
  assert.ok(actual && typeof actual === 'object', label + ' must be an object');
  for (const key of required) {
    assert.ok(Object.hasOwn(actual, key), label + ' removed public property ' + key);
  }
}
function sameArray(actual, expected, label) {
  assert.deepEqual(actual, expected, 'Breaking change to ' + label);
}
function assertBaseline(contract, {root = ROOT} = {}) {
  assert.equal(contract.schemaVersion, 1, 'Unknown contract baseline');
  assert.equal(contract.phase, 'pre-v1-stability');
  assert.equal(api.CURRENT_SPEC_VERSION, contract.specVersion, 'Spec version must remain compatible');
  assert.equal(api.PLUGIN_API_VERSION, contract.pluginApiVersion, 'Plugin API version changed');
  assert.equal(MANIFEST_VERSION, contract.manifestWriteVersion, 'Manifest write version changed');
  assert.ok(contract.manifestReadVersions.includes(1) &&
    contract.manifestReadVersions.includes(MANIFEST_VERSION), 'Old manifests must remain readable');
  sameArray([...api.PLUGIN_KINDS], contract.pluginKinds, 'plugin extension kinds');
  hasKeys(api, contract.publicExports, 'public entrypoint');
  for (const name of contract.publicFunctions) {
    assert.equal(typeof api[name], 'function', 'Lost public function ' + name);
  }
  assert.equal(typeof api.SpecificationError, 'function');
  assert.ok(Array.isArray(contract.pluginHooks) &&
    contract.pluginHooks.join(',') === 'validate,beforeGenerate,generate,afterGenerate');
  sameArray(contract.pluginContextKeys, ['spec','options','apiVersion','kind'],
    'plugin context protocol');
  sameArray(contract.pluginContributionKeys, ['files','overrides'],
    'plugin contribution protocol');
  sameArray(contract.supportedFrameworks, ['express', 'fastify'], 'framework support');
  sameArray(contract.supportedDatabases, ['mongodb', 'postgresql'], 'database support');
  const result = spawnSync(process.execPath, [path.join(root, 'bin/json-to-express.js'), '--help'],
    {encoding:'utf8', timeout:10000});
  assert.equal(result.status, 0, 'CLI --help stopped working');
  for (const verb of contract.cliCommands) {
    assert.ok(result.stdout.includes('  j2e ' + verb + ' '),
      'Public CLI command disappeared: ' + verb);
  }
  for (const flag of contract.cliOptions) {
    assert.ok(result.stdout.includes(flag), 'Public CLI option disappeared: ' + flag);
  }
  return true;
}
function checkGenerationContract(contract) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-p9-contract-'));
  try {
    const output = path.join(root, 'generated');
    const spec = {
      specVersion:contract.specVersion,
      app:{name:'p9-contract',framework:'express'},
      database:{type:'mongodb'},
      entities:{Note:{fields:{title:{type:'string',required:true}}}}
    };
    const plan = api.planApplication(spec, output);
    hasKeys(plan, contract.requiredPlanKeys, 'planApplication');
    assert.equal(plan.status, 'new');
    assert.ok(plan.actions.some(x => x.path === 'package.json' && x.status === 'add'));
    assert.equal(fs.existsSync(output), false, 'Planner must not write files');
    const result = api.generateApplication(spec, output);
    hasKeys(result, contract.requiredResultKeys, 'generateApplication');
    hasKeys(result.manifest, contract.requiredManifestKeys, 'generation manifest');
    assert.equal(result.manifest.version, contract.manifestWriteVersion);
    assert.equal(result.manifest.schema.version, 1);
    assert.equal(readManifest(output).version, contract.manifestWriteVersion);
    const unchanged = api.planApplication(spec, output);
    assert.equal(unchanged.blocking.modifiedFiles.length, 0);
    assert.equal(unchanged.blocking.schema.length, 0);
    assert.equal(unchanged.summary.unchanged, Object.keys(result.manifest.files).length);
    assert.ok(unchanged.schemaFingerprint && unchanged.schemaFingerprint.length === 64);
    // A developer-owned file survives regeneration.
    fs.writeFileSync(path.join(output, 'operator-owned.txt'), 'keep this');
    api.generateApplication(spec, output);
    assert.equal(fs.readFileSync(path.join(output, 'operator-owned.txt'), 'utf8'), 'keep this');
    // Missing specVersion remains accepted; wrong version must fail closed.
    assert.equal(api.upgradeSpec({app:{name:'x'}}).specVersion, contract.specVersion);
    assert.throws(() => api.upgradeSpec({specVersion:'999.0'}), /Unsupported specVersion/);
    // Plugin declaration shape remains externally usable.
    const declared=validateDeclarations([{module:'./trusted.cjs',kind:'generator',options:{flag:true}}]);
    assert.equal(declared.length, 1);
    assert.throws(() => validateDeclarations([{module:'./trusted.cjs',kind:'unsupported'}]), /Invalid/);
    return {schemaFingerprint:unchanged.schemaFingerprint, outputFiles:Object.keys(result.manifest.files).length};
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
}
function run() {
  const contract = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  assertBaseline(contract);
  const generation = checkGenerationContract(contract);
  const payload={milestone:'P9',phase:contract.phase,contract:contract.contractName,
    specVersion:contract.specVersion,pluginApiVersion:contract.pluginApiVersion,
    manifestWriteVersion:contract.manifestWriteVersion,checks:'passed',
    ...generation};
  process.stdout.write(JSON.stringify(payload,null,2)+'\n');
}
if (require.main === module) {
  try {run();}
  catch(error){console.error('P9 compatibility contract failed: '+error.message);process.exitCode=1;}
}
module.exports={assertBaseline,checkGenerationContract,hasKeys};
