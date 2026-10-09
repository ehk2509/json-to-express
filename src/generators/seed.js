'use strict';

module.exports = function seedSource(spec) {
  const entities = Object.fromEntries(spec.entities.map(entity => [entity.name, entity]));
  const batches = Object.entries(spec.seeds).map(([name, rows]) => {
    const fields = entities[name].fields.filter(field => field.type === 'date' || field.type === 'datetime').map(field => field.name);
    return {name, rows, dateFields: fields};
  });
  for (const [name, config] of Object.entries(spec.factories)) {
    const fields = entities[name].fields.filter(field => field.type === 'date' || field.type === 'datetime').map(field => field.name);
    batches.push({name, rows: Array.from({length: config.count}, (_, index) =>
      Object.fromEntries(Object.entries(config.template).map(([key, value]) =>
        [key, typeof value === 'string' ? value.replace(/\{\{index\}\}/g, String(index + 1)) : value]))), dateFields: fields});
  }
  const fixtures = Object.entries(spec.fixtures).map(([name, rows]) => ({
    name, rows,
    dependencies: [...new Set(rows.flatMap(row => Object.keys(row.data).map(key => {
      const field = entities[name].fields.find(item => item.name === key);
      return field && field.type === 'reference' ? field.ref : null;
    }).filter(Boolean)))],
    relations: Object.fromEntries(entities[name].fields.filter(field => field.type === 'reference').map(field => [field.name, field.ref])),
    dateFields: entities[name].fields.filter(field => field.type === 'date').map(field => field.name)
  }));
  return [
    "'use strict';",
    '',
    "require('dotenv').config();",
    "const {PrismaClient} = require('@prisma/client');",
    'const prisma = new PrismaClient();',
    'const batches = ' + JSON.stringify(batches, null, 2) + ';',
    'const fixtures = ' + JSON.stringify(fixtures, null, 2) + ';',
    '',
    'async function main() {',
    '  const remaining = new Map(fixtures.map(item => [item.name, item]));',
    '  const completed = new Set();',
    '  while (remaining.size) {',
    '    const next = [...remaining.values()].find(item => item.dependencies.every(dep => completed.has(dep)));',
    '    if (!next) throw new Error("Unresolvable fixture dependency order");',
    '    const model = prisma[next.name[0].toLowerCase() + next.name.slice(1)];',
    '    for (const fixture of next.rows) {',
    '      const data = {...fixture.data};',
    '      for (const [field, target] of Object.entries(next.relations)) {',
    '        if (data[field] === undefined) continue;',
    '        const lookup = data[field].where;',
    '        const targetModel = prisma[target[0].toLowerCase() + target.slice(1)];',
    '        const record = await targetModel.findUnique({where: lookup, select: {id: true}});',
    '        if (!record) throw new Error("Unresolved fixture reference " + next.name + "." + field);',
    '        data[field] = {connect: {id: record.id}};',
    '      }',
    '      for (const field of next.dateFields) if (data[field] != null) data[field] = new Date(data[field]);',
    '      await model.upsert({where: fixture.where, create: data, update: data});',
    '    }',
    '    completed.add(next.name); remaining.delete(next.name);',
    '  }',
    '  for (const batch of batches) {',
    '    const model = prisma[batch.name[0].toLowerCase() + batch.name.slice(1)];',
    '    if (!model) throw new Error("Unknown Prisma model: " + batch.name);',
    '    const rows = batch.rows.map(row => {',
    '      const value = {...row};',
    '      for (const field of batch.dateFields) {',
    '        if (value[field] != null) value[field] = new Date(value[field]);',
    '      }',
    '      return value;',
    '    });',
    '    if (!rows.length) continue;',
    '    const result = await model.createMany({data: rows, skipDuplicates: true});',
    '    console.log("Seeded " + result.count + " " + batch.name + " records");',
    '  }',
    '}',
    '',
    'main().catch(error => { console.error(error); process.exitCode = 1; })',
    '  .finally(() => prisma.$disconnect());',
    ''
  ].join('\n');
};
