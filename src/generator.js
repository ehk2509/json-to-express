'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {normalizeSpec} = require('./normalize-spec');

const TYPE_MAP = {string: 'String', number: 'Number', boolean: 'Boolean', date: 'Date'};

function renderField(field) {
  const options = ['type: ' + TYPE_MAP[field.type]];
  if (field.required) options.push('required: true');
  if (field.unique) options.push('unique: true');
  if (field.enum) options.push('enum: ' + JSON.stringify(field.enum));
  if (field.min !== undefined) options.push('min: ' + field.min);
  if (field.max !== undefined) options.push('max: ' + field.max);
  if (field.minLength !== undefined) options.push('minlength: ' + field.minLength);
  if (field.maxLength !== undefined) options.push('maxlength: ' + field.maxLength);
  if (field.default !== undefined) options.push('default: ' + JSON.stringify(field.default));
  return '  ' + field.name + ': { ' + options.join(', ') + ' }';
}

function modelSource(entity) {
  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');", '',
    'const ' + entity.name + 'Schema = new mongoose.Schema({',
    entity.fields.map(renderField).join(',\n'),
    '}, {timestamps: true, versionKey: false});', '',
    "module.exports = mongoose.model('" + entity.name + "', " + entity.name + 'Schema);', ''
  ].join('\n');
}

function controllerSource(entity) {
  const model = entity.name;
  return [
    "'use strict';", '',
    "const " + model + " = require('../models/" + model + "');", '',
    'async function list(req, res, next) {',
    '  try { res.json(await ' + model + '.find().lean()); } catch (error) { next(error); }',
    '}', '',
    'async function get(req, res, next) {',
    '  try {',
    '    const item = await ' + model + '.findById(req.params.id).lean();',
    "    if (!item) return res.status(404).json({error: '" + model + " not found'});",
    '    res.json(item);',
    '  } catch (error) { next(error); }',
    '}', '',
    'async function create(req, res, next) {',
    '  try { res.status(201).json(await ' + model + '.create(req.body)); } catch (error) { next(error); }',
    '}', '',
    'async function update(req, res, next) {',
    '  try {',
    '    const item = await ' + model + '.findByIdAndUpdate(req.params.id, req.body, {new: true, runValidators: true});',
    "    if (!item) return res.status(404).json({error: '" + model + " not found'});",
    '    res.json(item);',
    '  } catch (error) { next(error); }',
    '}', '',
    'async function remove(req, res, next) {',
    '  try {',
    '    const item = await ' + model + '.findByIdAndDelete(req.params.id);',
    "    if (!item) return res.status(404).json({error: '" + model + " not found'});",
    '    res.status(204).end();',
    '  } catch (error) { next(error); }',
    '}', '',
    'module.exports = {list, get, create, update, remove};', ''
  ].join('\n');
}

function routesSource(entity) {
  return [
    "'use strict';", '',
    "const express = require('express');",
    "const controller = require('../controllers/" + entity.name + "Controller');", '',
    'const router = express.Router();', '',
    "router.get('/', controller.list);",
    "router.get('/:id', controller.get);",
    "router.post('/', controller.create);",
    "router.patch('/:id', controller.update);",
    "router.delete('/:id', controller.remove);", '',
    'module.exports = router;', ''
  ].join('\n');
}

function appSource(spec) {
  const imports = spec.entities.map(entity => "const " + entity.name + "Routes = require('./routes/" + entity.name + "Routes');");
  const mounts = spec.entities.map(entity => "app.use('/api/" + entity.route + "', " + entity.name + 'Routes);');
  return [
    "'use strict';", '',
    "const express = require('express');",
    "const errorHandler = require('./middleware/error-handler');",
    ...imports, '',
    'const app = express();', '',
    'app.use(express.json());',
    "app.get('/health', (req, res) => res.json({status: 'ok'}));",
    ...mounts, '',
    "app.use((req, res) => res.status(404).json({error: 'Route not found'}));",
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
    'const port = Number(process.env.PORT || ' + spec.app.port + ');', '',
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
    "  const uri = process.env['" + spec.database.uriEnv + "'];",
    "  if (!uri) throw new Error('Missing required environment variable " + spec.database.uriEnv + "');",
    '  await mongoose.connect(uri);',
    '  return mongoose.connection;',
    '}', '',
    'module.exports = connectDatabase;', ''
  ].join('\n');
}

function errorHandlerSource() {
  return [
    "'use strict';", '',
    'module.exports = function errorHandler(error, req, res, next) {',
    "  if (error && error.name === 'ValidationError') return res.status(400).json({error: 'Validation failed', details: error.message});",
    "  if (error && error.name === 'CastError') return res.status(400).json({error: 'Invalid identifier'});",
    "  if (error && error.code === 11000) return res.status(409).json({error: 'Unique constraint violated', fields: error.keyValue});",
    '  console.error(error);',
    "  return res.status(500).json({error: 'Internal server error'});",
    '};', ''
  ].join('\n');
}

function generatedPackageSource(spec) {
  return JSON.stringify({
    name: spec.app.packageName,
    version: '0.1.0',
    private: true,
    description: 'Generated by json-to-express',
    main: 'src/server.js',
    scripts: {start: 'node src/server.js', dev: 'node --watch src/server.js', test: 'node --test'},
    engines: {node: '>=18'},
    dependencies: {dotenv: '^16.4.5', express: '^4.21.1', mongoose: '^8.8.0'},
    devDependencies: {supertest: '^7.0.0'}
  }, null, 2) + '\n';
}

function generatedReadme(spec) {
  return [
    '# ' + spec.app.name, '',
    'Generated by json-to-express.', '',
    '## Run', '',
    '    npm install',
    '    cp .env.example .env',
    '    npm start', '',
    'Default port: ' + spec.app.port + '.', '',
    '## Endpoints', '',
    '- GET /health',
    ...spec.entities.flatMap(entity => [
      '- GET /api/' + entity.route,
      '- GET /api/' + entity.route + '/:id',
      '- POST /api/' + entity.route,
      '- PATCH /api/' + entity.route + '/:id',
      '- DELETE /api/' + entity.route + '/:id'
    ]), ''
  ].join('\n');
}

function smokeTestSource() {
  return [
    "'use strict';", '',
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const request = require('supertest');",
    "const app = require('../src/app');", '',
    "test('GET /health reports ok', async () => {",
    "  const response = await request(app).get('/health').expect(200);",
    "  assert.deepEqual(response.body, {status: 'ok'});",
    '});', ''
  ].join('\n');
}

function buildFiles(spec) {
  const files = new Map();
  files.set('package.json', generatedPackageSource(spec));
  files.set('.env.example', 'PORT=' + spec.app.port + '\n' + spec.database.uriEnv + '=mongodb://127.0.0.1:27017/' + spec.app.packageName + '\n');
  files.set('README.md', generatedReadme(spec));
  files.set('src/app.js', appSource(spec));
  files.set('src/server.js', serverSource(spec));
  files.set('src/config/database.js', databaseSource(spec));
  files.set('src/middleware/error-handler.js', errorHandlerSource());
  files.set('test/health.test.js', smokeTestSource());

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
  const target = path.resolve(outputDir);
  assertWritable(target, options.force === true);
  fs.mkdirSync(target, {recursive: true});
  const files = buildFiles(spec);
  for (const [relativePath, content] of files) {
    const destination = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, content, 'utf8');
  }
  return {outputDir: target, files: [...files.keys()], spec};
}

module.exports = {buildFiles, generateApplication};
