'use strict';

const {js} = require('./utils');

module.exports = function environmentSource(spec) {
  const declared = {...spec.environment};
  declared[spec.database.uriEnv] = declared[spec.database.uriEnv] || {required: true};
  if (spec.auth.jwt.enabled) declared[spec.auth.jwt.secretEnv] = declared[spec.auth.jwt.secretEnv] || {required: true};
  if (spec.auth.apiKey.enabled) {
    for (const key of spec.auth.apiKey.keys) declared[key.env] = declared[key.env] || {required: true};
  }
  if (spec.auth.oidc.enabled) {
    declared[spec.auth.oidc.clientIdEnv] = declared[spec.auth.oidc.clientIdEnv] || {required: true};
    if (spec.auth.oidc.clientSecretEnv) declared[spec.auth.oidc.clientSecretEnv] = declared[spec.auth.oidc.clientSecretEnv] || {required: true};
  }
  if (spec.auth.local.passwordReset.webhookUrlEnv) {
    const name = spec.auth.local.passwordReset.webhookUrlEnv;
    declared[name] = declared[name] || {required: true};
  }
  for (const event of Object.values(spec.events)) {
    for (const webhook of event.webhooks) declared[webhook.urlEnv] = declared[webhook.urlEnv] || {required: true};
  }

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
