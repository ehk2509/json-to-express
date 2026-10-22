'use strict';

const {filePaths, js, payload, queryFields, relativeRequire} = require('./utils');
const {lowerFirst} = require('./prisma-schema');

function hookLines(entity, phase, operation, resultVariable, delegate) {
  const hookName = entity.hooks && entity.hooks[phase] && entity.hooks[phase][operation];
  if (!hookName) return [];
  const result = resultVariable ? ', result: ' + resultVariable : '';
  return [
    '    if (typeof hooks[' + js(hookName) + '] === "function") {',
    '      await hooks[' + js(hookName) + ']({req, res, model: ' + delegate + result + '});',
    '      if (res.headersSent) return;',
    '    }'
  ];
}

function selectionExpression(operation, entity) {
  const populate = operation.populate || [];
  const refs = entity.fields.filter(field => field.type === 'reference');
  // Unpopulated to-many references are still returned, as identifier arrays (see present()).
  const idsOnly = refs.filter(field => field.many && !populate.includes(field.name)).map(field => field.name);
  const include = [...populate.map(name => '[' + js(name) + ', true]'), ...idsOnly.map(name => '[' + js(name) + ', {select: {id: true}}]')];
  const singles = refs.filter(field => !field.many && !populate.includes(field.name)).map(field => field.name);
  return [
    '    const selectParam = ' + js(operation.selectParam || (operation.query && operation.query.selectParam) || null) + ';',
    '    const selected = selectParam && req.query[selectParam] ? String(req.query[selectParam]).split(/[ ,]+/).filter(Boolean) : [];',
    '    if (selected.some(name => !queryFields.select.includes(name))) return res.status(400).json({error: "Invalid query parameter", details: [selectParam]});',
    '    const selection = selected.length ? {select: Object.fromEntries([...[...selected, "id"].map(name => ' + js(singles) + '.includes(name) ? [name + "Id", true] : [name, ' + js(idsOnly) + '.includes(name) ? {select: {id: true}} : true]), ...' + js(populate) + '.map(name => [name, true])])} : ' +
      (include.length ? '{include: Object.fromEntries([' + include.join(', ') + '])}' : '{}') + ';'
  ];
}

function inputTransformLines(entity, mode) {
  const refs = entity.fields.filter(field => field.type === 'reference');
  const lines = ['    const data = {...req.body};'];
  for (const field of refs) {
    lines.push('    if (Object.prototype.hasOwnProperty.call(data, ' + js(field.name) + ')) {');
    lines.push('      const reference = data[' + js(field.name) + '];');
    if (field.many) {
      const operation = mode === 'create' ? 'connect' : 'set';
      lines.push('      const references = Array.isArray(reference) ? reference : [];');
      lines.push('      data[' + js(field.name) + '] = {' + operation + ': references.map(id => ({id}))};');
    } else {
      lines.push(mode === 'create'
        ? '      if (reference === null) delete data[' + js(field.name) + ']; else data[' + js(field.name) + '] = {connect: {id: reference}};'
        : '      data[' + js(field.name) + '] = reference === null ? {disconnect: true} : {connect: {id: reference}};');
    }
    lines.push('    }');
  }
  return lines;
}

function fieldMeta(entity) {
  return Object.fromEntries(entity.fields.map(field => [field.name, {type: field.type, many: Boolean(field.many)}]));
}

module.exports = function prismaControllerSource(entity, spec) {
  const paths = filePaths(spec, entity.name);
  const hasFiles = entity.fields.some(field => field.type === 'file');
  const delegateName = lowerFirst(entity.name);
  const delegate = 'prisma.' + delegateName;
  const id = 'req.params[' + js(entity.idParam) + ']';
  const imports = [
    'const connectDatabase = require(' + js(relativeRequire(paths.controller, filePaths(spec).database)) + ');',
    'const prisma = connectDatabase.client;'
  ];
  if (entity.hooks) imports.push('const hooks = require(' + js(relativeRequire(paths.controller, entity.hooks.module)) + ');');
  if (spec.cache.enabled) imports.push('const cache = require(' + js(relativeRequire(paths.controller, filePaths(spec).cache)) + ');');
  if (hasFiles) imports.push('const storage = require(' + js(relativeRequire(paths.controller, filePaths(spec).storage)) + ');');
  if (entity.operations.delete.enabled) imports.push('const relationDelete = require(' + js(relativeRequire(paths.controller, filePaths(spec).relationDelete)) + ');');
  const functions = [];
  const exports = [];

  const referenceTargets = Object.fromEntries(entity.fields.filter(field => field.type === 'reference').map(field => {
    const target = spec.entities.find(item => item.name === field.ref);
    return [field.name, {delegate: lowerFirst(field.ref), many: Boolean(field.many), softDelete: target.softDelete.enabled ? target.softDelete.field : null}];
  }));
  const validationBase = payload(spec.app.responses.validationError);
  const referenceError = validationBase.endsWith('}') ? validationBase.slice(0, -1) + ', details: missing}' : validationBase;
  const referenceCheck = Object.keys(referenceTargets).length ? [
    '    const missing = await missingReferences(req.body || {});',
    '    if (missing.length) return res.status(' + spec.app.statusCodes.validationError + ').json(' + referenceError + ');'
  ] : [];
  const relationFields = Object.fromEntries(entity.fields.filter(field => field.type === 'reference').map(field => [field.name, Boolean(field.many)]));
  const helper = [
    'const fieldMeta = ' + js(fieldMeta(entity)) + ';',
    'const relationFields = ' + js(relationFields) + ';',
    '// Respond with declared reference names like MongoDB: <name>Id columns also appear as <name>, and',
    '// unpopulated to-many relations as identifier arrays. <name>Id stays for existing clients.',
    'function present(item, populated = []) {',
    '  if (!item) return item;',
    '  for (const [name, many] of Object.entries(relationFields)) {',
    '    if (many && Array.isArray(item[name]) && !populated.includes(name)) item[name] = item[name].map(entry => entry && typeof entry === "object" ? entry.id : entry);',
    '    else if (!many && item[name] === undefined && item[name + "Id"] !== undefined) item[name] = item[name + "Id"];',
    '  }',
    '  return item;',
    '}',
    'const relationIds = ' + js(Object.keys(relationFields).filter(name => relationFields[name]).length ? {include: Object.fromEntries(Object.keys(relationFields).filter(name => relationFields[name]).map(name => [name, {select: {id: true}}]))} : {}) + ';',
    ...(referenceCheck.length ? [
      'const referenceTargets = ' + js(referenceTargets) + ';',
      '// A missing connect target would surface as P2025 (404); soft-deleted targets would be accepted. Check first.',
      'async function missingReferences(body) {',
      '  const missing = [];',
      '  for (const [field, target] of Object.entries(referenceTargets)) {',
      '    if (body[field] === undefined || body[field] === null) continue;',
      '    const ids = [...new Set((target.many ? (Array.isArray(body[field]) ? body[field] : []) : [body[field]]).map(String))];',
      '    if (!ids.length) continue;',
      '    const where = {id: {in: ids}, ...(target.softDelete ? {[target.softDelete]: null} : {})};',
      '    if (await prisma[target.delegate].count({where}) !== ids.length) missing.push(field + " references a missing record");',
      '  }',
      '  return missing;',
      '}'
    ] : []),
    'const queryFields = ' + js({sort: queryFields(spec, entity, 'sort'), select: queryFields(spec, entity, 'select')}) + ';',
    'function coerce(field, value) {',
    '  const type = fieldMeta[field] && fieldMeta[field].type;',
    '  if (type === "number") return Number(value);',
    '  if (type === "boolean") return value === true || value === "true";',
    '  if (type === "date") return new Date(value);',
    '  return value;',
    '}', '',
    'async function withTransaction(enabled, work) {',
    '  if (!enabled) return work(prisma);',
    '  return prisma.$transaction(async tx => work(tx));',
    '}'
  ].join('\n');

  const list = entity.operations.list;
  if (list.enabled) {
    const q = list.query;
    const lines = ['async function list(req, res, next) {','  try {',...hookLines(entity,'before','list',null,delegate),'    const where = {};'];
    if (entity.softDelete.enabled) lines.push('    where[' + js(entity.softDelete.field) + '] = null;');
    if (q.filters.length) {
      lines.push('    const operators = {eq: "equals", ne: "not", gt: "gt", gte: "gte", lt: "lt", lte: "lte", in: "in"};');
      lines.push('    for (const field of ' + js(q.filters) + ') {');
      lines.push('      // Express parses field[op]=x into objects and repeated params into arrays; only scalars may reach Prisma.');
      lines.push('      for (const key of [field, ...' + js(q.operators) + '.map(operator => field + "__" + operator)]) if (req.query[key] !== null && typeof req.query[key] === "object") return res.status(400).json({error: "Invalid query parameter", details: [key]});');
      lines.push('      const meta = fieldMeta[field] || {};');
      lines.push('      const targetField = meta.type === "reference" && !meta.many ? field + "Id" : field;');
      lines.push('      if (req.query[field] !== undefined) {');
      lines.push('        const value = coerce(field, req.query[field]);');
      lines.push('        where[targetField] = meta.type === "reference" && meta.many ? {some: {id: value}} : value;');
      lines.push('      }');
      lines.push('      for (const operator of ' + js(q.operators) + ') {');
      lines.push('        if (operator === "eq") continue;');
      lines.push('        const key = field + "__" + operator;');
      lines.push('        if (req.query[key] === undefined) continue;');
      lines.push('        const raw = operator === "in" ? String(req.query[key]).split(",").map(item => coerce(field, item)) : coerce(field, req.query[key]);');
      lines.push('        if (meta.type === "reference" && meta.many) {');
      lines.push('          const relationFilter = {[operators[operator]]: raw};');
      lines.push('          where[field] = operator === "ne" ? {none: {id: {equals: raw}}} : {some: {id: relationFilter}};');
      lines.push('        } else {');
      lines.push('          where[targetField] = typeof where[targetField] === "object" && where[targetField] !== null ? where[targetField] : {};');
      lines.push('          where[targetField][operators[operator]] = raw;');
      lines.push('        }');
      lines.push('      }');
      lines.push('    }');
    }
    lines.push('    const options = {where};');
    if (q.sortParam) {
      lines.push('    if (req.query[' + js(q.sortParam) + ']) {');
      lines.push('      const sortFields = String(req.query[' + js(q.sortParam) + ']).split(/[ ,]+/).filter(Boolean);');
      lines.push('      if (sortFields.some(field => !queryFields.sort.includes(field.replace(/^-/, "")))) return res.status(400).json({error: "Invalid query parameter", details: [' + js(q.sortParam) + ']});');
      lines.push('      options.orderBy = sortFields.map(field => field.startsWith("-") ? {[field.slice(1)]: "desc"} : {[field]: "asc"});');
      lines.push('    }');
    }
    if (q.pagination.enabled) {
      lines.push('    const requestedLimit = Number(req.query[' + js(q.pagination.limitParam) + ']);');
      lines.push('    const requestedPage = Number(req.query[' + js(q.pagination.pageParam) + ']);');
      lines.push('    const take = Math.min(Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : ' + q.pagination.defaultLimit + ', 1), ' + q.pagination.maxLimit + ');');
      lines.push('    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;');
      lines.push('    options.take = take; options.skip = (page - 1) * take;');
    }
    lines.push(...selectionExpression(list, entity).map(line => line.replace(/^    /, '    ')));
    lines.push('    Object.assign(options, selection);');
    lines.push('    const items = (await ' + delegate + '.findMany(options)).map(item => present(item, ' + js(list.populate || []) + '));');
    lines.push(...hookLines(entity,'after','list','items',delegate));
    if (hasFiles) lines.push('    const responseItems = await storage.enrich(' + js(entity.name) + ', items, req);');
    lines.push('    res.status(' + list.status + ').json(' + (hasFiles ? 'responseItems' : 'items') + ');','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('list');
  }

  const get = entity.operations.get;
  if (get.enabled) {
    const lines = ['async function get(req, res, next) {','  try {',...hookLines(entity,'before','get',null,delegate),'    const where = {id: ' + id + '};'];
    if (entity.softDelete.enabled) lines.push('    where[' + js(entity.softDelete.field) + '] = null;');
    lines.push(...selectionExpression(get, entity));
    lines.push('    const item = present(await ' + delegate + '.findFirst({where, ...selection}), ' + js(get.populate || []) + ');');
    lines.push('    if (!item) return res.status(' + get.notFoundStatus + ').json(' + payload(entity.notFoundResponse) + ');');
    lines.push(...hookLines(entity,'after','get','item',delegate));
    if (hasFiles) lines.push('    const responseItem = await storage.enrich(' + js(entity.name) + ', item, req);');
    lines.push('    res.status(' + get.status + ').json(' + (hasFiles ? 'responseItem' : 'item') + ');','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('get');
  }

  const create = entity.operations.create;
  if (create.enabled) {
    const lines = ['async function create(req, res, next) {','  try {',...hookLines(entity,'before','create',null,delegate),...referenceCheck,...inputTransformLines(entity, 'create')];
    if (entity.audit.enabled) lines.push('    if (req.auth && req.auth.userId) { data[' + js(entity.audit.createdBy) + '] = req.auth.userId; data[' + js(entity.audit.updatedBy) + '] = req.auth.userId; }');
    lines.push(...selectionExpression(create, entity));
    lines.push('    const item = present(await withTransaction(' + create.transaction + ', db => db.' + delegateName + '.create({data, ...selection})), ' + js(create.populate || []) + ');');
    if (hasFiles) lines.push('    storage.commitUploads(req);');
    lines.push(...hookLines(entity,'after','create','item',delegate));
    if (hasFiles) lines.push('    const responseItem = await storage.enrich(' + js(entity.name) + ', item, req);');
    lines.push('    res.status(' + create.status + ').json(' + (hasFiles ? 'responseItem' : 'item') + ');','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('create');
  }

  const update = entity.operations.update;
  if (update.enabled) {
    const lines = ['async function update(req, res, next) {','  try {',...hookLines(entity,'before','update',null,delegate),...referenceCheck,...inputTransformLines(entity, 'update')];
    if (entity.audit.enabled) lines.push('    if (req.auth && req.auth.userId) data[' + js(entity.audit.updatedBy) + '] = req.auth.userId;');
    lines.push('    const lookup = {id: ' + id + '};');
    if (entity.softDelete.enabled) lines.push('    lookup[' + js(entity.softDelete.field) + '] = null;');
    lines.push('    const existing = await ' + delegate + '.findFirst({where: lookup});');
    lines.push('    if (!existing) return res.status(' + update.notFoundStatus + ').json(' + payload(entity.notFoundResponse) + ');');
    lines.push(...selectionExpression(update, entity));
    if (hasFiles) {
      lines.push('    const committed = await withTransaction(true, async db => {');
      lines.push('      const current = await db.' + delegateName + '.findFirst({where: lookup});');
      lines.push('      if (!current) {const error = new Error("Not found");error.statusCode = ' + update.notFoundStatus + ';throw error;}');
      lines.push('      const updated = await db.' + delegateName + '.update({where: {id: ' + id + '}, data, ...selection});');
      lines.push('      const intent = await storage.enqueueCleanupIntent(storage.planReplaced(' + js(entity.name) + ', current, req.body), db);');
      lines.push('      return {updated, intent};');
      lines.push('    });');
      lines.push('    const item = present(committed.updated, ' + js(update.populate || []) + ');');
      lines.push('    storage.commitUploads(req);');
      lines.push('    await storage.finishCleanupIntent(committed.intent);');
    } else {
      lines.push('    const item = present(await withTransaction(' + update.transaction + ', db => db.' + delegateName + '.update({where: {id: ' + id + '}, data, ...selection})), ' + js(update.populate || []) + ');');
    }
    lines.push(...hookLines(entity,'after','update','item',delegate));
    if (hasFiles) lines.push('    const responseItem = await storage.enrich(' + js(entity.name) + ', item, req);');
    lines.push('    res.status(' + update.status + ').json(' + (hasFiles ? 'responseItem' : 'item') + ');','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('update');
  }

  const remove = entity.operations.delete;
  if (remove.enabled) {
    const lines = ['async function remove(req, res, next) {','  try {',...hookLines(entity,'before','delete',null,delegate),'    const targetId = ' + id + ';'];
    // Delete policies run in the application through the whole graph (database cascades would skip
    // restrict checks on implicit many-to-many joins and do not fire on soft delete), so always transact.
    lines.push('    const outcome = await withTransaction(true, async db => {');
    lines.push('      const lookup = {id: targetId};');
    if (entity.softDelete.enabled) lines.push('      lookup[' + js(entity.softDelete.field) + '] = null;');
    lines.push('      let removed = await db.' + delegateName + '.findFirst({where: lookup, ...relationIds});');
    lines.push('      if (!removed) return null;');
    lines.push('      const affected = await relationDelete(db, ' + js(entity.name) + ', targetId);');
    if (entity.softDelete.enabled) lines.push('      removed = await db.' + delegateName + '.findUnique({where: {id: targetId}, ...relationIds});');
    if (hasFiles) {
      lines.push('      const intent = await storage.enqueueCleanupIntent(affected, db);');
      lines.push('      return {removed, intent};');
    } else lines.push('      return {removed};');
    lines.push('    });');
    lines.push('    const item = present(outcome && outcome.removed);');
    lines.push('    if (!item) return res.status(' + remove.notFoundStatus + ').json(' + payload(entity.notFoundResponse) + ');');
    if (hasFiles) lines.push('    await storage.finishCleanupIntent(outcome.intent);');
    lines.push(...hookLines(entity,'after','delete','item',delegate));
    if (remove.status === 204) lines.push('    res.status(204).end();'); else {
      if (hasFiles) lines.push('    const responseItem = await storage.enrich(' + js(entity.name) + ', item, req);');
      lines.push('    res.status(' + remove.status + ').json(' + (hasFiles ? 'responseItem' : 'item') + ');');
    }
    lines.push('  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('remove');
  }

  const exported = exports.map(name => {
    if (!spec.cache.enabled) return name;
    const operationName = name === 'remove' ? 'delete' : name;
    const operation = entity.operations[operationName];
    if (operationName === 'list' || operationName === 'get') {
      return name + ': cache.cacheController(' + js(entity.name) + ', ' + js(operationName) + ', ' + js(operation.cache) + ', ' + name + ')';
    }
    return name + ': cache.invalidateController(' + js(entity.name) + ', ' + name + ')';
  });
  return ["'use strict';",'',...imports,'',helper,'',functions.join('\n\n'),'','module.exports = {' + exported.join(', ') + '};',''].join('\n');
};
