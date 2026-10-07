'use strict';

const {generateApplication} = require('./generator');
const {normalizeSpec} = require('./normalize-spec');
const {validateSpec, SpecificationError} = require('./validate-spec');
const {CURRENT_SPEC_VERSION, upgradeSpec} = require('./spec-version');

module.exports = {
  CURRENT_SPEC_VERSION,
  SpecificationError,
  generateApplication,
  normalizeSpec,
  upgradeSpec,
  validateSpec
};
