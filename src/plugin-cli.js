'use strict';
const fs=require('node:fs');
const path=require('node:path');
const market=require('./plugin-registry');

function parse(args){
  const [action,...parts]=args;
  if(!['catalog','search','info','add','install','list','verify'].includes(action))
    throw Error('Usage: j2e plugin catalog|search|info|add|list|verify (run --help)');
  const opts={action,json:false,yes:false,spec:null,term:null};
  for(let i=0;i<parts.length;i++){
    const v=parts[i];
    if(v==='--json'||v==='--yes'){const key=v.slice(2);if(opts[key])throw Error('Duplicate '+v);opts[key]=true;}
    else if(v==='--spec'){
      if(opts.spec||!parts[i+1]||parts[i+1].startsWith('--'))throw Error('--spec needs a JSON spec file');
      opts.spec=path.resolve(parts[++i]);
    }else if(!v.startsWith('-')&&!opts.term)opts.term=v;
    else throw Error('Unknown plugin option '+v);
  }
  if(['add','install','verify','list'].includes(action)&&!opts.spec)throw Error('plugin '+action+' requires --spec <app.j2e.json>');
  if(['add','install','info'].includes(action)&&!opts.term)throw Error('plugin '+action+' requires a package name');
  if(['list','verify','catalog'].includes(action)&&opts.term)throw Error('Unexpected positional argument');
  return opts;
}
function readSpec(filename){
  if(!filename||!fs.existsSync(filename))throw Error('Missing spec file: '+filename);
  return JSON.parse(fs.readFileSync(filename,'utf8'));
}
async function execute(args,io={}){
  const opts=parse(args);
  const root=opts.spec&&path.dirname(opts.spec);
  let data;
  if(opts.action==='catalog')data=market.catalog();
  else if(opts.action==='search')data=market.search(opts.term||'',{client:io.client});
  else if(opts.action==='info'){
    const at=opts.term.lastIndexOf('@');
    const entry=at>0?market.parseSpecifier(opts.term):{name:market.validateName(opts.term),version:undefined};
    data=market.publicInfo(market.lookup(entry.name,entry.version,io.client));
  }else if(opts.action==='add'||opts.action==='install'){
    data=await market.install(opts.term,opts.spec,{yes:opts.yes,
      confirm:io.confirm,input:io.input,output:io.output,client:io.client});
  }else{
    const spec=readSpec(opts.spec);
    const plugins=spec.plugins||[];
    data=plugins.map(p=>{
      if(p.module.startsWith('.')||path.isAbsolute(p.module))
        return {module:p.module,kind:p.kind,source:'local',status:'local-unverified',
          exists:fs.existsSync(path.resolve(root,p.module))};
      try{
        const installed=market.verifyInstalled(root,p.module,spec);
        if(installed.kind!==p.kind)throw Error('Declared kind differs from package metadata');
        return {module:p.module,kind:p.kind,status:'compatible',version:installed.version,
          note:'Metadata compatibility only; plugin code has not been executed'};
      }catch(e){return {module:p.module,kind:p.kind,status:'incompatible',error:e.message};}
    });
    if(opts.action==='verify'&&data.some(p=>p.status==='incompatible'||p.exists===false))
      process.exitCode=1;
  }
  if(opts.json)return JSON.stringify(data,null,2);
  if(Array.isArray(data))return data.length?
    data.map(p=>[p.name||p.module||p.id,p.version||p.kind||'',p.status||p.source||'',p.description||p.error||''].filter(Boolean).join('  ')).join('\n')
    :'No entries found.';
  if(opts.action==='catalog'){
    return 'Curated examples (not security-certified):\n'+
      data.plugins.map(p=>p.id+'  '+p.title+'  '+p.review).join('\n')+
      '\nBundled templates:\n'+data.templates.map(t=>t.id+'  '+t.title).join('\n');
  }
  return JSON.stringify(data,null,2);
}
module.exports={parse,execute};
