'use strict';

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'app';
}

function databaseName(spec) {
  return String(spec.app.package.name).replace(/[^A-Za-z0-9_]/g, '_');
}

function composeDatabaseUrl(spec) {
  const name = databaseName(spec);
  if (spec.database.type === 'postgresql') {
    return 'postgresql://postgres:postgres@database:5432/' + name;
  }
  return 'mongodb://database:27017/' + name;
}

function environmentContract(spec) {
  const config = {
    [spec.app.portEnv]: String(spec.app.port),
    [spec.app.hostEnv]: '0.0.0.0'
  };
  const secrets = {
    [spec.database.uriEnv]: '<set-me>'
  };

  if (spec.auth.jwt.enabled) secrets[spec.auth.jwt.secretEnv] = '<set-me>';
  if (spec.auth.apiKey.enabled) {
    for (const key of spec.auth.apiKey.keys) secrets[key.env] = '<set-me>';
  }
  if (spec.auth.oidc.enabled) {
    secrets[spec.auth.oidc.clientIdEnv] = '<set-me>';
    if (spec.auth.oidc.clientSecretEnv) secrets[spec.auth.oidc.clientSecretEnv] = '<set-me>';
  }
  if (spec.auth.local.passwordReset.webhookUrlEnv) {
    secrets[spec.auth.local.passwordReset.webhookUrlEnv] = '<set-me>';
  }
  if (spec.cache.enabled && spec.cache.provider === 'redis') {
    secrets[spec.cache.redis.urlEnv] = '<set-me>';
  }
  if (spec.observability.tracing.enabled && spec.observability.tracing.exporter === 'otlp-http') {
    config[spec.observability.tracing.endpointEnv] = 'http://otel-collector:4318/v1/traces';
  }

  for (const event of Object.values(spec.events)) {
    for (const webhook of event.webhooks) secrets[webhook.urlEnv] = '<set-me>';
  }

  for (const [name, raw] of Object.entries(spec.environment)) {
    if (typeof raw === 'string') config[name] = raw;
    else if (raw && raw.default !== undefined) config[name] = String(raw.default);
    else if (!(name in config) && !(name in secrets)) secrets[name] = '<set-me>';
  }

  return {config, secrets};
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

module.exports = {composeDatabaseUrl, databaseName, environmentContract, slug, yamlScalar};
