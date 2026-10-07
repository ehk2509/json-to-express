'use strict';

const {generateApplication} = require('./generator');
const {normalizeSpec} = require('./normalize-spec');
const {validateSpec, SpecificationError} = require('./validate-spec');

module.exports = {generateApplication, normalizeSpec, validateSpec, SpecificationError};
