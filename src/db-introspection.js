'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');
const {digest} = require('./migration-intelligence');
const {normalizeSpec} = require('./normalize-spec');

function localRequire(output) {
  const pkg = path.join(path.resolve(output), 'package.json');
  if (!fs.existsSync(pkg)) throw new Error('Generated application is missing: ' + pkg);
  return createRequire(pkg);
}
function localBinary(output, name) {
  const filename = path.join(path.resolve(output), 'node_modules', '.bin',
    process.platform === 'win32' ? name + '.cmd' : name);
  if (!fs.existsSync(filename)) throw new Error('Install generated dependencies first: ' + filename);
  return filename;
}
function run(binary, args, options = {}) {
  const child = spawnSync(binary, args, {encoding:'utf8', maxBuffer:16*1024*1024,
    windowsHide:true, timeout:120000, ...options});
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(binary + ' failed (' + child.status + '): ' +
    (child.stderr || child.stdout || '').slice(0,2000));
  return child.stdout;
}
function requireEnv(spec) {
  const key = spec.database.uriEnv;
  if (!process.env[key]) throw new Error('Missing database connection variable ' + key);
  return process.env[key];
}
function expectedPostgres(spec) {
  const tables = {};
  for (const entity of spec.entities) {
    const table = entity.collection || entity.name;
    const columns = {id:{type:'text',required:true}};
    for (const field of entity.fields) {
      if (field.type === 'reference') {
        if (!field.many) columns[field.name+'Id'] = {type:'text',required:Boolean(field.required)};
      } else {
        const type = {string:'text',number:'double precision',boolean:'boolean',
          date:'timestamp without time zone',file:'jsonb'}[field.type];
        columns[field.name] = {type, required:Boolean(field.required)};
      }
    }
    if (entity.schemaOptions.timestamps !== false) {
      columns.createdAt={type:'timestamp without time zone',required:true};
      columns.updatedAt={type:'timestamp without time zone',required:true};
    }
    if (entity.softDelete.enabled) columns[entity.softDelete.field]={type:'timestamp without time zone',required:false};
    if (entity.audit.enabled) {
      columns[entity.audit.createdBy]={type:'text',required:false};
      columns[entity.audit.updatedBy]={type:'text',required:false};
    }
    tables[table]=columns;
  }
  return {tables};
}
async function inspectPostgres(spec, output) {
  const Client = localRequire(output)('@prisma/client').PrismaClient;
  const prisma = new Client();
  try {
    await prisma.$connect();
    const [columns, constraints, indexes] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT table_name AS "table", column_name AS "column",
        data_type AS "type", (is_nullable = 'NO') AS required,
        column_default AS "default"
        FROM information_schema.columns WHERE table_schema = current_schema()
        ORDER BY table_name, ordinal_position`),
      prisma.$queryRawUnsafe(`SELECT c.relname AS "table", con.conname AS name,
        con.contype::text AS type, pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() ORDER BY c.relname, con.conname`),
      prisma.$queryRawUnsafe(`SELECT tablename AS "table", indexname AS name, indexdef AS definition
        FROM pg_indexes WHERE schemaname = current_schema()
        ORDER BY tablename, indexname`)
    ]);
    const tables = {};
    for (const row of columns) {
      if (row.table === '_prisma_migrations') continue;
      (tables[row.table] ||= {})[row.column] = {type:row.type,required:row.required};
    }
    const prismaPath = path.resolve(output, spec.database.prisma.schemaPath);
    const sql = run(localBinary(output,'prisma'),
      ['migrate','diff','--from-schema-datasource',prismaPath,
       '--to-schema-datamodel',prismaPath,'--script'], {cwd:output});
    return {engine:'postgresql', schema:{tables},
      metadata:{constraints, indexes}, sql, fingerprint:digest({tables,constraints,indexes})};
  } finally {await prisma.$disconnect();}
}
function mongoIndexSpec(fields, options = {}) {
  const keep=['unique','sparse','expireAfterSeconds','partialFilterExpression','collation'];
  const result={keys:fields,options:{}};
  for (const key of keep) {
    if ((key==='unique'||key==='sparse') && options[key]!==true) continue;
    if (options[key] !== undefined) result.options[key]=options[key];
  }
  return result;
}
function expectedMongo(spec, output) {
  const req=localRequire(output);
  const mongoose=req('mongoose');
  mongoose.set('autoIndex',false);
  mongoose.set('autoCreate',false);
  const collections={};
  for (const entity of spec.entities) {
    const file=path.join(path.resolve(output),spec.generation.paths.source,
      spec.generation.paths.models,entity.name+'.js');
    const model=req(file);
    const indexes=[];
    const seen=new Map();
    for(const [fields,options] of model.schema.indexes()) {
      const index=mongoIndexSpec(fields,options);
      const key=digest(index.keys);
      if(seen.has(key)) {
        if(digest(seen.get(key).options)!==digest(index.options))
          throw new Error('Conflicting MongoDB index declarations: '+model.collection.name);
        continue; // Mongoose often lists the same unique index twice.
      }
      seen.set(key,index);
      indexes.push(index);
    }
    collections[model.collection.name]={indexes,indexedFields:entity.fields.map(f=>f.name)};
  }
  return {collections};
}
async function inspectMongo(spec, output) {
  const mongoose=localRequire(output)('mongoose');
  mongoose.set('autoIndex',false);
  mongoose.set('autoCreate',false);
  await mongoose.connect(requireEnv(spec),{autoIndex:false,autoCreate:false});
  try {
    const collections={};
    const listed=await mongoose.connection.db.listCollections({}, {nameOnly:false}).toArray();
    for (const item of listed) {
      if (item.name.startsWith('system.') || item.name.startsWith('_j2e_migration_')) continue;
      const indexes=await mongoose.connection.db.collection(item.name).indexes();
      collections[item.name]={indexes:indexes.filter(x=>x.name!=='_id_').map(
        x=>mongoIndexSpec(x.key,x)),validator:item.options && item.options.validator || null};
    }
    return {engine:'mongodb',schema:{collections},fingerprint:digest({collections})};
  } finally {await mongoose.disconnect();}
}
function planMongo(expected, actual) {
  const steps=[];
  for(const [collection,target] of Object.entries(expected.collections).sort(([a],[b])=>a.localeCompare(b))) {
    const existing=actual.collections[collection];
    if (!existing) steps.push({action:'create-collection',collection,risk:'review',reverse:'drop-collection'});
    const current=existing ? existing.indexes : [];
    const plannedKeys=new Set();
    for (const index of target.indexes) {
      const indexHash=digest(index);
      if (plannedKeys.has(indexHash)) continue;
      plannedKeys.add(indexHash);
      if (!current.some(i=>digest(i)===indexHash)) {
        steps.push({action:'create-index',collection,index,risk:index.options.unique?'review':'low',
          reverse:'drop-index'});
      }
    }
    if (existing) {
      for (const index of current) if (!target.indexes.some(i=>digest(i)===digest(index))) {
        steps.push({action:'extra-index',collection,index,risk:'notice',
          description:'Existing index is preserved; review independently'});
      }
      if (existing.validator && Object.keys(existing.validator).length) {
        steps.push({action:'existing-validator',collection,risk:'notice',
          description:'Database validator is not managed by the generator'});
      }
    }
  }
  return steps;
}
module.exports={localRequire,localBinary,run,requireEnv,expectedPostgres,inspectPostgres,
  expectedMongo,inspectMongo,planMongo,mongoIndexSpec,normalizeSpec};
