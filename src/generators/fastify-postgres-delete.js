'use strict';

const {js} = require('./utils');

// Generate one transaction-scoped deletion planner shared by native Fastify routes.
// For hard deletion descendants are also removed physically, so no orphaned
// soft-deleted foreign keys can prevent the parent from being removed.
module.exports = function postgresDeleteSource(spec) {
  const entities = Object.fromEntries(spec.entities.map(entity => [entity.name, {
    softDelete: entity.softDelete,
    references: entity.fields.filter(field => field.type === 'reference').map(field => ({
      name:field.name, ref:field.ref, many: Boolean(field.many), onDelete:field.onDelete
    }))
  }]));
  const inbound = Object.fromEntries(spec.entities.map(target => [target.name,
    spec.entities.flatMap(source => source.fields.filter(field =>
      field.type === 'reference' && field.ref === target.name).map(field => ({
        model:source.name, field:field.name, many:Boolean(field.many), onDelete:field.onDelete
      })))
  ]));
  return [
    "'use strict';",
    'const entities = ' + js(entities) + ';',
    'const inbound = ' + js(inbound) + ';',
    'const delegateName = name => name[0].toLowerCase() + name.slice(1);',
    'function conflict(message) { const error = new Error(message); error.statusCode = 409; return error; }',
    'function missing() { const error = new Error("Not found"); error.code = "P2025"; return error; }',
    'async function remove(db, name, id, active, visited = new Set(), forceHard = !entities[name].softDelete.enabled) {',
    '  const meta = entities[name];',
    '  if (!meta) throw new Error("Unknown deletion entity: " + name);',
    '  const delegate = db[delegateName(name)];',
    '  const where = {id, ...(!forceHard && meta.softDelete.enabled ? {[meta.softDelete.field]: null} : {})};',
    '  const current = await delegate.findFirst({where});',
    '  if (!current) {if (active) throw missing(); return;}',
    '  const key = name + ":" + id;',
    '  if (visited.has(key)) throw conflict("Cyclic relationship cascade");',
    '  visited.add(key);',
    '  for (const relation of inbound[name] || []) {',
    '    const source = entities[relation.model];',
    '    const child = db[delegateName(relation.model)];',
    '    const condition = relation.many ? {[relation.field]: {some: {id}}} : {[relation.field + "Id"]: id};',
    '    if (!forceHard && source.softDelete.enabled) condition[source.softDelete.field] = null;',
    '    const related = await child.findMany({where: condition, select: {id: true}, orderBy: {id: "asc"}});',
    '    if (!related.length) continue;',
    '    if (relation.onDelete === "restrict") throw conflict("Delete restricted by " + relation.model + "." + relation.field);',
    '    if (relation.onDelete === "nullify") {',
    '      if (relation.many) {for (const item of related) await child.update({where: {id: item.id}, data: {[relation.field]: {disconnect: [{id}]}}});}',
    '      else await child.updateMany({where: condition, data: {[relation.field + "Id"]: null}});',
    '    } else if (relation.onDelete === "cascade") {',
    '      for (const item of related) await remove(db, relation.model, item.id, false, visited, forceHard);',
    '    } else throw conflict("Unsupported delete policy for " + relation.model + "." + relation.field);',
    '  }',
    '  if (meta.softDelete.enabled && !forceHard) {',
    '    await delegate.update({where: {id, [meta.softDelete.field]: null}, data: {[meta.softDelete.field]: new Date()}});',
    '  } else await delegate.delete({where: {id}});',
    '  visited.delete(key);',
    '}',
    'module.exports = async (db, name, id) => remove(db, name, id, true);',
    ''
  ].join('\n');
};
