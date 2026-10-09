'use strict';

const {filePaths, js, joinUrl, relativeRequire} = require('./utils');

// Native CRUD supports scalar entities; relationship reads are safe when mutation routes are disabled.
// Advanced mutations continue through the compatibility router until their invariants are implemented.
function safePrismaDelete(entity, spec) {
  return spec.database.type === 'postgresql' &&
    !spec.entities.some(source => source.fields.some(field =>
      field.type === 'reference' && field.ref === entity.name && field.many));
}

function eligible(entity, spec) {
  return spec.app.framework === 'fastify' && spec.api.rest &&
    !spec.cache.enabled &&
    !entity.audit.enabled && !entity.softDelete.enabled &&
    (!entity.fields.some(field => field.type === 'file') ||
      (spec.storage.enabled && !entity.operations.create.transaction && !entity.operations.update.transaction)) &&
    (!entity.fields.some(field => field.type === 'reference') ||
      ['create', 'update', 'delete'].every(name => !entity.operations[name].enabled) ||
      (spec.database.type === 'postgresql' &&
        (!entity.operations.delete.enabled || safePrismaDelete(entity, spec)) &&
        !entity.fields.some(field => field.type === 'reference' && field.many))) &&
    (!entity.operations.delete.enabled || spec.database.type !== 'postgresql' || safePrismaDelete(entity, spec)) &&
    !Object.values(entity.operations).some(op => op.enabled &&
      (op.transaction || op.cache.enabled || (op.populate.length && (!['list','get'].includes(Object.keys(entity.operations).find(key => entity.operations[key] === op)) || op.populate.some(name => !entity.fields.some(field => field.type === 'reference' && field.name === name)))))) &&
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
    references: entity.fields.filter(field => field.type === 'reference').map(field => ({name:field.name, many:field.many, required:field.required})),
    hasFiles: entity.fields.some(field => field.type === 'file'),
    base: joinUrl(spec.app.apiPrefix, entity.route),
    fields: Object.fromEntries(entity.fields.map(field => [field.name, {
      type: field.type, required: field.required, enum: field.enum || null
    }]))
  }));
  return [
    "'use strict';",
    ...(spec.auth.enabled ? ['const auth = require(' + js(relativeRequire(nativePath, filePaths(spec).auth)) + ');'] : []),
    ...(spec.storage.enabled ? ['const storage = require(' + js(relativeRequire(nativePath, filePaths(spec).storage)) + ');'] : []),
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
    'function writeData(entry, body, mode) {',
    '  const data = {...body};',
    '  for (const field of entry.references) {',
    '    if (!Object.prototype.hasOwnProperty.call(data, field.name)) continue;',
    '    const reference = data[field.name];',
    '    if (field.many) data[field.name] = { [mode === "create" ? "connect" : "set"]: (Array.isArray(reference) ? reference : []).map(id => ({id})) };',
    '    else if (reference === null) {if (mode === "create") delete data[field.name]; else data[field.name] = {disconnect: true};}',
    '    else data[field.name] = {connect: {id: reference}};',
    '  }',
    '  return data;',
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
    '        let storedUploads = [];',
    '        try {',
    '        if (entry.hasFiles && ["create", "update"].includes(action)) {',
    '          const parsed = await storage.parseFastifyMultipart(entry.name, request);',
    '          request.body = parsed.body;',
    '          storedUploads = parsed.stored;',
    '        }',
    '        if (["create", "update"].includes(action) && op.validate) {',
    '          const errors = validate(entry.fields, request.body, action === "update");',
    '          if (errors.length) {',
    '            if (storedUploads.length) await storage.cleanup(storedUploads).catch(() => {});',
    '            return reply.code(400).send({error: "Invalid request", details: errors});',
    '          }',
    '        }',
    '        if (action === "list") {',
    '          const q = op.query;',
    '          const populate = op.populate || [];',
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
    '            rows = await model.findMany({where: conditions, ...(limit ? {take: limit, skip} : {}), ...(orderBy.length ? {orderBy} : {}), ...(populate.length ? {include: Object.fromEntries(populate.map(name => [name, true]))} : {})});',
    '          } else {',
    '            let query = model.find(conditions);',
    '            if (sortFields.length) query = query.sort(sortFields.join(" "));',
    '            if (limit) query = query.skip(skip).limit(limit);',
    '            if (populate.length) query = query.populate(populate);',
    '            rows = await query.lean();',
    '          }',
    '          return reply.code(op.status).send(entry.hasFiles ? await storage.enrich(entry.name, rows, {protocol: request.protocol, get: name => request.headers[name.toLowerCase()]}) : rows);',
    '        }',
    '        if (action === "get") {',
    '          const populate = op.populate || [];',
    '          const record = postgres ? await model.findUnique({where: {id}, ...(populate.length ? {include: Object.fromEntries(populate.map(name => [name, true]))} : {})}) : await (populate.length ? model.findById(id).populate(populate) : model.findById(id));',
    '          return record ? reply.code(op.status).send(entry.hasFiles ? await storage.enrich(entry.name, record, {protocol: request.protocol, get: name => request.headers[name.toLowerCase()]}) : record) : reply.code(op.notFoundStatus).send({error: "Not found"});',
    '        }',
    '        if (action === "create") {',
    '          const record = postgres ? await model.create({data: writeData(entry, request.body, "create")}) : await model.create(request.body);',
    '          const responseRecord = entry.hasFiles ? await storage.enrich(entry.name, record, {protocol: request.protocol, get: name => request.headers[name.toLowerCase()]}) : record;',
    '          storedUploads = [];',
    '          return reply.code(op.status).send(responseRecord);',
    '        }',
    '        if (action === "update") {',
    '          const existing = postgres ? await model.findUnique({where: {id}}) : await model.findById(id);',
    '          if (!existing) return reply.code(op.notFoundStatus).send({error: "Not found"});',
    '          const record = postgres ? await model.update({where: {id}, data: writeData(entry, request.body, "update")}) : await model.findByIdAndUpdate(id, request.body, {new: true, runValidators: true});',
    '          if (entry.hasFiles) await storage.cleanupReplaced(entry.name, existing, request.body);',
    '          storedUploads = [];',
    '          return reply.code(op.status).send(entry.hasFiles ? await storage.enrich(entry.name, record, request.raw) : record);',
    '        }',
    '        if (action === "delete") {',
    '          const record = postgres ? await model.findUnique({where: {id}}) : await model.findById(id);',
    '          if (!record) return reply.code(op.notFoundStatus).send({error: "Not found"});',
    '          if (postgres) {',
    '            try {await model.delete({where: {id}});}',
    '            catch (error) {if (error.code === "P2003") return reply.code(409).send({error: "Delete restricted by related records"}); throw error;}',
    '          } else await model.findByIdAndDelete(id);',
    '          if (entry.hasFiles) await storage.cleanupEntity(entry.name, record);',
    '          return op.status === 204 ? reply.code(204).send() : reply.code(op.status).send(record);',
    '        }',
    '        } catch (error) {',
    '          if (storedUploads.length) await storage.cleanup(storedUploads).catch(() => {});',
    '          if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({error: error.message});',
    '          throw error;',
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
