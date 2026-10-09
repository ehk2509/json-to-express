'use strict';

const {filePaths, js, joinUrl, relativeRequire} = require('./utils');

// Native Fastify CRUD is deliberately enabled only for plain scalar entities.
// Advanced entities continue to use the compatibility router until feature parity.
function eligible(entity, spec) {
  return spec.app.framework === 'fastify' &&
    !spec.auth.enabled && !spec.cache.enabled && !spec.storage.enabled &&
    !entity.audit.enabled && !entity.softDelete.enabled &&
    !entity.fields.some(field => ['reference', 'file'].includes(field.type)) &&
    !Object.values(entity.operations).some(op => op.enabled &&
      (op.transaction || op.auth.required || op.populate.length || op.cache.enabled)) &&
    !Object.values(entity.hooks.before || {}).some(Boolean) &&
    !Object.values(entity.hooks.after || {}).some(Boolean);
}

module.exports = function nativeCrudSource(spec) {
  const nativePath = require('node:path').posix.join(spec.generation.paths.source, 'fastify-crud.js');
  const entities = spec.entities.filter(e => eligible(e, spec));
  const imports = entities.map((entity, index) =>
    'const model' + index + ' = ' +
    (spec.database.type === 'mongodb'
      ? 'require(' + js(relativeRequire(nativePath, filePaths(spec, entity.name).model)) + ')'
      : 'connectDatabase.client[' + js(entity.name[0].toLowerCase() + entity.name.slice(1)) + ']') + ';');
  const config = entities.map((entity, index) => ({
    modelIndex: index,
    name: entity.name,
    operations: entity.operations,
    idParam: entity.idParam,
    base: joinUrl(spec.app.apiPrefix, entity.route),
    fields: Object.fromEntries(entity.fields.map(field => [field.name, {
      type: field.type, required: field.required, enum: field.enum || null
    }]))
  }));
  return [
    "'use strict';",
    ...(spec.database.type === 'postgresql'
      ? ['const connectDatabase = require(' + js(relativeRequire(nativePath, filePaths(spec).database)) + ');']
      : []),
    ...imports,
    'const config = ' + js(config) + ';',
    'const models = [' + entities.map((unused, i) => 'model' + i).join(', ') + '];',
    'const postgres = ' + (spec.database.type === 'postgresql') + ';',
    'function validId(id) {',
    '  return postgres ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) : /^[0-9a-f]{24}$/i.test(id);',
    '}',
    'function validate(fields, body, partial) {',
    '  const errors = [];',
    '  if (!body || typeof body !== "object" || Array.isArray(body)) return ["Invalid JSON object"];',
    '  for (const [name, field] of Object.entries(fields)) {',
    '    const value = body[name];',
    '    if (!partial && field.required && (value === undefined || value === null)) errors.push(name + " is required");',
    '    if (value == null) continue;',
    '    if (field.type === "string" && typeof value !== "string") errors.push(name + " has an invalid value");',
    '    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) errors.push(name + " has an invalid value");',
    '    if (field.type === "boolean" && typeof value !== "boolean") errors.push(name + " has an invalid value");',
    '    if (field.type === "date" && Number.isNaN(Date.parse(value))) errors.push(name + " has an invalid value");',
    '    if (field.enum && !field.enum.includes(value)) errors.push(name + " has an invalid value");',
    '  }',
    '  return errors;',
    '}',
    'module.exports = function registerCrud(fastify) {',
    '  for (const entry of config) {',
    '    const model = models[entry.modelIndex];',
    '    for (const [action, op] of Object.entries(entry.operations)) {',
    '      if (!op.enabled) continue;',
    '      const fullPath = entry.base + (op.path === "/" ? "" : op.path);',
    '      const url = fullPath.replace(/:([A-Za-z0-9_]+)/g, ":$1");',
    '      fastify.route({method: op.method.toUpperCase(), url, handler: async (request, reply) => {',
    '        const id = request.params && request.params[entry.idParam];',
    '        if (["get", "update", "delete"].includes(action) && !validId(id)) return reply.code(400).send({error: "Invalid identifier"});',
    '        if (["create", "update"].includes(action) && op.validate) {',
    '          const errors = validate(entry.fields, request.body, action === "update");',
    '          if (errors.length) return reply.code(400).send({error: "Invalid request", details: errors});',
    '        }',
    '        if (action === "list") {',
    '          const rows = postgres ? await model.findMany() : await model.find({}).lean();',
    '          return reply.code(op.status).send(rows);',
    '        }',
    '        if (action === "get") {',
    '          const record = postgres ? await model.findUnique({where: {id}}) : await model.findById(id);',
    '          return record ? reply.code(op.status).send(record) : reply.code(op.notFoundStatus).send({error: "Not found"});',
    '        }',
    '        if (action === "create") {',
    '          const record = postgres ? await model.create({data: request.body}) : await model.create(request.body);',
    '          return reply.code(op.status).send(record);',
    '        }',
    '        if (action === "update") {',
    '          const existing = postgres ? await model.findUnique({where: {id}}) : await model.findById(id);',
    '          if (!existing) return reply.code(op.notFoundStatus).send({error: "Not found"});',
    '          const record = postgres ? await model.update({where: {id}, data: request.body}) : await model.findByIdAndUpdate(id, request.body, {new: true, runValidators: true});',
    '          return reply.code(op.status).send(record);',
    '        }',
    '        if (action === "delete") {',
    '          const record = postgres ? await model.findUnique({where: {id}}) : await model.findById(id);',
    '          if (!record) return reply.code(op.notFoundStatus).send({error: "Not found"});',
    '          if (postgres) await model.delete({where: {id}}); else await model.findByIdAndDelete(id);',
    '          return op.status === 204 ? reply.code(204).send() : reply.code(op.status).send(record);',
    '        }',
    '      }});',
    '    }',
    '  }',
    '};', ''
  ].join('\n');
};
module.exports.eligible = eligible;
