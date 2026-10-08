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
        [key, typeof value === 'string' ? value.replace(/\\{\\{index\\}\\}/g, String(index + 1)) : value]))), dateFields: fields});
  }
  return [
    "'use strict';",
    '',
    "require('dotenv').config();",
    "const {PrismaClient} = require('@prisma/client');",
    'const prisma = new PrismaClient();',
    'const batches = ' + JSON.stringify(batches, null, 2) + ';',
    '',
    'async function main() {',
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
