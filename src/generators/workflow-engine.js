'use strict';

const {filePaths, js, relativeRequire} = require('./utils');
const {lowerFirst} = require('./prisma-schema');

function commonRuntime(spec) {
  return [
    'const workflows = ' + js(Object.fromEntries(spec.workflows.map(workflow => [workflow.name, workflow]))) + ';',
    'const jobs = ' + js(spec.jobs) + ';', '',
    'function readPath(root, parts) {',
    '  let value = root;',
    '  for (const part of parts) {',
    '    if (value === null || value === undefined) return undefined;',
    '    value = value[part];',
    '  }',
    '  return value;',
    '}', '',
    'function resolveString(value, context) {',
    '  if (!value.startsWith("$")) return value;',
    '  if (value.startsWith("$$")) return value.slice(1);',
    '  const parts = value.split(".");',
    '  const root = parts.shift();',
    '  if (root === "$body") return readPath(context.body, parts);',
    '  if (root === "$params") return readPath(context.params, parts);',
    '  if (root === "$query") return readPath(context.query, parts);',
    '  if (root === "$auth") return readPath(context.auth, parts);',
    '  if (root === "$steps") {',
    '    const step = parts.shift();',
    '    return readPath(context.steps[step], parts);',
    '  }',
    '  return undefined;',
    '}', '',
    'function resolve(value, context) {',
    '  if (typeof value === "string") return resolveString(value, context);',
    '  if (Array.isArray(value)) return value.map(item => resolve(item, context));',
    '  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, context)]));',
    '  return value;',
    '}', ''
  ];
}

function mongoSource(spec) {
  const enginePath = filePaths(spec).workflowEngine;
  const imports = spec.entities.map(entity =>
    'const ' + entity.name + ' = require(' + js(relativeRequire(enginePath, filePaths(spec, entity.name).model)) + ');'
  );
  const models = '{' + spec.entities.map(entity => entity.name).join(', ') + '}';

  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');",
    ...imports,
    'const eventBus = require(' + js(relativeRequire(enginePath, filePaths(spec).eventBus)) + ');',
    'const outbox = require(' + js(relativeRequire(enginePath, filePaths(spec).outbox)) + ');', '',
    ...commonRuntime(spec),
    'const models = ' + models + ';', '',
    'async function executeDatabaseStep(step, context, session) {',
    '  const model = models[step.entity];',
    '  if (step.action === "findById") {',
    '    let query = model.findById(resolve(step.id, context));',
    '    if (session) query = query.session(session);',
    '    return query;',
    '  }',
    '  if (step.action === "create") {',
    '    const items = await model.create([resolve(step.data, context)], session ? {session} : {});',
    '    return items[0];',
    '  }',
    '  if (step.action === "updateById") {',
    '    let query = model.findByIdAndUpdate(resolve(step.id, context), resolve(step.data, context), {new: true, runValidators: true});',
    '    if (session) query = query.session(session);',
    '    return query;',
    '  }',
    '  if (step.action === "deleteById") {',
    '    let query = model.findByIdAndDelete(resolve(step.id, context));',
    '    if (session) query = query.session(session);',
    '    return query;',
    '  }',
    '}', '',
    'async function persistPending(context, session) {',
    '  for (const event of context.pendingEvents) await eventBus.publish(event.name, event.payload, {session});',
    '  for (const job of context.pendingJobs) {',
    '    const config = jobs[job.name];',
    '    if (!config) throw new Error("Unknown job: " + job.name);',
    '    await outbox.enqueueJob(job.name, job.payload, {session, delayMs: job.delayMs, config});',
    '  }',
    '}', '',
    ...stepRunner(),
    'async function execute(name, req) {',
    '  const workflow = workflows[name];',
    "  if (!workflow) throw new Error('Unknown workflow: ' + name);",
    '  const context = makeContext(req);',
    '  let result;',
    '  if (workflow.transaction) {',
    '    const session = await mongoose.startSession();',
    '    try {',
    '      await session.withTransaction(async () => {',
    '        result = await runSteps(workflow, context, session);',
    '        await persistPending(context, session);',
    '      });',
    '    } finally { await session.endSession(); }',
    '  } else {',
    '    result = await runSteps(workflow, context, null);',
    '    await persistPending(context, null);',
    '  }',
    '  return {result, steps: context.steps};',
    '}', '',
    'module.exports = {execute, resolve};', ''
  ].join('\n');
}

function stepRunner() {
  return [
    'function makeContext(req) {',
    '  return {',
    '    body: req.body || {}, params: req.params || {}, query: req.query || {}, auth: req.auth || {},',
    '    job: req.job || {}, steps: {}, pendingEvents: [], pendingJobs: []',
    '  };',
    '}', '',
    'async function runSteps(workflow, context, transactionContext) {',
    '  let lastResult = null;',
    '  for (const step of workflow.steps) {',
    '    let result;',
    '    if (["findById", "create", "updateById", "deleteById"].includes(step.action)) {',
    '      result = await executeDatabaseStep(step, context, transactionContext);',
    '    } else if (step.action === "emit") {',
    '      result = resolve(step.payload, context);',
    '      context.pendingEvents.push({name: step.event, payload: result});',
    '    } else if (step.action === "enqueue") {',
    '      result = resolve(step.payload, context);',
    '      context.pendingJobs.push({name: step.job, payload: result, delayMs: step.delayMs || 0});',
    '    } else if (step.action === "respond") {',
    '      result = {__response: true, status: step.status, body: resolve(step.body, context)};',
    '    }',
    '    context.steps[step.name] = result;',
    '    lastResult = result;',
    '    if (result && result.__response) break;',
    '  }',
    '  return lastResult;',
    '}', ''
  ];
}

function postgresSource(spec) {
  const paths = filePaths(spec);
  const entityInfo = Object.fromEntries(spec.entities.map(entity => [
    entity.name,
    {
      delegate: lowerFirst(entity.name),
      references: Object.fromEntries(entity.fields.filter(field => field.type === 'reference').map(field => [
        field.name,
        {required: Boolean(field.required)}
      ]))
    }
  ]));

  return [
    "'use strict';", '',
    'const connectDatabase = require(' + js(relativeRequire(paths.workflowEngine, paths.database)) + ');',
    'const prisma = connectDatabase.client;',
    'const eventBus = require(' + js(relativeRequire(paths.workflowEngine, paths.eventBus)) + ');',
    'const outbox = require(' + js(relativeRequire(paths.workflowEngine, paths.outbox)) + ');', '',
    ...commonRuntime(spec),
    'const entities = ' + js(entityInfo) + ';', '',
    'function transformData(entityName, raw, mode) {',
    '  const data = {...raw};',
    '  const definition = entities[entityName];',
    '  if (!definition) throw new Error("Unknown entity: " + entityName);',
    '  for (const field of Object.keys(definition.references)) {',
    '    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;',
    '    const reference = data[field];',
    '    if (mode === "create") {',
    '      if (reference === null || reference === undefined || reference === "") delete data[field];',
    '      else data[field] = {connect: {id: reference}};',
    '    } else {',
    '      data[field] = reference === null ? {disconnect: true} : {connect: {id: reference}};',
    '    }',
    '  }',
    '  return data;',
    '}', '',
    'async function executeDatabaseStep(step, context, db) {',
    '  const definition = entities[step.entity];',
    '  if (!definition) throw new Error("Unknown entity: " + step.entity);',
    '  const model = db[definition.delegate];',
    '  const id = step.id === undefined ? undefined : resolve(step.id, context);',
    '  if (step.action === "findById") return model.findUnique({where: {id}});',
    '  if (step.action === "create") {',
    '    const data = transformData(step.entity, resolve(step.data, context), "create");',
    '    return model.create({data});',
    '  }',
    '  if (step.action === "updateById") {',
    '    const data = transformData(step.entity, resolve(step.data, context), "update");',
    '    return model.update({where: {id}, data});',
    '  }',
    '  if (step.action === "deleteById") return model.delete({where: {id}});',
    '}', '',
    'async function persistPending(context, db) {',
    '  for (const event of context.pendingEvents) await eventBus.publish(event.name, event.payload, {db});',
    '  for (const job of context.pendingJobs) {',
    '    const config = jobs[job.name];',
    '    if (!config) throw new Error("Unknown job: " + job.name);',
    '    await outbox.enqueueJob(job.name, job.payload, {db, delayMs: job.delayMs, config});',
    '  }',
    '}', '',
    ...stepRunner(),
    'async function execute(name, req) {',
    '  const workflow = workflows[name];',
    "  if (!workflow) throw new Error('Unknown workflow: ' + name);",
    '  const context = makeContext(req);',
    '  let result;',
    '  if (workflow.transaction) {',
    '    result = await prisma.$transaction(async tx => {',
    '      const value = await runSteps(workflow, context, tx);',
    '      await persistPending(context, tx);',
    '      return value;',
    '    });',
    '  } else {',
    '    result = await runSteps(workflow, context, prisma);',
    '    await persistPending(context, prisma);',
    '  }',
    '  return {result, steps: context.steps};',
    '}', '',
    'module.exports = {execute, resolve};', ''
  ].join('\n');
}

module.exports = function workflowEngineSource(spec) {
  return spec.database.type === 'postgresql' ? postgresSource(spec) : mongoSource(spec);
};
