'use strict';

const {filePaths, js, payload, relativeRequire} = require('./utils');
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

function selectionExpression(operation) {
  const populate = operation.populate || [];
  return [
    '    const selectParam = ' + js(operation.selectParam || (operation.query && operation.query.selectParam) || null) + ';',
    '    const selected = selectParam && req.query[selectParam] ? String(req.query[selectParam]).split(/[ ,]+/).filter(Boolean) : [];',
    '    const selection = selected.length ? {select: Object.fromEntries([...selected, "id", ...' + js(populate) + '].map(name => [name, true]))} : ' +
      (populate.length ? '{include: Object.fromEntries(' + js(populate) + '.map(name => [name, true]))}' : '{}') + ';'
  ];
}

function inputTransformLines(entity, mode) {
  const refs = entity.fields.filter(field => field.type === 'reference');
  const lines = ['    const data = {...req.body};'];
  for (const field of refs) {
    lines.push('    if (Object.prototype.hasOwnProperty.call(data, ' + js(field.name) + ')) {');
    lines.push('      const reference = data[' + js(field.name) + '];');
    lines.push(mode === 'create'
      ? '      if (reference === null) delete data[' + js(field.name) + ']; else data[' + js(field.name) + '] = {connect: {id: reference}};'
      : '      data[' + js(field.name) + '] = reference === null ? {disconnect: true} : {connect: {id: reference}};');
    lines.push('    }');
  }
  return lines;
}

function fieldTypes(entity) {
  return Object.fromEntries(entity.fields.map(field => [field.name, field.type]));
}

module.exports = function prismaControllerSource(entity, spec) {
  const paths = filePaths(spec, entity.name);
  const delegateName = lowerFirst(entity.name);
  const delegate = 'prisma.' + delegateName;
  const id = 'req.params[' + js(entity.idParam) + ']';
  const imports = [
    'const connectDatabase = require(' + js(relativeRequire(paths.controller, filePaths(spec).database)) + ');',
    'const prisma = connectDatabase.client;'
  ];
  if (entity.hooks) imports.push('const hooks = require(' + js(relativeRequire(paths.controller, entity.hooks.module)) + ');');
  const functions = [];
  const exports = [];

  const helper = [
    'const fieldTypes = ' + js(fieldTypes(entity)) + ';',
    'function coerce(field, value) {',
    '  const type = fieldTypes[field];',
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
      lines.push('      const targetField = fieldTypes[field] === "reference" ? field + "Id" : field;');
      lines.push('      if (req.query[field] !== undefined) where[targetField] = coerce(field, req.query[field]);');
      lines.push('      for (const operator of ' + js(q.operators) + ') {');
      lines.push('        if (operator === "eq") continue;');
      lines.push('        const key = field + "__" + operator;');
      lines.push('        if (req.query[key] === undefined) continue;');
      lines.push('        const raw = operator === "in" ? String(req.query[key]).split(",").map(item => coerce(field, item)) : coerce(field, req.query[key]);');
      lines.push('        where[targetField] = typeof where[targetField] === "object" && where[targetField] !== null ? where[targetField] : {};');
      lines.push('        where[targetField][operators[operator]] = raw;');
      lines.push('      }');
      lines.push('    }');
    }
    lines.push('    const options = {where};');
    if (q.sortParam) {
      lines.push('    if (req.query[' + js(q.sortParam) + ']) {');
      lines.push('      options.orderBy = String(req.query[' + js(q.sortParam) + ']).split(/[ ,]+/).filter(Boolean).map(field => field.startsWith("-") ? {[field.slice(1)]: "desc"} : {[field]: "asc"});');
      lines.push('    }');
    }
    if (q.pagination.enabled) {
      lines.push('    const requestedLimit = Number(req.query[' + js(q.pagination.limitParam) + ']);');
      lines.push('    const requestedPage = Number(req.query[' + js(q.pagination.pageParam) + ']);');
      lines.push('    const take = Math.min(Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : ' + q.pagination.defaultLimit + ', 1), ' + q.pagination.maxLimit + ');');
      lines.push('    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;');
      lines.push('    options.take = take; options.skip = (page - 1) * take;');
    }
    lines.push(...selectionExpression(list).map(line => line.replace(/^    /, '    ')));
    lines.push('    Object.assign(options, selection);');
    lines.push('    const items = await ' + delegate + '.findMany(options);');
    lines.push(...hookLines(entity,'after','list','items',delegate));
    lines.push('    res.status(' + list.status + ').json(items);','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('list');
  }

  const get = entity.operations.get;
  if (get.enabled) {
    const lines = ['async function get(req, res, next) {','  try {',...hookLines(entity,'before','get',null,delegate),'    const where = {id: ' + id + '};'];
    if (entity.softDelete.enabled) lines.push('    where[' + js(entity.softDelete.field) + '] = null;');
    lines.push(...selectionExpression(get));
    lines.push('    const item = await ' + delegate + '.findFirst({where, ...selection});');
    lines.push('    if (!item) return res.status(' + get.notFoundStatus + ').json(' + payload(entity.notFoundResponse) + ');');
    lines.push(...hookLines(entity,'after','get','item',delegate));
    lines.push('    res.status(' + get.status + ').json(item);','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('get');
  }

  const create = entity.operations.create;
  if (create.enabled) {
    const lines = ['async function create(req, res, next) {','  try {',...hookLines(entity,'before','create',null,delegate),...inputTransformLines(entity, 'create')];
    if (entity.audit.enabled) lines.push('    if (req.auth && req.auth.userId) { data[' + js(entity.audit.createdBy) + '] = req.auth.userId; data[' + js(entity.audit.updatedBy) + '] = req.auth.userId; }');
    lines.push(...selectionExpression(create));
    lines.push('    const item = await withTransaction(' + create.transaction + ', db => db.' + delegateName + '.create({data, ...selection}));');
    lines.push(...hookLines(entity,'after','create','item',delegate));
    lines.push('    res.status(' + create.status + ').json(item);','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('create');
  }

  const update = entity.operations.update;
  if (update.enabled) {
    const lines = ['async function update(req, res, next) {','  try {',...hookLines(entity,'before','update',null,delegate),...inputTransformLines(entity, 'update')];
    if (entity.audit.enabled) lines.push('    if (req.auth && req.auth.userId) data[' + js(entity.audit.updatedBy) + '] = req.auth.userId;');
    lines.push('    const lookup = {id: ' + id + '};');
    if (entity.softDelete.enabled) lines.push('    lookup[' + js(entity.softDelete.field) + '] = null;');
    lines.push('    const existing = await ' + delegate + '.findFirst({where: lookup});');
    lines.push('    if (!existing) return res.status(' + update.notFoundStatus + ').json(' + payload(entity.notFoundResponse) + ');');
    lines.push(...selectionExpression(update));
    lines.push('    const item = await withTransaction(' + update.transaction + ', db => db.' + delegateName + '.update({where: {id: ' + id + '}, data, ...selection}));');
    lines.push(...hookLines(entity,'after','update','item',delegate));
    lines.push('    res.status(' + update.status + ').json(item);','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('update');
  }

  const remove = entity.operations.delete;
  if (remove.enabled) {
    const lines = ['async function remove(req, res, next) {','  try {',...hookLines(entity,'before','delete',null,delegate),'    const lookup = {id: ' + id + '};'];
    if (entity.softDelete.enabled) lines.push('    lookup[' + js(entity.softDelete.field) + '] = null;');
    lines.push('    const existing = await ' + delegate + '.findFirst({where: lookup});');
    lines.push('    if (!existing) return res.status(' + remove.notFoundStatus + ').json(' + payload(entity.notFoundResponse) + ');');
    if (entity.softDelete.enabled) {
      lines.push('    const item = await withTransaction(' + remove.transaction + ', db => db.' + delegateName + '.update({where: {id: ' + id + '}, data: {' + js(entity.softDelete.field) + ': new Date()}}));');
    } else {
      lines.push('    const item = await withTransaction(' + remove.transaction + ', db => db.' + delegateName + '.delete({where: {id: ' + id + '}}));');
    }
    lines.push(...hookLines(entity,'after','delete','item',delegate));
    if (remove.status === 204) lines.push('    res.status(204).end();'); else lines.push('    res.status(' + remove.status + ').json(item);');
    lines.push('  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('remove');
  }

  return ["'use strict';",'',...imports,'',helper,'',functions.join('\n\n'),'','module.exports = {' + exports.join(', ') + '};',''].join('\n');
};
