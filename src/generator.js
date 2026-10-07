'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {normalizeSpec} = require('./normalize-spec');

const TYPE_MAP = {string: 'String', number: 'Number', boolean: 'Boolean', date: 'Date'};

function js(value) {
  return JSON.stringify(value);
}

function joinUrl(...parts) {
  const joined = parts
    .filter(part => part !== undefined && part !== null && part !== '')
    .map((part, index) => {
      const value = String(part);
      if (index === 0) return value.replace(/\/$/, '');
      return value.replace(/^\//, '').replace(/\/$/, '');
    })
    .filter(Boolean)
    .join('/');
  return joined.startsWith('/') ? joined : '/' + joined;
}

function renderField(field) {
  const options = {...field.options};
  options.type = TYPE_MAP[field.type];

  for (const key of ['required', 'unique', 'enum', 'min', 'max', 'default']) {
    if (field[key] !== undefined) options[key] = field[key];
  }
  if (field.minLength !== undefined) options.minlength = field.minLength;
  if (field.maxLength !== undefined) options.maxlength = field.maxLength;

  const entries = Object.entries(options).map(([key, value]) => {
    const rendered = key === 'type' ? value : js(value);
    return key + ': ' + rendered;
  });
  return '  ' + field.name + ': { ' + entries.join(', ') + ' }';
}

function modelSource(entity) {
  const schemaOptions = {
    ...entity.schemaOptions,
    ...(entity.collection ? {collection: entity.collection} : {})
  };

  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');", '',
    'const ' + entity.name + 'Schema = new mongoose.Schema({',
    entity.fields.map(renderField).join(',\n'),
    '}, ' + js(schemaOptions) + ');', '',
    "module.exports = mongoose.model('" + entity.name + "', " + entity.name + 'Schema);', ''
  ].join('\n');
}

function operationEnabled(entity, name) {
  return entity.operations[name] && entity.operations[name].enabled;
}

function controllerSource(entity) {
  const model = entity.name;
  const id = "req.params[" + js(entity.idParam) + "]";
  const functions = [];
  const exports = [];

  if (operationEnabled(entity, 'list')) {
    const op = entity.operations.list;
    let query = model + '.find()';
    if (op.lean) query += '.lean()';
    functions.push([
      'async function list(req, res, next) {',
      '  try {',
      '    const items = await ' + query + ';',
      '    res.status(' + op.status + ').json(items);',
      '  } catch (error) { next(error); }',
      '}'
    ].join('\n'));
    exports.push('list');
  }

  if (operationEnabled(entity, 'get')) {
    const op = entity.operations.get;
    let query = model + '.findById(' + id + ')';
    if (op.lean) query += '.lean()';
    functions.push([
      'async function get(req, res, next) {',
      '  try {',
      '    const item = await ' + query + ';',
      "    if (!item) return res.status(" + op.notFoundStatus + ").json({error: '" + model + " not found'});",
      '    res.status(' + op.status + ').json(item);',
      '  } catch (error) { next(error); }',
      '}'
    ].join('\n'));
    exports.push('get');
  }

  if (operationEnabled(entity, 'create')) {
    const op = entity.operations.create;
    functions.push([
      'async function create(req, res, next) {',
      '  try {',
      '    const item = await ' + model + '.create(req.body);',
      '    res.status(' + op.status + ').json(item);',
      '  } catch (error) { next(error); }',
      '}'
    ].join('\n'));
    exports.push('create');
  }

  if (operationEnabled(entity, 'update')) {
    const op = entity.operations.update;
    functions.push([
      'async function update(req, res, next) {',
      '  try {',
      '    const item = await ' + model + '.findByIdAndUpdate(' + id + ', req.body, {new: true, runValidators: ' + op.runValidators + '});',
      "    if (!item) return res.status(" + op.notFoundStatus + ").json({error: '" + model + " not found'});",
      '    res.status(' + op.status + ').json(item);',
      '  } catch (error) { next(error); }',
      '}'
    ].join('\n'));
    exports.push('update');
  }

  if (operationEnabled(entity, 'delete')) {
    const op = entity.operations.delete;
    const success = op.status === 204
      ? '    res.status(204).end();'
      : '    res.status(' + op.status + ').json(item);';
    functions.push([
      'async function remove(req, res, next) {',
      '  try {',
      '    const item = await ' + model + '.findByIdAndDelete(' + id + ');',
      "    if (!item) return res.status(" + op.notFoundStatus + ").json({error: '" + model + " not found'});",
      success,
      '  } catch (error) { next(error); }',
      '}'
    ].join('\n'));
    exports.push('remove');
  }

  return [
    "'use strict';", '',
    "const " + model + " = require('../models/" + model + "');", '',
    functions.join('\n\n'), '',
    'module.exports = {' + exports.join(', ') + '};', ''
  ].join('\n');
}

function routesSource(entity) {
  const routeLines = [];
  const controllerNames = {list: 'list', get: 'get', create: 'create', update: 'update', delete: 'remove'};

  for (const [name, operation] of Object.entries(entity.operations)) {
    if (!operation.enabled) continue;
    routeLines.push(
      'router.' + operation.method + '(' + js(operation.path) + ', controller.' + controllerNames[name] + ');'
    );
  }

  return [
    "'use strict';", '',
    "const express = require('express');",
    "const controller = require('../controllers/" + entity.name + "Controller');", '',
    'const router = express.Router();', '',
    ...routeLines, '',
    'module.exports = router;', ''
  ].join('\n');
}

function appSource(spec) {
  const imports = spec.entities.map(entity => "const " + entity.name + "Routes = require('./routes/" + entity.name + "Routes');");
  const mounts = spec.entities.map(entity => {
    const basePath = joinUrl(spec.app.apiPrefix, entity.route);
    return 'app.use(' + js(basePath) + ', ' + entity.name + 'Routes);';
  });
  const health = spec.app.health.enabled
    ? ['app.get(' + js(spec.app.health.path) + ', (req, res) => res.status(' + spec.app.health.status + ').json(' + js(spec.app.health.response) + '));']
    : [];

  return [
    "'use strict';", '',
    "const express = require('express');",
    "const errorHandler = require('./middleware/error-handler');",
    ...imports, '',
    'const app = express();', '',
    'app.use(express.json({limit: ' + js(spec.app.bodyLimit) + '}));',
    ...health,
    ...mounts, '',
    'app.use((req, res) => res.status(' + spec.app.statusCodes.notFound + ').json({error: ' + js(spec.app.responses.notFound) + '}));',
    'app.use(errorHandler);', '',
    'module.exports = app;', ''
  ].join('\n');
}

function serverSource(spec) {
  const safeName = spec.app.name.replace(/'/g, "\\'");
  return [
    "'use strict';", '',
    "require('dotenv').config();",
    "const app = require('./app');",
    "const connectDatabase = require('./config/database');", '',
    "const port = Number(process.env[" + js(spec.app.portEnv) + "] || " + spec.app.port + ');', '',
    'async function start() {',
    '  await connectDatabase();',
    "  app.listen(port, () => console.log('" + safeName + " listening on port ' + port));",
    '}', '',
    "start().catch(error => { console.error('Failed to start application:', error); process.exitCode = 1; });", ''
  ].join('\n');
}

function databaseSource(spec) {
  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');", '',
    'async function connectDatabase() {',
    "  const uri = process.env[" + js(spec.database.uriEnv) + "];",
    "  if (!uri) throw new Error('Missing required environment variable " + spec.database.uriEnv + "');",
    '  await mongoose.connect(uri, ' + js(spec.database.options) + ');',
    '  return mongoose.connection;',
    '}', '',
    'module.exports = connectDatabase;', ''
  ].join('\n');
}

function errorHandlerSource(spec) {
  return [
    "'use strict';", '',
    'module.exports = function errorHandler(error, req, res, next) {',
    "  if (error && error.name === 'ValidationError') return res.status(" + spec.app.statusCodes.validationError + ").json({error: " + js(spec.app.responses.validationError) + ", details: error.message});",
    "  if (error && error.name === 'CastError') return res.status(" + spec.app.statusCodes.invalidIdentifier + ").json({error: " + js(spec.app.responses.invalidIdentifier) + "});",
    "  if (error && error.code === 11000) return res.status(" + spec.app.statusCodes.uniqueConstraint + ").json({error: " + js(spec.app.responses.uniqueConstraint) + ", fields: error.keyValue});",
    '  console.error(error);',
    "  return res.status(" + spec.app.statusCodes.internalError + ").json({error: " + js(spec.app.responses.internalError) + "});",
    '};', ''
  ].join('\n');
}

function generatedPackageSource(spec) {
  const packageConfig = spec.app.package;
  return JSON.stringify({
    name: packageConfig.name,
    version: packageConfig.version,
    private: packageConfig.private,
    description: packageConfig.description,
    main: 'src/server.js',
    scripts: packageConfig.scripts,
    engines: {node: packageConfig.nodeEngine},
    dependencies: packageConfig.dependencies,
    devDependencies: packageConfig.devDependencies
  }, null, 2) + '\n';
}

function endpointLines(spec) {
  const lines = [];
  if (spec.app.health.enabled) lines.push('- GET ' + spec.app.health.path);
  for (const entity of spec.entities) {
    const base = joinUrl(spec.app.apiPrefix, entity.route);
    for (const operation of Object.values(entity.operations)) {
      if (!operation.enabled) continue;
      const fullPath = operation.path === '/' ? base : joinUrl(base, operation.path);
      lines.push('- ' + operation.method.toUpperCase() + ' ' + fullPath);
    }
  }
  return lines;
}

function generatedReadme(spec) {
  return [
    '# ' + spec.app.name, '',
    spec.app.package.description, '',
    'Generated by json-to-express.', '',
    '## Run', '',
    '    npm install',
    '    cp .env.example .env',
    '    npm start', '',
    'Default port: ' + spec.app.port + ' (' + spec.app.portEnv + ').', '',
    '## Endpoints', '',
    ...endpointLines(spec), ''
  ].join('\n');
}

function smokeTestSource(spec) {
  return [
    "'use strict';", '',
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const request = require('supertest');",
    "const app = require('../src/app');", '',
    "test('configured health endpoint responds', async () => {",
    '  const response = await request(app).get(' + js(spec.app.health.path) + ').expect(' + spec.app.health.status + ');',
    '  assert.deepEqual(response.body, ' + js(spec.app.health.response) + ');',
    '});', ''
  ].join('\n');
}

function buildFiles(spec) {
  const files = new Map();
  files.set('package.json', generatedPackageSource(spec));
  files.set('.env.example', spec.app.portEnv + '=' + spec.app.port + '\n' + spec.database.uriEnv + '=' + spec.database.defaultUri + '\n');
  files.set('README.md', generatedReadme(spec));
  files.set('src/app.js', appSource(spec));
  files.set('src/server.js', serverSource(spec));
  files.set('src/config/database.js', databaseSource(spec));
  files.set('src/middleware/error-handler.js', errorHandlerSource(spec));
  if (spec.app.health.enabled) files.set('test/health.test.js', smokeTestSource(spec));

  for (const entity of spec.entities) {
    files.set('src/models/' + entity.name + '.js', modelSource(entity));
    files.set('src/controllers/' + entity.name + 'Controller.js', controllerSource(entity));
    files.set('src/routes/' + entity.name + 'Routes.js', routesSource(entity));
  }
  return files;
}

function assertWritable(outputDir, force) {
  if (!fs.existsSync(outputDir)) return;
  if (fs.readdirSync(outputDir).length === 0) return;
  if (!force) throw new Error('Output directory is not empty: ' + outputDir + '. Use --force to replace it.');
  fs.rmSync(outputDir, {recursive: true, force: true});
}

function generateApplication(inputSpec, outputDir, options = {}) {
  const spec = normalizeSpec(inputSpec);
  const target = path.resolve(outputDir || spec.generation.outputDir || path.join('generated', spec.app.package.name));
  assertWritable(target, options.force === true);
  fs.mkdirSync(target, {recursive: true});
  const files = buildFiles(spec);
  for (const [relativePath, fileContent] of files) {
    const destination = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, fileContent, 'utf8');
  }
  return {outputDir: target, files: [...files.keys()], spec};
}

module.exports = {buildFiles, generateApplication};
