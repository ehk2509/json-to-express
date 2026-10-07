'use strict';

const path = require('node:path');
const {normalizeSpec} = require('./normalize-spec');
const {buildFiles} = require('./generators');
const {writeGeneratedFiles} = require('./manifest');

function generateApplication(inputSpec, outputDir, options = {}) {
  const spec = normalizeSpec(inputSpec);
  const target = path.resolve(
    outputDir ||
    spec.generation.outputDir ||
    path.join('generated', spec.app.package.name)
  );

  const files = buildFiles(spec);
  writeGeneratedFiles(target, files, {force: options.force === true});

  return {
    outputDir: target,
    files: [...files.keys(), '.j2e-manifest.json'],
    spec
  };
}

module.exports = {buildFiles, generateApplication};
