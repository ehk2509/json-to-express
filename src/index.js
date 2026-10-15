'use strict';

const {generateApplication, planApplication} = require('./generator');
const {normalizeSpec} = require('./normalize-spec');
const {validateSpec, SpecificationError} = require('./validate-spec');
const {CURRENT_SPEC_VERSION, upgradeSpec} = require('./spec-version');
const {API_VERSION: PLUGIN_API_VERSION, KINDS: PLUGIN_KINDS} = require('./plugins');

module.exports = {
  CURRENT_SPEC_VERSION,
  PLUGIN_API_VERSION,
  PLUGIN_KINDS,
  SpecificationError,
  generateApplication,
  planApplication,
  normalizeSpec,
  upgradeSpec,
  validateSpec
};
