'use strict';

const {filePaths, js, joinUrl, relativeRequire} = require('./utils');

// Native Fastify CRUD is deliberately enabled only for plain scalar entities.
// Advanced entities continue to use the compatibility router until feature parity.
function eligible(entity, spec) {
  return spec.app.framework === 'fastify' && spec.api.rest &&
    !spec.cache.enabled && !spec.storage.enabled &&
    !entity.audit.enabled && !entity.softDelete.enabled &&
    !entity.fields.some(field => ['reference', 'file'].includes(field.type)) &&
    !Object.values(entity.operations).some(op => op.enabled &&
      (op.transaction || op.populate.length || op.cache.enabled)) &&
    !Object.values((entity.hooks && entity.hooks.before) || {}).some(Boolean) &&
    !Object.values((entity.hooks && entity.hooks.after) || {}).some(Boolean);
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
    ...(spec.auth.enabled ? ['const auth = require(' + js(relativeRequire(nativePath, filePaths(spec).auth)) + ');'] : []),
    ...(spec.database.type === 'postgresql'
      ? ['const connectDatabase = require(' + js(relativeRequire(nativePath, filePaths(spec).database)) + ');']
      : []),
    ...imports,
    'const config = ' + js(config) + ';',
    'const models = [' + entities.map((unused, i) => 'model' + i).join(', ') + '];',
    'const postgres = ' + (spec.database.type === 'postgresql') + ';',
    'const authEnabled = ' + Boolean(spec.auth.enabled) + ';',
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
    '      const url = fullPath;',
    '      fastify.route({method: op.method.toUpperCase(), url, handler: async (request, reply) => {',
    '        if (authEnabled && op.auth && op.auth.required) {',
    '          try { request.raw.auth = await auth.readAuth(request.raw, op.auth); }',
    '          catch (error) { return reply.code(error.statusCode || 401).send({error: error.message}); }',
    '        }',
    '        const id = request.params && request.params[entry.idParam];',
    '        if (["get", "update", "delete"].includes(action) && !validId(id)) return reply.code(400).send({error: "Invalid identifier"});',
    '        if (["create", "update"].includes(action) && op.validate) {',
    '          const errors = validate(entry.fields, request.body, action === "update");',
    '          if (errors.length) return reply.code(400).send({error: "Invalid request", details: errors});',
    '        }',
    '        if (action === "list") {',
    '          const q = op.query;',
    '          const conditions = {};',
    '          for (const field of q.filters || []) {',
    '            if (request.query[field] !== undefined) conditions[field] = request.query[field];',
    '          }',
    '          const p = q.pagination;',
    '          const limit = p.enabled ? Math.min(p.maxLimit, Math.max(1, Number(request.query[p.limitParam]) || p.defaultLimit)) : undefined;',
    '          const page = p.enabled ? Math.max(1, Number(request.query[p.pageParam]) || 1) : 1;',
    '          const sortValue = q.sortParam && request.query[q.sortParam];',
    '          const sortFields = sortValue ? String(sortValue).split(/[ ,]+/).filter(Boolean) : [];',
    '          const orderBy = sortFields.map(field => ({[field.replace(/^-/, "")]: field.startsWith("-") ? "desc" : "asc"}));',
    '          const skip = limit ? (page - 1) * limit : undefined;',
    '          let rows;',
    '          if (postgres) {',
    '            rows = await model.findMany({where: conditions, ...(limit ? {take: limit, skip} : {}), ...(orderBy.length ? {orderBy} : {})});',
    '          } else {',
    '            let query = model.find(conditions);',
    '            if (sortFields.length) query = query.sort(sortFields.join(" "));',
    '            if (limit) query = query.skip(skip).limit(limit);',
    '            rows = await query.lean();',
    '          }',
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
    '};',
    'module.exports.matches = function matches(method, url) {',
    '  const pathname = String(url).split("?")[0];',
    '  for (const entry of config) for (const op of Object.values(entry.operations)) {',
    '    if (!op.enabled || op.method.toUpperCase() !== String(method).toUpperCase()) continue;',
    '    const pattern = entry.base + (op.path === "/" ? "" : op.path);',
    '    const expected = pattern.split("/").filter(Boolean);',
    '    const actual = pathname.split("/").filter(Boolean);',
    '    if (expected.length === actual.length && expected.every((part, i) => part.startsWith(":") ? actual[i].length > 0 : part === actual[i])) return true;',
    '  }',
    '  return false;',
    '};', ''
  ].join('\n');
};
module.exports.eligible = eligible;
