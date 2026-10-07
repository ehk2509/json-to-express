'use strict';

const {js, payload} = require('./utils');

function enabled(entity, name) {
  return entity.operations[name] && entity.operations[name].enabled;
}

function listFunction(entity) {
  const op = entity.operations.list;
  const query = op.query;
  const lines = [
    'async function list(req, res, next) {',
    '  try {'
  ];

  if (query.filters.length) {
    lines.push('    const filter = {};');
    lines.push('    for (const field of ' + js(query.filters) + ') {');
    lines.push('      if (req.query[field] !== undefined) filter[field] = req.query[field];');
    lines.push('    }');
  } else {
    lines.push('    const filter = {};');
  }

  lines.push('    let query = ' + entity.name + '.find(filter);');

  if (query.sortParam) {
    lines.push('    if (req.query[' + js(query.sortParam) + ']) query = query.sort(req.query[' + js(query.sortParam) + ']);');
  }
  if (query.selectParam) {
    lines.push('    if (req.query[' + js(query.selectParam) + ']) query = query.select(req.query[' + js(query.selectParam) + ']);');
  }
  if (query.pagination.enabled) {
    lines.push('    const requestedLimit = Number(req.query[' + js(query.pagination.limitParam) + ']);');
    lines.push('    const requestedPage = Number(req.query[' + js(query.pagination.pageParam) + ']);');
    lines.push('    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : ' + query.pagination.defaultLimit + ', 1), ' + query.pagination.maxLimit + ');');
    lines.push('    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;');
    lines.push('    query = query.skip((page - 1) * limit).limit(limit);');
  }
  if (op.lean) lines.push('    query = query.lean();');

  lines.push('    const items = await query;');
  lines.push('    res.status(' + op.status + ').json(items);');
  lines.push('  } catch (error) { next(error); }');
  lines.push('}');
  return lines.join('\n');
}

function getFunction(entity) {
  const op = entity.operations.get;
  const id = 'req.params[' + js(entity.idParam) + ']';
  const lines = [
    'async function get(req, res, next) {',
    '  try {',
    '    let query = ' + entity.name + '.findById(' + id + ');'
  ];
  if (op.selectParam) {
    lines.push('    if (req.query[' + js(op.selectParam) + ']) query = query.select(req.query[' + js(op.selectParam) + ']);');
  }
  if (op.lean) lines.push('    query = query.lean();');
  lines.push('    const item = await query;');
  lines.push('    if (!item) return res.status(' + op.notFoundStatus + ').json(' + payload(entity.notFoundResponse) + ');');
  lines.push('    res.status(' + op.status + ').json(item);');
  lines.push('  } catch (error) { next(error); }');
  lines.push('}');
  return lines.join('\n');
}

function controllerSource(entity) {
  const id = 'req.params[' + js(entity.idParam) + ']';
  const functions = [];
  const exports = [];

  if (enabled(entity, 'list')) {
    functions.push(listFunction(entity));
    exports.push('list');
  }
  if (enabled(entity, 'get')) {
    functions.push(getFunction(entity));
    exports.push('get');
  }
  if (enabled(entity, 'create')) {
    const op = entity.operations.create;
    functions.push([
      'async function create(req, res, next) {',
      '  try {',
      '    const item = await ' + entity.name + '.create(req.body);',
      '    res.status(' + op.status + ').json(item);',
      '  } catch (error) { next(error); }',
      '}'
    ].join('\n'));
    exports.push('create');
  }
  if (enabled(entity, 'update')) {
    const op = entity.operations.update;
    functions.push([
      'async function update(req, res, next) {',
      '  try {',
      '    const item = await ' + entity.name + '.findByIdAndUpdate(' + id + ', req.body, {new: true, runValidators: ' + op.runValidators + '});',
      '    if (!item) return res.status(' + op.notFoundStatus + ').json(' + payload(entity.notFoundResponse) + ');',
      '    res.status(' + op.status + ').json(item);',
      '  } catch (error) { next(error); }',
      '}'
    ].join('\n'));
    exports.push('update');
  }
  if (enabled(entity, 'delete')) {
    const op = entity.operations.delete;
    const success = op.status === 204
      ? '    res.status(204).end();'
      : '    res.status(' + op.status + ').json(item);';
    functions.push([
      'async function remove(req, res, next) {',
      '  try {',
      '    const item = await ' + entity.name + '.findByIdAndDelete(' + id + ');',
      '    if (!item) return res.status(' + op.notFoundStatus + ').json(' + payload(entity.notFoundResponse) + ');',
      success,
      '  } catch (error) { next(error); }',
      '}'
    ].join('\n'));
    exports.push('remove');
  }

  return [
    "'use strict';", '',
    "const " + entity.name + " = require('../models/" + entity.name + "');", '',
    functions.join('\n\n'), '',
    'module.exports = {' + exports.join(', ') + '};', ''
  ].join('\n');
}

module.exports = controllerSource;
