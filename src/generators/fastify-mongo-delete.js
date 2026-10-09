'use strict';

const {js} = require('./utils');

// Source for recursive, session-bound native MongoDB referential deletions.
module.exports = function mongoDeleteSource(spec) {
  const entities = Object.fromEntries(spec.entities.map(entity => [entity.name, {
    softDelete: entity.softDelete
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
    'function conflict(message) {const error = new Error(message);error.statusCode=409;return error;}',
    'module.exports = async function mongoDelete(models, rootName, rootId, session) {',
    '  async function remove(name, id, active, seen, forceHard) {',
    '    const entry = entities[name];',
    '    const model = models[name];',
    '    if (!entry || !model) throw new Error("Unknown MongoDB delete model: " + name);',
    '    const where = {_id: id, ...(!forceHard && entry.softDelete.enabled ? {[entry.softDelete.field]: null} : {})};',
    '    const current = await model.findOne(where).session(session || null);',
    '    if (!current) {if (active) {const error = new Error("Not found");error.statusCode=404;throw error;} return;}',
    '    const key = name + ":" + String(id);',
    '    if (seen.has(key)) throw conflict("Cyclic relationship cascade");',
    '    seen.add(key);',
    '    for (const relation of inbound[name] || []) {',
    '      const child = models[relation.model];',
    '      const childEntry = entities[relation.model];',
    '      if (!child) throw new Error("Missing dependent MongoDB model: " + relation.model);',
    '      const filter = {[relation.field]: id};',
    '      if (!forceHard && childEntry.softDelete.enabled) filter[childEntry.softDelete.field] = null;',
    '      if (relation.onDelete === "restrict") {',
    '        if (await child.countDocuments(filter).session(session || null)) throw conflict("Delete restricted by " + relation.model + "." + relation.field);',
    '      } else if (relation.onDelete === "nullify") {',
    '        await child.updateMany(filter, relation.many ? {$pull: {[relation.field]: id}} : {$set: {[relation.field]: null}}, session ? {session} : {});',
    '      } else if (relation.onDelete === "cascade") {',
    '        const dependents = await child.find(filter).select("_id").session(session || null);',
    '        for (const dependent of dependents) await remove(relation.model, dependent._id, false, seen, forceHard);',
    '      } else throw conflict("Unsupported delete policy for " + relation.model + "." + relation.field);',
    '    }',
    '    if (entry.softDelete.enabled && !forceHard) {',
    '      await model.findOneAndUpdate(where, {$set: {[entry.softDelete.field]: new Date()}}, {new:true, ...(session ? {session} : {})});',
    '    } else await model.findOneAndDelete(where, session ? {session} : {});',
    '    seen.delete(key);',
    '  }',
    '  return remove(rootName, rootId, true, new Set(), !entities[rootName].softDelete.enabled);',
    '};',
    ''
  ].join('\n');
};
