'use strict';

const path = require('node:path');
const {normalizeSpec} = require('./normalize-spec');
const {buildFiles} = require('./generators');
const {planGeneratedFiles, writeGeneratedFiles} = require('./manifest');
const {schemaSnapshot} = require('./evolution');

function prepare(inputSpec, outputDir) {
  const spec = normalizeSpec(inputSpec);
  const target = path.resolve(
    outputDir || spec.generation.outputDir ||
    path.join('generated', spec.app.package.name)
  );
  const files = buildFiles(spec);
  const snapshot = schemaSnapshot(spec);
  return {spec, target, files, snapshot};
}

function planApplication(inputSpec, outputDir) {
  const {target, files, snapshot} = prepare(inputSpec, outputDir);
  return planGeneratedFiles(target, files, snapshot);
}

function generateApplication(inputSpec, outputDir, options = {}) {
  const {spec, target, files, snapshot} = prepare(inputSpec, outputDir);
  const plan = writeGeneratedFiles(target, files, {
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
    manifest: plan
  };
}

module.exports = {buildFiles, generateApplication, planApplication};
