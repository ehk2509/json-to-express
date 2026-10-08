'use strict';

const path = require('node:path');
const modelSource = require('./model');
const controllerSource = require('./controller');
const prismaSchemaSource = require('./prisma-schema');
const prismaControllerSource = require('./prisma-controller');
const routesSource = require('./routes');
const appSource = require('./app');
const serverSource = require('./server');
const databaseSource = require('./database');
const errorHandlerSource = require('./error-handler');
const packageSource = require('./package');
const readmeSource = require('./readme');
const healthTestSource = require('./health-generator');
const authSource = require('./auth');
const authStoreSource = require('./auth-store');
const authRoutesSource = require('./auth-routes');
const validationSource = require('./validation');
const environmentSource = require('./environment');
const openapiSource = require('./openapi');
const contractTestSource = require('./contract-test');
const workflowEngineSource = require('./workflow-engine');
const eventBusSource = require('./event-bus');
const customRoutesSource = require('./custom-routes');
const outboxSource = require('./outbox');
const workerSource = require('./worker');
const dockerfileSource = require('./dockerfile');
const composeSource = require('./compose');
const kubernetesFiles = require('./kubernetes');
const sdkFiles = require('./sdk');
const adminFiles = require('./admin');
const graphqlSource = require('./graphql');
const observabilitySource = require('./observability');
const cacheSource = require('./cache');
const {filePaths} = require('./utils');

function envExample(spec) {
  const values = {
    [spec.app.portEnv]: spec.app.port,
    [spec.app.hostEnv]: spec.app.host,
    [spec.database.uriEnv]: spec.database.defaultUri
  };

  if (spec.auth.jwt.enabled) values[spec.auth.jwt.secretEnv] = 'change-me';
  if (spec.auth.apiKey.enabled) {
    for (const key of spec.auth.apiKey.keys) values[key.env] = 'change-me';
  }
  if (spec.auth.oidc.enabled) {
    values[spec.auth.oidc.clientIdEnv] = '';
    if (spec.auth.oidc.clientSecretEnv) values[spec.auth.oidc.clientSecretEnv] = '';
  }
  if (spec.auth.local.passwordReset.webhookUrlEnv) values[spec.auth.local.passwordReset.webhookUrlEnv] = '';
  if (spec.observability.tracing.enabled && spec.observability.tracing.exporter === 'otlp-http') {
    values[spec.observability.tracing.endpointEnv] = 'http://127.0.0.1:4318/v1/traces';
  }
  if (spec.cache.enabled && spec.cache.provider === 'redis') {
    values[spec.cache.redis.urlEnv] = 'redis://127.0.0.1:6379';
  }
  for (const event of Object.values(spec.events)) {
    for (const webhook of event.webhooks) {
      if (!(webhook.urlEnv in values)) values[webhook.urlEnv] = '';
    }
  }

  for (const [name, raw] of Object.entries(spec.environment)) {
    if (typeof raw === 'string') values[name] = raw;
    else if (raw && raw.default !== undefined) values[name] = raw.default;
    else if (!(name in values)) values[name] = '';
  }

  return Object.entries(values).map(([name, value]) => name + '=' + value).join('\n') + '\n';
}

function buildFiles(spec) {
  const files = new Map();
  const paths = filePaths(spec);

  files.set('package.json', packageSource(spec));
  files.set('.env.example', envExample(spec));
  files.set('README.md', readmeSource(spec));
  files.set(paths.app, appSource(spec));
  files.set(paths.server, serverSource(spec));
  files.set(paths.database, databaseSource(spec));
  files.set(paths.errorHandler, errorHandlerSource(spec));
  files.set(paths.validation, validationSource(spec));
  files.set(paths.environment, environmentSource(spec));
  const observability = observabilitySource(spec);
  if (observability) files.set(paths.observability, observability);
  const cache = cacheSource(spec);
  if (cache) files.set(paths.cache, cache);
  if (spec.api.graphql.enabled) files.set(paths.graphql, graphqlSource(spec));

  if (spec.workflows.length || spec.outbox.enabled) {
    files.set(paths.workflowEngine, workflowEngineSource(spec));
    files.set(paths.eventBus, eventBusSource(spec));
    files.set(paths.outbox, outboxSource(spec));
  }
  if (spec.outbox.enabled) files.set(paths.worker, workerSource(spec));
  if (spec.endpoints.length) files.set(paths.endpointRoutes, customRoutesSource(spec));

  const auth = authSource(spec);
  if (auth) files.set(paths.auth, auth);
  const authStore = authStoreSource(spec);
  if (authStore) files.set(paths.authStore, authStore);
  const authRoutes = authRoutesSource(spec);
  if (authRoutes) files.set(paths.authRoutes, authRoutes);

  if (spec.app.health.enabled) files.set(paths.test, healthTestSource(spec));
  files.set(path.posix.join(spec.generation.paths.tests, 'contract.test.js'), contractTestSource(spec));

  if (spec.docs.openapi.enabled) files.set(spec.docs.openapi.file, openapiSource(spec));

  if (spec.deployment.docker.enabled) {
    files.set(spec.deployment.docker.file, dockerfileSource(spec));
    files.set(spec.deployment.docker.ignoreFile, dockerfileSource.ignoreSource(spec));
  }
  if (spec.deployment.compose.enabled) files.set(spec.deployment.compose.file, composeSource(spec));
  if (spec.deployment.kubernetes.enabled) {
    for (const [relativePath, content] of kubernetesFiles(spec)) files.set(relativePath, content);
  }
  if (spec.sdk.enabled) {
    for (const [relativePath, content] of sdkFiles(spec)) files.set(relativePath, content);
  }
  if (spec.admin.enabled) {
    for (const [relativePath, content] of adminFiles(spec)) files.set(relativePath, content);
  }

  if (spec.database.type === 'postgresql') {
    files.set(spec.database.prisma.schemaPath, prismaSchemaSource(spec));
  }

  for (const entity of spec.entities) {
    const entityPaths = filePaths(spec, entity.name);
    if (spec.database.type === 'mongodb') files.set(entityPaths.model, modelSource(entity, spec));
    files.set(
      entityPaths.controller,
      spec.database.type === 'postgresql' ? prismaControllerSource(entity, spec) : controllerSource(entity, spec)
    );
    files.set(entityPaths.route, routesSource(entity, spec));
  }

  return files;
}

module.exports = {buildFiles};
