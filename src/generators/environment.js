'use strict';

const {js} = require('./utils');

module.exports = function environmentSource(spec) {
  const declared = {...spec.environment};
  declared[spec.database.uriEnv] = declared[spec.database.uriEnv] || {required: true};
  if (spec.auth.enabled) declared[spec.auth.secretEnv] = declared[spec.auth.secretEnv] || {required: true};

  return [
    "'use strict';", '',
    'const definitions = ' + js(declared) + ';', '',
    'function validateEnvironment() {',
    '  const missing = [];',
    '  for (const [name, raw] of Object.entries(definitions)) {',
    "    const definition = typeof raw === 'string' ? {default: raw} : raw;",
    '    if (process.env[name] === undefined && definition.default !== undefined) process.env[name] = String(definition.default);',
    '    if (definition.required && !process.env[name]) missing.push(name);',
    '  }',
    "  if (missing.length) throw new Error('Missing required environment variables: ' + missing.join(', '));",
    '}', '',
    'module.exports = validateEnvironment;', ''
  ].join('\n');
};
