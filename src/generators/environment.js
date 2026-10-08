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
  if (spec.cache.enabled && spec.cache.provider === 'redis') {
    const name = spec.cache.redis.urlEnv;
    declared[name] = declared[name] || {required: true};
  }
  if (spec.observability.tracing.enabled && spec.observability.tracing.exporter === 'otlp-http') {
    const name = spec.observability.tracing.endpointEnv;
    declared[name] = declared[name] || {required: true};
  }
  if (spec.storage.enabled) {
    if (spec.storage.provider === 'local' && spec.storage.signedUrls.enabled) {
      const name = spec.storage.signedUrls.signingSecretEnv;
      declared[name] = declared[name] || {required: true};
    }
    if (spec.storage.provider === 's3') {
      declared[spec.storage.s3.bucketEnv] = declared[spec.storage.s3.bucketEnv] || {required: true};
      declared[spec.storage.s3.regionEnv] = declared[spec.storage.s3.regionEnv] || {required: true};
      if (spec.storage.s3.endpointEnv) declared[spec.storage.s3.endpointEnv] = declared[spec.storage.s3.endpointEnv] || {required: true};
      if (spec.storage.s3.accessKeyEnv) declared[spec.storage.s3.accessKeyEnv] = declared[spec.storage.s3.accessKeyEnv] || {required: true};
      if (spec.storage.s3.secretKeyEnv) declared[spec.storage.s3.secretKeyEnv] = declared[spec.storage.s3.secretKeyEnv] || {required: true};
    }
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
