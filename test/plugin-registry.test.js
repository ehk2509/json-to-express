'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const registry=require('../src/plugin-registry');
const pluginCli=require('../src/plugin-cli');
const {planApplication,generateApplication}=require('../src');

function workspace(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'j2e-market-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function starter(){
  return JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/plugin-starter/package.json')));
}
function spec(){return {app:{name:'market-demo',framework:'express'},database:{type:'mongodb'},
  entities:{Todo:{fields:{title:{type:'string',required:true}}}}};}
function npm(args,opts={}){
  const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{
    cwd:opts.cwd,encoding:'utf8',timeout:120000,maxBuffer:1048576,
    env:{...process.env,...(opts.env||{})}
  });
  assert.equal(result.status,0,result.stderr||String(result.error));
  return result.stdout;
}
function fixturePackage(t,root,{scripts}={}){
  const moduleDir=path.join(root,'published');
  fs.mkdirSync(moduleDir);
  const pkg={...starter(),private:false,...(scripts?{scripts}:{})};
  fs.writeFileSync(path.join(moduleDir,'package.json'),JSON.stringify(pkg));
  fs.copyFileSync(path.join(__dirname,'../examples/plugin-starter/index.js'),path.join(moduleDir,'index.js'));
  const content=JSON.parse(npm(['pack','--json','--pack-destination',root],{cwd:moduleDir}))[0];
  const tarball=path.join(root,content.filename);
  const metadata={...pkg,dist:{integrity:content.integrity}};
  const client=(args,options={})=>{
    if(args[0]==='view')return JSON.stringify(metadata);
    if(args[0]==='search')return JSON.stringify([{
      name:pkg.name,version:pkg.version,keywords:pkg.keywords,
      description:'Community test listing'
    },{name:'unrelated-claimed',version:'1.0.0',keywords:['unrelated']}]);
    if(args[0]==='install')return npm(['install','--prefix',args[args.indexOf('--prefix')+1],
      '--ignore-scripts','--no-audit','--no-fund','--save-exact',tarball],options);
    if(args[0]==='audit')return '0 vulnerabilities';
    throw Error('Unexpected mocked npm command: '+args[0]);
  };
  return {pkg,client,moduleDir,tarball,metadata};
}

test('exact registry versions and prerelease comparisons behave consistently',()=>{
  assert.deepEqual(registry.parseSpecifier('@scope/provider@1.0.0-beta.2'),
    {name:'@scope/provider',version:'1.0.0-beta.2',specifier:'@scope/provider@1.0.0-beta.2'});
  for(const input of ['evil@latest','https://example.test/p.tgz','foo@^1.0.0',
    'foo@1.2','../traversal@1.0.0'])assert.throws(()=>registry.parseSpecifier(input));
  assert.ok(registry.compareVersion('0.2.0-beta.2','0.2.0-beta.1')>0);
  assert.ok(registry.compareVersion('0.2.0','0.2.0-beta.999')>0);
  assert.ok(registry.compareVersion('0.3.0','0.2.9')>0);
});

test('compatibility manifest rejects wrong API, framework, database, Node or host version',()=>{
  const pkg=starter();
  const good=registry.validatePackage(pkg,{framework:'express',database:'mongodb',hostVersion:'0.2.0-beta.2'});
  assert.equal(good.id,'community.greeting');
  assert.throws(()=>registry.validatePackage(pkg,{framework:'hono'}),/Unsupported framework/);
  assert.throws(()=>registry.validatePackage(pkg,{database:'mysql'}),/Unsupported database/);
  assert.throws(()=>registry.validatePackage(pkg,{hostVersion:'1.0.0'}),/incompatible/);
  assert.throws(()=>registry.validatePackage({...pkg,j2ePlugin:{...pkg.j2ePlugin,apiVersion:2}}),/unsupported/);
  assert.throws(()=>registry.validatePackage({...pkg,j2ePlugin:{...pkg.j2ePlugin,nodeMajors:[999]}}),/Node/);
});

test('curated catalog lists only real bundled template and example files',()=>{
  const c=registry.catalog();
  assert.equal(c.schemaVersion,1);
  assert.deepEqual(c.templates.map(t=>t.id),['crud','saas','ecommerce']);
  assert.ok(c.plugins.every(p=>p.review==='reference-only'));
});

test('npm search results remain unverified and filter unrelated keyword matches',()=>{
  const c=(args)=>JSON.stringify([{name:'j2e-plugin-sample',version:'1.0.0',
    description:'sample',keywords:['json-to-express-plugin']},
    {name:'unverified',keywords:['something-else']}]);
  const found=registry.search('sample',{client:c});
  assert.equal(found.length,1);
  assert.equal(found[0].verified,false);
  assert.match(found[0].warning,/unverified/);
  assert.throws(()=>registry.search('hello; rm -rf',{client:c}),/Invalid/);
});

test('real local npm tarball install is pinned, ignores lifecycle scripts and activates existing plugin API',async t=>{
  const root=workspace(t);
  const {pkg,client}=fixturePackage(t,root,{scripts:{preinstall:
    'node -e "process.exit(17)"'}});
  const specPath=path.join(root,'app.j2e.json');
  fs.writeFileSync(specPath,JSON.stringify(spec()));
  const result=await registry.install(pkg.name+'@'+pkg.version,specPath,{yes:true,client});
  assert.equal(result.scriptsExecuted,false);
  assert.equal(result.installed,true);
  // Preinstall would fail with exit 17 if npm ignored the --ignore-scripts safety flag.
  const parsed=JSON.parse(fs.readFileSync(specPath));
  assert.deepEqual(parsed.plugins,[{module:pkg.name,kind:'generator'}]);
  assert.equal(registry.verifyInstalled(root,pkg.name,parsed).kind,'generator');
  const output=path.join(root,'generated');
  const plan=planApplication(parsed,output,{pluginRoot:root});
  assert.ok(plan.actions.some(x=>x.path==='extensions/greeting.txt'));
  generateApplication(parsed,output,{pluginRoot:root});
  assert.equal(fs.readFileSync(path.join(output,'extensions/greeting.txt'),'utf8'),
    'Welcome from market-demo\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(output,'.j2e-manifest.json'))).version,2);
  const cli=path.join(__dirname,'../bin/json-to-express.js');
  const verify=spawnSync(process.execPath,[cli,'plugin','verify','--spec',specPath,'--json'],
    {encoding:'utf8'});
  assert.equal(verify.status,0,verify.stderr);
  assert.equal(JSON.parse(verify.stdout)[0].status,'compatible');
  await assert.rejects(registry.install(pkg.name+'@'+pkg.version,specPath,{yes:true,client}),/already declared/);
});

test('disallowed untrusted scripts, metadata and declined consent never alter spec or create plugins',async t=>{
  const root=workspace(t),p=path.join(root,'app.j2e.json');
  fs.writeFileSync(p,JSON.stringify(spec()));
  const initial=fs.readFileSync(p,'utf8');
  const {pkg,client,metadata}=fixturePackage(t,root);
  await assert.rejects(registry.install(pkg.name+'@'+pkg.version,p,
    {client,confirm:async()=>false}),/cancelled/);
  assert.equal(fs.readFileSync(p,'utf8'),initial);
  assert.equal(fs.existsSync(registry.registryDirectory(root,pkg.name)),false);
  const malicious=(_args)=>JSON.stringify({...metadata,j2ePlugin:{...pkg.j2ePlugin,apiVersion:55}});
  await assert.rejects(registry.install(pkg.name+'@'+pkg.version,p,{yes:true,client:malicious}),/unsupported/);
  assert.equal(fs.readFileSync(p,'utf8'),initial);
  await assert.rejects(registry.install(pkg.name+'@latest',p,{yes:true,client}),/Exact semver/);
});

test('catalog/search/metadata CLI keep source distinctions and never execute plugins',async()=>{
  const c=await pluginCli.execute(['catalog']);
  assert.match(c,/Flatfile demo/);
  assert.match(c,/CRUD task/);
  const info=await pluginCli.execute(['info','j2e-plugin-example-greeting@1.0.0','--json'],
    {client:()=>JSON.stringify({...starter(),dist:{integrity:'sha512-test'}})});
  assert.equal(JSON.parse(info).verified,false);
  const matches=await pluginCli.execute(['search','greeting','--json'],{client:()=>JSON.stringify([{
    name:'j2e-plugin-test',keywords:['json-to-express-plugin'],version:'1.0.0'
  }])});
  assert.equal(JSON.parse(matches).length,1);
  assert.throws(()=>pluginCli.parse(['add','some-plugin@latest','--spec','foo','--unknown']),/Unknown/);
});
