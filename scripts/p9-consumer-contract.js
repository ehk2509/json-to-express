#!/usr/bin/env node
'use strict';

// A published-layout consumer test: npm pack -> separate npm installation ->
// generation through the installed CLI and entrypoint, with no repo imports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
function run(cmd,args,cwd=ROOT) {
  const result=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:240000,
    maxBuffer:4*1024*1024,windowsHide:true});
  if (result.error || result.status!==0) {
    throw new Error('P9 consumer command failed: '+path.basename(cmd)+' '+
      args.filter(x=>!x.startsWith('/')).slice(0,3).join(' ')+
      ' (exit '+result.status+'): '+String(result.stderr||result.error?.message||'').slice(-1500));
  }
  return result.stdout;
}
function verifyCase({item,installed,cli,packageDir,root}) {
  const relativeSpec=item.specFile || path.posix.join('templates',item.starter+'.json');
  assert.ok(/^(?:templates|examples\/consumers)\/[a-z0-9-]+\.json$/.test(relativeSpec),
    'Consumer fixture path must be a packaged JSON example');
  const spec=JSON.parse(fs.readFileSync(path.join(packageDir,relativeSpec),'utf8'));
  spec.app.name='p9-'+item.id;
  spec.app.framework=item.framework;
  spec.database.type=item.database;
  // Tests only generate sources. Never connect or migrate a database here.
  const folder=path.join(root,item.id);
  const specFile=path.join(root,item.id+'.json');
  fs.writeFileSync(specFile,JSON.stringify(spec,null,2));
  run(process.execPath,[cli,'validate',specFile],root);
  const plan=installed.planApplication(spec,folder);
  assert.equal(plan.status,'new');
  assert.equal(fs.existsSync(folder),false,'Preview must be read-only');
  const created=installed.generateApplication(spec,folder);
  assert.equal(created.manifest.version,2);
  assert.equal(created.spec.app.framework,item.framework);
  assert.equal(created.spec.database.type,item.database);
  for(const name of item.expectedFiles) {
    assert.ok(created.files.includes(name),'Missing artifact '+name+' for '+item.id);
    assert.ok(fs.existsSync(path.join(folder,name)),name+' absent in consumer workspace');
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'.j2e-manifest.json'),'utf8'));
  assert.equal(manifest.version,2);
  const pkg=JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8'));
  assert.equal(pkg.name,spec.app.name);
  assert.equal(pkg.engines.node,item.framework==='fastify'?'>=20':'>=18');
  const fromCli=JSON.parse(run(process.execPath,[cli,'plan',specFile,
    '--output',folder,'--json'],root));
  assert.equal(fromCli.blocking.modifiedFiles.length,0);
  assert.equal(fromCli.blocking.schema.length,0);
  assert.equal(fromCli.status,'tracked');
  // Generation remains idempotent and keeps separately owned source files.
  fs.writeFileSync(path.join(folder,'customer-notes.txt'),'operator owned');
  installed.generateApplication(spec,folder);
  assert.equal(fs.readFileSync(path.join(folder,'customer-notes.txt'),'utf8'),'operator owned');
  const after=installed.planApplication(spec,folder);
  assert.equal(after.actions.filter(x=>x.status!=='unchanged').length,0);
  return {id:item.id,framework:item.framework,database:item.database,
    status:'pass',generatedFiles:Object.keys(manifest.files).length};
}
function testPlugin(installed,cli,packageDir,root) {
  const dir=path.join(packageDir,'examples/plugins');
  const specPath=path.join(dir,'flatfile-spec.json');
  const spec=JSON.parse(fs.readFileSync(specPath,'utf8'));
  const output=path.join(root,'external-provider');
  run(process.execPath,[cli,'validate',specPath],root);
  const plan=installed.planApplication(spec,output,{pluginRoot:dir});
  assert.equal(plan.status,'new');
  assert.equal(fs.existsSync(output),false);
  const result=installed.generateApplication(spec,output,{pluginRoot:dir});
  assert.ok(result.files.includes('src/server.js'));
  assert.ok(result.files.includes('package.json'));
  assert.equal(result.manifest.schema.database,'flatfile');
  return {id:'bundled-custom-database-provider',status:'pass',pluginApiVersion:installed.PLUGIN_API_VERSION};
}
function main() {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'j2e-p9-consumer-'));
  try {
    const pkg=JSON.parse(run('npm',['pack','--json','--pack-destination',temp]))[0];
    assert.equal(pkg.name,'json-to-express');
    assert.ok(pkg.integrity,'npm tarball integrity required');
    const consumer=path.join(temp,'outside-repository');
    fs.mkdirSync(consumer);
    run('npm',['install','--ignore-scripts','--no-audit','--no-fund',
      '--prefix',consumer,path.join(temp,pkg.filename)]);
    const packageDir=path.join(consumer,'node_modules/json-to-express');
    const installed=require(packageDir);
    const cli=path.join(packageDir,'bin/json-to-express.js');
    const matrix=JSON.parse(fs.readFileSync(path.join(ROOT,'ci/p9/consumer-matrix.json'),'utf8'));
    assert.equal(matrix.schemaVersion,1);
    assert.equal(matrix.cases.length,6);
    const combos=new Set();
    const ids=new Set();
    const results=[];
    for(const item of matrix.cases) {
      assert.ok(!ids.has(item.id),'Duplicate consumer case id');
      ids.add(item.id);
      combos.add(item.framework+'/'+item.database);
      results.push(verifyCase({item,installed,cli,packageDir,root:temp}));
    }
    assert.equal(combos.size,4,'Four framework/database combinations must be covered');
    results.push(testPlugin(installed,cli,packageDir,temp));
    const report={
      schemaVersion:1,milestone:'P9',kind:'packaged-consumer-contract',
      independentlyOperated:false,
      version:pkg.version,tarballIntegrity:pkg.integrity,
      commit:process.env.GITHUB_SHA||null,
      node:process.version,results
    };
    if(process.env.P9_CONSUMER_REPORT) {
      const output=path.resolve(process.env.P9_CONSUMER_REPORT);
      fs.mkdirSync(path.dirname(output),{recursive:true});
      fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    }
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  } finally {
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
if(require.main===module) {
  try {main();}
  catch(error){console.error('P9 consumer contract failed:',error.message);process.exitCode=1;}
}
module.exports={verifyCase};
