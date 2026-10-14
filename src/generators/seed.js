'use strict';

module.exports = function seedSource(spec) {
  const entities = Object.fromEntries(spec.entities.map(entity => [entity.name, entity]));
  const batches = Object.entries(spec.seeds).map(([name, rows]) => ({
    name, rows, dateFields: entities[name].fields.filter(field => ['date', 'datetime'].includes(field.type)).map(field => field.name)
  }));
  const fixtures = Object.entries(spec.fixtures).map(([name, rows]) => ({
    name, rows: [...rows]
  }));
  const byName = new Map(fixtures.map(item => [item.name, item]));
  // Factory rows with a stable unique selector use the relational fixture runner.
  // Legacy scalar-only factories remain createMany/skipDuplicates compatible.
  for (const [name, factory] of Object.entries(spec.factories)) {
    const interpolate = (value, index) => {
      if (typeof value === 'string') return value.replace(/\{\{index\}\}/g, String(index + 1));
      if (Array.isArray(value)) return value.map(part => interpolate(part, index));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, interpolate(part, index)]));
      return value;
    };
    const rows = Array.from({length: factory.count}, (_, index) => interpolate(factory.template, index));
    if (factory.uniqueBy) {
      const existing = byName.get(name) || {name, rows: []};
      existing.rows.push(...rows.map(data => ({
        where: {[factory.uniqueBy]: data[factory.uniqueBy]},
        data, onConflict: factory.onConflict || 'update'
      })));
      if (!byName.has(name)) {fixtures.push(existing);byName.set(name, existing);}
    } else {
      const fields = entities[name].fields.filter(field => ['date', 'datetime'].includes(field.type)).map(field => field.name);
      batches.push({name, rows, dateFields: fields});
    }
  }
  const relationDefs = Object.fromEntries(spec.entities.map(entity => [entity.name, {
    delegate: entity.name.charAt(0).toLowerCase() + entity.name.slice(1),
    dates: entity.fields.filter(field => ['date', 'datetime'].includes(field.type)).map(field => field.name),
    relations: Object.fromEntries(entity.fields.filter(field => field.type === 'reference').map(field =>
      [field.name, {target: field.ref, many: Boolean(field.many), required: Boolean(field.required)}]))
  }]));
  return [
    "'use strict';", '',
    "require('dotenv').config();",
    "const {PrismaClient} = require('@prisma/client');",
    'const prisma = new PrismaClient();',
    'const batches = ' + JSON.stringify(batches, null, 2) + ';',
    'const fixtures = ' + JSON.stringify(fixtures, null, 2) + ';',
    'const entities = ' + JSON.stringify(relationDefs, null, 2) + ';',
    '',
    'function normalizeDates(name, data) {',
    '  const result={...data};',
    '  for(const field of entities[name].dates) if(result[field]!=null) result[field]=new Date(result[field]);',
    '  return result;',
    '}',
    'function getModel(tx,name){',
    '  const entry=entities[name];',
    '  if(!entry || !tx[entry.delegate]) throw new Error("Unknown Prisma fixture model: "+name);',
    '  return tx[entry.delegate];',
    '}',
    'async function connectByWhere(tx,source,field,selector) {',
    '  if(selector === null) return null;',
    '  const ref=entities[source].relations[field];',
    '  const lookup=selector && selector.where;',
    '  if(!ref || !lookup) throw new Error("Invalid fixture selector "+source+"."+field);',
    '  const record=await getModel(tx,ref.target).findUnique({where:lookup,select:{id:true}});',
    '  if(!record) throw new Error("Unresolved fixture reference "+source+"."+field+" "+JSON.stringify(lookup));',
    '  return {id:record.id};',
    '}',
    'async function main() {',
    '  await prisma.$transaction(async tx => {',
    '    const pending = new Map(fixtures.map(item => [item.name,item]));',
    '    const completed = new Set();',
    '    const deferred=[];',
    '    while(pending.size){',
    '      const next=[...pending.values()].find(item=>item.rows.every(row=>',
    '        Object.entries(row.data).every(([field,value])=>{',
    '          const ref=entities[item.name].relations[field];',
    '          return !ref || ref.many || !ref.required || completed.has(ref.target);',
    '        })));',
    '      if(!next) throw new Error("Unresolvable required fixture dependency order");',
    '      const model=getModel(tx,next.name);',
    '      for(const fixture of next.rows){',
    '        const data=normalizeDates(next.name,fixture.data);',
    '        // The unique selector is part of the create payload, even if omitted in data.',
    '        const create={...data,...fixture.where};',
    '        const deferredRelations={};',
    '        for(const [field,ref] of Object.entries(entities[next.name].relations)){',
    '          if(!Object.prototype.hasOwnProperty.call(data,field)) continue;',
    '          const value=data[field];',
    '          if(ref.many || !ref.required){',
    '            deferredRelations[field]=value;',
    '            delete data[field];delete create[field];',
    '          }else{',
    '            const connected=await connectByWhere(tx,next.name,field,value);',
    '            data[field]={connect:connected};create[field]={connect:connected};',
    '          }',
    '        }',
    '        const policy=fixture.onConflict || "update";',
    '        const existing=await model.findUnique({where:fixture.where,select:{id:true}});',
    '        if(existing && policy==="error") throw new Error("Fixture collision "+next.name+" "+JSON.stringify(fixture.where));',
    '        if(existing && policy==="skip") continue;',
    '        if(policy==="skip" || policy==="error"){',
    '          await model.create({data:create});',
    '        }else{',
    '          await model.upsert({where:fixture.where,create,update:data});',
    '        }',
    '        if(Object.keys(deferredRelations).length) deferred.push({name:next.name,where:fixture.where,relations:deferredRelations});',
    '      }',
    '      completed.add(next.name);pending.delete(next.name);',
    '    }',
    '    // Second pass connects optional, many-to-many and nullable self references.',
    '    // All unique selector records exist by the time this pass runs.',
    '    for(const entry of deferred){',
    '      const data={};',
    '      for(const [field,value] of Object.entries(entry.relations)){',
    '        const ref=entities[entry.name].relations[field];',
    '        if(ref.many){',
    '          data[field]={set:await Promise.all(value.map(item=>connectByWhere(tx,entry.name,field,item)))};',
    '        }else if(value===null){',
    '          data[field]={disconnect:true};',
    '        }else{',
    '          data[field]={connect:await connectByWhere(tx,entry.name,field,value)};',
    '        }',
    '      }',
    '      await getModel(tx,entry.name).update({where:entry.where,data});',
    '    }',
    '    for(const batch of batches){',
    '      const model=getModel(tx,batch.name);',
    '      const rows=batch.rows.map(row=>{',
    '        const value={...row};',
    '        for(const field of batch.dateFields) if(value[field]!=null)value[field]=new Date(value[field]);',
    '        return value;',
    '      });',
    '      if(!rows.length)continue;',
    '      const result=await model.createMany({data:rows,skipDuplicates:true});',
    '      console.log("Seeded "+result.count+" "+batch.name+" rows");',
    '    }',
    '  },{timeout:120000});',
    '}',
    "if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());",
    'module.exports={main};',''
  ].join('\n');
};
