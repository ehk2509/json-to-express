'use strict';

const {filePaths, js, payload, relativeRequire} = require('./utils');

function hookLines(entity, phase, operation, resultVariable) {
  const hookName = entity.hooks && entity.hooks[phase] && entity.hooks[phase][operation];
  if (!hookName) return [];
  const result = resultVariable ? ', result: ' + resultVariable : '';
  return [
    '    if (typeof hooks[' + js(hookName) + '] === "function") {',
    '      await hooks[' + js(hookName) + ']({req, res, model: ' + entity.name + result + '});',
    '      if (res.headersSent) return;',
    '    }'
  ];
}

function populateLines(operation) {
  if (!operation.populate || !operation.populate.length) return [];
  return ['    query = query.populate(' + js(operation.populate) + ');'];
}

function inboundRelations(entity, spec) {
  const relations = [];
  for (const source of spec.entities) {
    for (const field of source.fields) {
      if (field.type === 'reference' && field.ref === entity.name) relations.push({source, field});
    }
  }
  return relations;
}

function relationDeleteLines(entity, spec) {
  const lines = [];
  for (const relation of inboundRelations(entity, spec)) {
    const source = relation.source;
    const field = relation.field;
    const filterParts = [js(field.name) + ': targetId'];
    if (source.softDelete.enabled) filterParts.push(js(source.softDelete.field) + ': null');
    const filter = '{' + filterParts.join(', ') + '}';
    if (field.onDelete === 'restrict') {
      lines.push('      const dependent' + source.name + field.name + ' = await ' + source.name + '.countDocuments(' + filter + ').session(session || null);');
      lines.push('      if (dependent' + source.name + field.name + ' > 0) { const error = new Error("Delete restricted by ' + source.name + '.' + field.name + '"); error.statusCode = 409; throw error; }');
    } else if (field.onDelete === 'nullify') {
      const update = field.many ? '{$pull: {' + js(field.name) + ': targetId}}' : '{$set: {' + js(field.name) + ': null}}';
      lines.push('      await ' + source.name + '.updateMany(' + filter + ', ' + update + ').session(session || null);');
    } else if (field.onDelete === 'cascade') {
      lines.push('      await ' + source.name + '.deleteMany(' + filter + ').session(session || null);');
    }
  }
  return lines;
}

function controllerSource(entity, spec) {
  const id = 'req.params[' + js(entity.idParam) + ']';
  const hasFiles = entity.fields.some(field => field.type === 'file');
  const functions = [];
  const exports = [];
  const paths = filePaths(spec, entity.name);
  const imports = [
    "const mongoose = require('mongoose');",
    'const ' + entity.name + ' = require(' + js(relativeRequire(paths.controller, paths.model)) + ');'
  ];
  if (entity.hooks) imports.push('const hooks = require(' + js(relativeRequire(paths.controller, entity.hooks.module)) + ');');
  if (spec.cache.enabled) imports.push('const cache = require(' + js(relativeRequire(paths.controller, filePaths(spec).cache)) + ');');
  if (hasFiles) imports.push('const storage = require(' + js(relativeRequire(paths.controller, filePaths(spec).storage)) + ');');
  for (const relation of inboundRelations(entity, spec)) {
    if (!imports.some(line => line.startsWith('const ' + relation.source.name + ' ='))) {
      const sourcePath = filePaths(spec, relation.source.name).model;
      imports.push('const ' + relation.source.name + ' = require(' + js(relativeRequire(paths.controller, sourcePath)) + ');');
    }
  }

  const helper = [
    'async function withTransaction(enabled, work) {',
    '  if (!enabled) return work(null);',
    '  const session = await mongoose.startSession();',
    '  try {',
    '    let result;',
    '    await session.withTransaction(async () => { result = await work(session); });',
    '    return result;',
    '  } finally { await session.endSession(); }',
    '}'
  ].join('\n');

  const list = entity.operations.list;
  if (list.enabled) {
    const q=list.query;
    const lines=['async function list(req, res, next) {','  try {',...hookLines(entity,'before','list'),'    const filter = {};'];
    if(entity.softDelete.enabled) lines.push('    filter['+js(entity.softDelete.field)+'] = null;');
    if(q.filters.length){
      lines.push('    const mongoOperators = {eq: "$eq", ne: "$ne", gt: "$gt", gte: "$gte", lt: "$lt", lte: "$lte", in: "$in"};');
      lines.push('    for (const field of '+js(q.filters)+') {');
      lines.push('      if (req.query[field] !== undefined) filter[field] = req.query[field];');
      lines.push('      for (const operator of '+js(q.operators)+') {');
      lines.push('        if (operator === "eq") continue;');
      lines.push('        const key = field + "__" + operator;');
      lines.push('        if (req.query[key] === undefined) continue;');
      lines.push('        filter[field] = typeof filter[field] === "object" && filter[field] !== null ? filter[field] : {};');
      lines.push('        filter[field][mongoOperators[operator]] = operator === "in" ? String(req.query[key]).split(",") : req.query[key];');
      lines.push('      }');
      lines.push('    }');
    }
    lines.push('    let query = '+entity.name+'.find(filter);');
    if(q.sortParam) lines.push('    if (req.query['+js(q.sortParam)+']) query = query.sort(req.query['+js(q.sortParam)+']);');
    if(q.selectParam) lines.push('    if (req.query['+js(q.selectParam)+']) query = query.select(req.query['+js(q.selectParam)+']);');
    if(q.pagination.enabled){
      lines.push('    const requestedLimit = Number(req.query['+js(q.pagination.limitParam)+']);');
      lines.push('    const requestedPage = Number(req.query['+js(q.pagination.pageParam)+']);');
      lines.push('    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : '+q.pagination.defaultLimit+', 1), '+q.pagination.maxLimit+');');
      lines.push('    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;');
      lines.push('    query = query.skip((page - 1) * limit).limit(limit);');
    }
    lines.push(...populateLines(list));
    if(list.lean) lines.push('    query = query.lean();');
    lines.push('    const items = await query;');
    lines.push(...hookLines(entity,'after','list','items'));
    if (hasFiles) lines.push('    const responseItems = await storage.enrich(' + js(entity.name) + ', items, req);');
    lines.push('    res.status('+list.status+').json(' + (hasFiles ? 'responseItems' : 'items') + ');','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('list');
  }

  const get=entity.operations.get;
  if(get.enabled){
    const lines=['async function get(req, res, next) {','  try {',...hookLines(entity,'before','get'),
      '    const filter = {_id: '+id+'};'];
    if(entity.softDelete.enabled) lines.push('    filter['+js(entity.softDelete.field)+'] = null;');
    lines.push('    let query = '+entity.name+'.findOne(filter);');
    if(get.selectParam) lines.push('    if (req.query['+js(get.selectParam)+']) query = query.select(req.query['+js(get.selectParam)+']);');
    lines.push(...populateLines(get));
    if(get.lean) lines.push('    query = query.lean();');
    lines.push('    const item = await query;','    if (!item) return res.status('+get.notFoundStatus+').json('+payload(entity.notFoundResponse)+');',
      ...hookLines(entity,'after','get','item'),
      ...(hasFiles ? ['    const responseItem = await storage.enrich(' + js(entity.name) + ', item, req);'] : []),
      '    res.status('+get.status+').json(' + (hasFiles ? 'responseItem' : 'item') + ');','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('get');
  }

  const create=entity.operations.create;
  if(create.enabled){
    const lines=['async function create(req, res, next) {','  try {',...hookLines(entity,'before','create'),
      '    const input = {...req.body};'];
    if(entity.audit.enabled){
      lines.push('    if (req.auth && req.auth.userId) { input['+js(entity.audit.createdBy)+'] = req.auth.userId; input['+js(entity.audit.updatedBy)+'] = req.auth.userId; }');
    }
    lines.push('    let item = await withTransaction('+create.transaction+', async session => {',
      '      const created = await '+entity.name+'.create([input], session ? {session} : {});','      return created[0];','    });');
    if(create.populate.length) lines.push('    item = await item.populate('+js(create.populate)+');');
    if (hasFiles) lines.push('    storage.commitUploads(req);');
    lines.push(...hookLines(entity,'after','create','item'));
    if (hasFiles) lines.push('    const responseItem = await storage.enrich(' + js(entity.name) + ', item, req);');
    lines.push('    res.status('+create.status+').json(' + (hasFiles ? 'responseItem' : 'item') + ');','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('create');
  }

  const update=entity.operations.update;
  if(update.enabled){
    const lines=['async function update(req, res, next) {','  try {',...hookLines(entity,'before','update'),'    const input = {...req.body};'];
    if (hasFiles) {
      lines.push('    const existingUploadRecord = await ' + entity.name + '.findOne({_id: ' + id + '}).lean();');
    }
    if(entity.audit.enabled) lines.push('    if (req.auth && req.auth.userId) input['+js(entity.audit.updatedBy)+'] = req.auth.userId;');
    lines.push('    const outcome = await withTransaction('+update.transaction+', async session => {',
      '      const filter = {_id: '+id+'};');
    if(entity.softDelete.enabled) lines.push('      filter['+js(entity.softDelete.field)+'] = null;');
    if (hasFiles && update.transaction) lines.push('      const previous = await '+entity.name+'.findOne(filter).session(session);');
    lines.push('      let query = '+entity.name+'.findOneAndUpdate(filter, input, {new: true, runValidators: '+update.runValidators+'});',
      '      if (session) query = query.session(session);',
      '      const item = await query;');
    if (hasFiles && update.transaction) lines.push('      const intent = item ? await storage.enqueueCleanupIntent(storage.planReplaced('+js(entity.name)+', previous, req.body), session) : null;','      return {item,intent};');
    else lines.push('      return {item};');
    lines.push('    });','    let item = outcome.item;',
      '    if (!item) return res.status('+update.notFoundStatus+').json('+payload(entity.notFoundResponse)+');');
    if(update.populate.length) lines.push('    item = await item.populate('+js(update.populate)+');');
    if (hasFiles) {
      lines.push('    storage.commitUploads(req);');
      if (update.transaction) lines.push('    await storage.finishCleanupIntent(outcome.intent);');
      else lines.push('    await storage.cleanupReplaced(' + js(entity.name) + ', existingUploadRecord, input);');
    }
    lines.push(...hookLines(entity,'after','update','item'));
    if (hasFiles) lines.push('    const responseItem = await storage.enrich(' + js(entity.name) + ', item, req);');
    lines.push('    res.status('+update.status+').json(' + (hasFiles ? 'responseItem' : 'item') + ');','  } catch (error) { next(error); }','}');
    functions.push(lines.join('\n')); exports.push('update');
  }

  const remove=entity.operations.delete;
  if(remove.enabled){
    const lines=['async function remove(req, res, next) {','  try {',...hookLines(entity,'before','delete'),
      '    const targetId = '+id+';','    const outcome = await withTransaction('+remove.transaction+', async session => {',
      ...relationDeleteLines(entity,spec),'      const filter = {_id: targetId};'];
    if(entity.softDelete.enabled){
      lines.push('      filter['+js(entity.softDelete.field)+'] = null;',
        '      let query = '+entity.name+'.findOneAndUpdate(filter, {$set: {'+js(entity.softDelete.field)+': new Date()}}, {new: true});');
    } else {
      lines.push('      let query = '+entity.name+'.findOneAndDelete(filter);');
    }
    lines.push('      if (session) query = query.session(session);','      const item = await query;');
    if (hasFiles && remove.transaction) lines.push('      const intent = item ? await storage.enqueueCleanupIntent(storage.planEntity('+js(entity.name)+', item), session) : null;','      return {item,intent};');
    else lines.push('      return {item};');
    lines.push('    });',
      '    const item = outcome.item;',
      '    if (!item) return res.status('+remove.notFoundStatus+').json('+payload(entity.notFoundResponse)+');');
    if (hasFiles) {
      if (remove.transaction) lines.push('    await storage.finishCleanupIntent(outcome.intent);');
      else lines.push('    await storage.cleanupEntity(' + js(entity.name) + ', item);');
    }
    lines.push(...hookLines(entity,'after','delete','item'));
    if(remove.status===204) lines.push('    res.status(204).end();'); else {
      if (hasFiles) lines.push('    const responseItem = await storage.enrich(' + js(entity.name) + ', item, req);');
      lines.push('    res.status('+remove.status+').json(' + (hasFiles ? 'responseItem' : 'item') + ');');
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
  return ["'use strict';",'',...imports,'',helper,'',functions.join('\n\n'),'','module.exports = {'+exported.join(', ')+'};',''].join('\n');
}

module.exports = controllerSource;
