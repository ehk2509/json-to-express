'use strict';

const CURRENT_SPEC_VERSION = '1.0';

function upgradeSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  if (input.specVersion === CURRENT_SPEC_VERSION) return input;
  if (input.specVersion !== undefined) {
    throw new Error('Unsupported specVersion "' + input.specVersion + '". Current version is ' + CURRENT_SPEC_VERSION + '.');
  }

  return {
    specVersion: CURRENT_SPEC_VERSION,
    ...input
  };
}

module.exports = {CURRENT_SPEC_VERSION, upgradeSpec};
