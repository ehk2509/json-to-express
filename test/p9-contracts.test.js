'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {assertBaseline,checkGenerationContract,hasKeys}
  =require('../scripts/p9-contract-check');
const {readManifest}=require('../src/manifest');

const contract=JSON.parse(fs.readFileSync(
  path.join(__dirname,'../ci/p9/contracts.json'),'utf8'));
const copy=() => JSON.parse(JSON.stringify(contract));

test('P9 frozen v1-spec/plugin/public entrypoint baseline remains supported',()=>{
  assert.equal(assertBaseline(contract),true);
  const generated=checkGenerationContract(contract);
  assert.ok(generated.outputFiles>5);
  assert.match(generated.schemaFingerprint,/^[a-f0-9]{64}$/);
});

test('P9 contract check rejects silent public API and plugin protocol changes',()=>{
  const spec=copy();
  spec.specVersion='2.0';
  assert.throws(()=>assertBaseline(spec),/Spec version must remain compatible/);
  const plugin=copy();
  plugin.pluginApiVersion=2;
  assert.throws(()=>assertBaseline(plugin),/Plugin API version changed/);
  const kind=copy();
  kind.pluginKinds.pop();
  assert.throws(()=>assertBaseline(kind),/Breaking change to plugin extension kinds/);
  const missing=copy();
  missing.publicExports.push('deletedPublicFunction');
  assert.throws(()=>assertBaseline(missing),/removed public property/);
  const option=copy();
  option.cliOptions.push('--removed-cli-option');
  assert.throws(()=>assertBaseline(option),/Public CLI option disappeared/);
});

test('P9 manifest backward reader accepts real v1 layout without pretending schema history exists',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'j2e-p9-v1-manifest-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'.j2e-manifest.json'),
    JSON.stringify({version:1,files:{}}));
  const old=readManifest(dir);
  assert.equal(old.version,1);
  assert.equal(old.schema,undefined);
  fs.writeFileSync(path.join(dir,'.j2e-manifest.json'),
    JSON.stringify({version:2,files:{}}));
  assert.throws(()=>readManifest(dir),/missing or invalid schema history/);
  const protectedContract=copy();
  assert.deepEqual(protectedContract.manifestReadVersions,[1,2]);
});

test('P9 public data shapes fail closed when old required keys disappear',()=>{
  assert.doesNotThrow(()=>hasKeys({outputDir:'test',files:[],extra:1},['outputDir','files'],'test'));
  assert.throws(()=>hasKeys({files:[]},['outputDir','files'],'test'),/removed public property outputDir/);
});

test('P9 compatibility cohort includes every frozen immutable predecessor',()=>{
  assert.deepEqual(contract.historicalUpgrades,
    ['0.2.0-beta.1','0.2.0-beta.2','0.2.0-beta.3']);
  const code=fs.readFileSync(path.join(__dirname,'../scripts/cross-release-upgrade.js'),'utf8');
  for (const version of contract.historicalUpgrades) {
    assert.ok(code.includes("'"+version+"'"),'Cross-release test missing '+version);
  }
});

test('P9 generated GraphQL dependencies are pinned to a resolvable stable minor',()=>{
  const {normalizeSpec}=require('../src');
  const input={specVersion:'1.0',app:{name:'graphql-p9'},
    database:{type:'mongodb'},
    api:{graphql:{enabled:true}},
    entities:{Note:{fields:{title:{type:'string',required:true}}}}};
  const graphql=normalizeSpec(input);
  assert.equal(graphql.app.package.dependencies['@graphql-tools/schema'],'10.0.27',
    'A floating ^10 range may resolve to a release requiring unavailable @graphql-tools/utils');
  assert.equal(graphql.app.package.dependencies.graphql,'^16.10.0');
  const without=normalizeSpec({...input,api:{graphql:{enabled:false}}});
  assert.equal(without.app.package.dependencies['@graphql-tools/schema'],undefined);
});
