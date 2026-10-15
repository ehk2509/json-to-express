'use strict';

const path = require('node:path');
const {normalizeSpec} = require('./normalize-spec');
const {buildFiles} = require('./generators');
const {planGeneratedFiles, writeGeneratedFiles} = require('./manifest');
const {schemaSnapshot} = require('./evolution');
const {executePlugins, validateDeclarations} = require('./plugins');

function customSnapshot(raw) {
  const entities = (raw.entities && typeof raw.entities === 'object' ? raw.entities : {});
  return schemaSnapshot({
    app: {framework: raw.app && raw.app.framework || 'express'},
    database: {type: raw.database.type, idStrategy: raw.database.idStrategy},
    storage: {enabled: false},
    entities: Object.entries(entities).map(([name, entity]) => ({
      name,
      route: entity.route || name.toLowerCase(),
      collection: entity.collection,
      indexes: entity.indexes || [],
      softDelete: {enabled: Boolean(entity.softDelete && entity.softDelete.enabled)},
      fields: Object.entries(entity.fields || {}).map(([fieldName, field]) => ({
        name: fieldName, ...field
      }))
    }))
  });
}

function prepare(inputSpec, outputDir, options = {}) {
  if (!inputSpec || !inputSpec.app || !inputSpec.database ||
      typeof inputSpec.database.type !== 'string') {
    throw new Error('A valid app and database.type are required');
  }
  const declarations = validateDeclarations(inputSpec.plugins);
  const projectMode = !['mongodb', 'postgresql'].includes(inputSpec.database.type);
  if (projectMode && (!declarations.length ||
      declarations[0].kind !== 'database')) {
    throw new Error('Custom database targets require a complete-project database plugin first');
  }
  let spec, files, snapshot, target;
  if (projectMode) {
    if (typeof inputSpec.app.name !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(inputSpec.app.name) ||
        !inputSpec.entities || !Object.keys(inputSpec.entities).length) {
      throw new Error('Custom provider requires app.name and nonempty entities');
    }
    spec = inputSpec;
    target = path.resolve(outputDir || (spec.generation && spec.generation.outputDir) ||
      path.join('generated', spec.app.name));
    snapshot = customSnapshot(spec);
    files = executePlugins(declarations, spec, {pluginRoot: options.pluginRoot, projectMode: true}).files;
  } else {
    spec = normalizeSpec(inputSpec);
    target = path.resolve(outputDir || spec.generation.outputDir ||
      path.join('generated', spec.app.package.name));
    snapshot = schemaSnapshot(spec);
    const base = buildFiles(spec);
    files = declarations.length ?
      executePlugins(declarations, spec, {pluginRoot: options.pluginRoot, builtFiles: base}).files : base;
  }
  return {spec, target, files, snapshot};
}

function planApplication(inputSpec, outputDir, options = {}) {
  const {target, files, snapshot} = prepare(inputSpec, outputDir, options);
  return planGeneratedFiles(target, files, snapshot);
}

function generateApplication(inputSpec, outputDir, options = {}) {
  const {spec, target, files, snapshot} = prepare(inputSpec, outputDir, options);
  const manifest = writeGeneratedFiles(target, files, {
    schemaSnapshot: snapshot,
    force: options.force === true,
    approveSchema: options.approveSchema === true,
    allowDestructive: options.allowDestructive === true,
    allowUnknownSchema: options.allowUnknownSchema === true
  });
  return {
    outputDir: target,
    files: [...files.keys(), '.j2e-manifest.json'],
    spec,
    manifest
  };
}

module.exports = {buildFiles, generateApplication, planApplication};
