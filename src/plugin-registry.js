'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {API_VERSION,KINDS,validateDeclarations}=require('./plugins');
const host=require('../package.json');
const SEMVER=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9.-]+))?$/;
const PACKAGE=/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
function parseVersion(v){
  const m=SEMVER.exec(v||'');if(!m)throw Error('Exact semver version required: '+v);
  return {numeric:m.slice(1,4).map(Number),pre:m[4]?m[4].split('.'):[]};
}
function compareVersion(a,b){
  const x=parseVersion(a),y=parseVersion(b);
  for(let i=0;i<3;i++)if(x.numeric[i]!==y.numeric[i])return Math.sign(x.numeric[i]-y.numeric[i]);
  if(!x.pre.length&&y.pre.length)return 1;
  if(x.pre.length&&!y.pre.length)return -1;
  for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){
    if(x.pre[i]===undefined)return -1;if(y.pre[i]===undefined)return 1;
    const numA=/^\d+$/.test(x.pre[i]),numB=/^\d+$/.test(y.pre[i]);
    if(numA&&numB){const v=Number(x.pre[i])-Number(y.pre[i]);if(v)return Math.sign(v);}
    else if(numA!==numB)return numA?-1:1;
    else if(x.pre[i]!==y.pre[i])return x.pre[i]<y.pre[i]?-1:1;
  }return 0;
}
function validateName(name){
  if(typeof name!=='string'||name.length>110||!PACKAGE.test(name)||name.includes('..'))throw Error('Invalid npm package name');
  return name;
}
function parseSpecifier(value){
  if(typeof value!=='string'||value.length>150)throw Error('Invalid npm package specifier');
  const i=value.lastIndexOf('@');
  if(i<=0)throw Error('Install requires exact package@version, not a moving npm tag');
  const name=validateName(value.slice(0,i)),version=value.slice(i+1);
  parseVersion(version);return {name,version,specifier:name+'@'+version};
}
function registryDirectory(root,name){
  validateName(name);
  return path.join(path.resolve(root),'.j2e','plugins',crypto.createHash('sha256').update(name).digest('hex').slice(0,24));
}
function localPackagePath(root,name){
  return path.join(registryDirectory(root,name),'node_modules',...name.split('/'),'package.json');
}
function npm(args,opts={}){
  const proc=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{
    encoding:'utf8',windowsHide:true,timeout:opts.timeout||30000,maxBuffer:2*1024*1024,
    cwd:opts.cwd,env:{...process.env,...(opts.env||{})}
  });
  if(proc.error||proc.status!==0)throw Error('npm command failed: '+String(proc.error?.message||proc.stderr||proc.stdout).slice(-900));
  return proc.stdout;
}
function json(output,context){try{return JSON.parse(output);}catch(_){throw Error('Invalid npm JSON: '+context);}}
function lookup(name,version,client=npm){
  validateName(name);if(version)parseVersion(version);
  const obj=json(client(['view',name+(version?'@'+version:''),'--json','--registry=https://registry.npmjs.org/','--fetch-retries=1']),name);
  if(!obj||Array.isArray(obj)||obj.name!==name||typeof obj.version!=='string'||version&&obj.version!==version)throw Error('Unexpected registry identity/version');
  return obj;
}
function validatePackage(pkg,opts={}){
  const meta=pkg?.j2ePlugin;
  if(!meta||meta.apiVersion!==API_VERSION||!KINDS.includes(meta.kind)||typeof meta.id!=='string'||
    !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(meta.id))throw Error('Invalid or unsupported Plugin API v1 manifest');
  if(typeof meta.hostMinVersion!=='string'||typeof meta.hostMaxExclusive!=='string'||
    compareVersion(opts.hostVersion||host.version,meta.hostMinVersion)<0||
    compareVersion(opts.hostVersion||host.version,meta.hostMaxExclusive)>=0)
    throw Error('Plugin incompatible with json-to-express@'+(opts.hostVersion||host.version));
  for(const field of ['frameworks','databases'])
    if(!Array.isArray(meta[field])||!meta[field].length||meta[field].some(x=>typeof x!=='string'||x.length>60))
      throw Error('Plugin missing '+field+' compatibility declaration');
  if(opts.framework&&!meta.frameworks.includes(opts.framework))throw Error('Unsupported framework '+opts.framework);
  if(opts.database&&!meta.databases.includes(opts.database))throw Error('Unsupported database '+opts.database);
  const nodeMajor=opts.nodeMajor||Number(process.versions.node.split('.')[0]);
  if(meta.nodeMajors!==undefined&&(!Array.isArray(meta.nodeMajors)||!meta.nodeMajors.includes(nodeMajor)))
    throw Error('Unsupported Node major '+nodeMajor);
  return {id:meta.id,kind:meta.kind,apiVersion:API_VERSION,compatible:true};
}
function publicInfo(pkg,opts={}){
  return {name:pkg.name,version:pkg.version,integrity:pkg.dist?.integrity||null,
    description:pkg.description||'',...validatePackage(pkg,opts),
    verified:false,warning:'npm compatibility metadata is self-declared; not a security endorsement'};
}
function catalog(){
  const root=path.resolve(__dirname,'..');
  const c=JSON.parse(fs.readFileSync(path.join(root,'registry/catalog.json')));
  if(c.schemaVersion!==1||!Array.isArray(c.plugins)||!Array.isArray(c.templates))throw Error('Invalid catalog');
  const seen=new Set();
  for(const item of [...c.plugins,...c.templates]){
    const file=item.module||item.file;
    if(!/^[a-z][a-z0-9._-]+$/.test(item.id||'')||seen.has(item.id)||typeof file!=='string'||
      !/^(examples|templates)\//.test(file)||file.includes('..')||path.isAbsolute(file)||
      !fs.existsSync(path.join(root,file)))throw Error('Invalid catalog item '+item.id);
    if(item.module&&item.review!=='reference-only')throw Error('Example must not claim security certification');
    seen.add(item.id);
  }return c;
}
function search(term='',{limit=20,client=npm}={}){
  if(typeof term!=='string'||term.length>80||!/^[\w .-]*$/.test(term))throw Error('Invalid search query');
  const results=json(client(['search','--json','--searchlimit='+Math.max(1,Math.min(50,limit)),
    'keywords:json-to-express-plugin',...(term?[term]:[])],{timeout:30000}),'npm search');
  if(!Array.isArray(results))throw Error('Unexpected npm search result');
  return results.filter(p=>p&&typeof p.name==='string'&&p.keywords?.includes('json-to-express-plugin'))
    .slice(0,limit).map(p=>({name:p.name,version:p.version,description:p.description||'',
      verified:false,source:'npm',warning:'unverified npm listing'}));
}
function verifyInstalled(root,name,spec){
  const filename=localPackagePath(root,name);
  if(!fs.existsSync(filename)||fs.lstatSync(filename).isSymbolicLink())throw Error('Managed plugin is not installed: '+name);
  const pkg=JSON.parse(fs.readFileSync(filename));
  if(pkg.name!==name)throw Error('Installed package identity mismatch');
  return {...publicInfo(pkg,{framework:spec?.app?.framework||'express',database:spec?.database?.type}),installed:true};
}
function atomicSpec(specFile,next,old){
  if(fs.lstatSync(specFile).isSymbolicLink())throw Error('Refusing symlinked spec');
  if(fs.readFileSync(specFile,'utf8')!==old)throw Error('Spec changed during install');
  const temp=specFile+'.j2e-'+process.pid;
  try{fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,specFile);}
  finally{if(fs.existsSync(temp))fs.rmSync(temp);}
}
async function install(specifier,specPath,{yes=false,confirm,input=process.stdin,output=process.stdout,client=npm}={}){
  const {name,version}=parseSpecifier(specifier);
  const file=path.resolve(specPath);
  if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())throw Error('Existing non-symlinked JSON spec is required');
  const old=fs.readFileSync(file,'utf8'),spec=JSON.parse(old);
  if(!spec?.app||!spec?.database||!spec?.entities||(spec.plugins||[]).some(p=>p.module===name))
    throw Error('Invalid spec or plugin is already declared');
  const pkg=lookup(name,version,client);
  const info=publicInfo(pkg,{framework:spec.app.framework||'express',database:spec.database.type});
  if(!/^sha512-[A-Za-z0-9+/=]+$/.test(pkg.dist?.integrity||''))throw Error('Missing registry SHA512 integrity');
  if(!yes){
    const prompt='Install npm package '+name+'@'+version+' ['+info.kind+']? Type install to accept untrusted code: ';
    let accepted=false;
    if(confirm)accepted=await confirm(prompt);
    else{
      if(!input.isTTY||!output.isTTY)throw Error('Interactive consent required; use --yes for automation');
      const rl=require('node:readline/promises').createInterface({input,output});
      try{accepted=(await rl.question(prompt)).trim()==='install';}finally{rl.close();}
    }
    if(!accepted)throw Error('Installation cancelled without installing package');
  }
  const root=path.dirname(file),destination=registryDirectory(root,name);
  if(fs.existsSync(destination))throw Error('Plugin already installed: refusing overwrite');
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  const stage=fs.mkdtempSync(path.join(path.dirname(destination),'.stage-'));
  let moved=false;
  try{
    fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:'j2e-plugin-host',version:'0.0.0',private:true}));
    client(['install','--prefix',stage,'--ignore-scripts','--no-audit','--no-fund',
      '--save-exact','--registry=https://registry.npmjs.org/',name+'@'+version],
      {timeout:120000,env:{npm_config_ignore_scripts:'true'}});
    client(['audit','--prefix',stage,'--omit=dev','--audit-level=high',
      '--registry=https://registry.npmjs.org/'],{timeout:60000});
    const installed=JSON.parse(fs.readFileSync(path.join(stage,'node_modules',...name.split('/'),'package.json')));
    if(installed.name!==name||installed.version!==version)throw Error('Installed package identity/version mismatch');
    validatePackage(installed,{framework:spec.app.framework||'express',database:spec.database.type});
    const lock=JSON.parse(fs.readFileSync(path.join(stage,'package-lock.json')));
    if(lock.packages?.['node_modules/'+name]?.integrity!==pkg.dist.integrity)throw Error('npm integrity mismatch');
    const next={...spec,plugins:[...(spec.plugins||[]),{module:name,kind:info.kind}]};
    validateDeclarations(next.plugins);
    if(fs.readFileSync(file,'utf8')!==old)throw Error('Spec changed during download');
    fs.renameSync(stage,destination);moved=true;
    try{atomicSpec(file,next,old);}catch(e){fs.rmSync(destination,{recursive:true,force:true});throw e;}
    return {...info,installed:true,updatedSpec:file,lifecycleScripts:false};
  }finally{if(!moved)fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={parseVersion,compareVersion,validateName,parseSpecifier,registryDirectory,
  localPackagePath,lookup,validatePackage,publicInfo,catalog,search,verifyInstalled,install};
