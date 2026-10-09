'use strict';

const {joinUrl} = require('./utils');

function endpointLines(spec) {
  const lines = [];
  if (spec.app.health.enabled) lines.push('- GET ' + spec.app.health.path);
  if (spec.observability.health.liveness.enabled) lines.push('- GET ' + spec.observability.health.liveness.path + ' (liveness)');
  if (spec.observability.health.readiness.enabled) lines.push('- GET ' + spec.observability.health.readiness.path + ' (readiness)');
  if (spec.observability.metrics.enabled) lines.push('- GET ' + spec.observability.metrics.path + ' (Prometheus metrics)');
  if (spec.api.graphql.enabled) lines.push('- GET/POST ' + spec.api.graphql.path + ' (GraphQL)');
  if (spec.auth.local.enabled && spec.auth.local.allowRegistration) lines.push('- POST ' + spec.auth.local.registerPath + ' (register)');
  if (spec.auth.local.enabled) {
    lines.push('- POST ' + spec.auth.local.loginPath + ' (login)');
    lines.push('- POST ' + spec.auth.local.forgotPasswordPath + ' (forgot password)');
    lines.push('- POST ' + spec.auth.local.resetPasswordPath + ' (reset password)');
  }
  if (spec.auth.jwt.refresh.enabled) lines.push('- POST ' + spec.auth.jwt.refresh.path + ' (refresh)');
  if (spec.auth.local.enabled || spec.auth.session.enabled || spec.auth.jwt.refresh.enabled) {
    lines.push('- POST ' + spec.auth.local.logoutPath + ' (logout)');
  }
  if (spec.auth.oidc.enabled) {
    lines.push('- GET ' + spec.auth.oidc.loginPath + ' (OIDC login)');
    lines.push('- GET ' + spec.auth.oidc.callbackPath + ' (OIDC callback)');
  }
  if (spec.api.rest) for (const endpoint of spec.endpoints) {
    lines.push('- ' + endpoint.method.toUpperCase() + ' ' + joinUrl(spec.app.apiPrefix, endpoint.path));
  }
  if (spec.api.rest) for (const entity of spec.entities) {
    const base = joinUrl(spec.app.apiPrefix, entity.route);
    for (const operation of Object.values(entity.operations)) {
      if (!operation.enabled) continue;
      const fullPath = operation.path === '/' ? base : joinUrl(base, operation.path);
      lines.push('- ' + operation.method.toUpperCase() + ' ' + fullPath);
    }
  }
  return lines;
}

module.exports = function readmeSource(spec) {
  const databaseLabel = spec.database.type === 'postgresql' ? 'PostgreSQL + Prisma' : 'MongoDB + Mongoose';
  const setup = [
    '    npm install',
    '    cp .env.example .env',
    ...(spec.database.type === 'postgresql' ? ['    npm run db:push'] : []),
    '    npm start'
  ];

  const deployment = [];
  if (spec.database.type === 'postgresql') deployment.push(
    '## Database migrations', '',
    'For a new generated app, run `npm run db:migrate:init` to create an initial SQL migration without needing a running database.',
    'Review and commit the generated `prisma/migrations` directory, then run `npm run db:migrate:deploy` against your database.',
    'The initial generator refuses to overwrite any existing migrations. Use `npm run db:migrate:dev -- --name change_name` for later changes against a disposable development database.',
    'Deploy committed migrations in staging/production: `npm run db:migrate:deploy`.',
    'Check drift/status: `npm run db:migrate:status`. `db:push` is for disposable development databases only.',
    'Never edit previously applied migration SQL. Use a new migration for changes. `db:push` is for disposable development databases.', ''
  );
  if (spec.database.type === 'postgresql' && (Object.keys(spec.seeds).length || Object.keys(spec.factories).length || Object.keys(spec.fixtures).length)) deployment.push(
    '## Declarative seed data', '',
    'Run `npm run db:seed` after migration deployment. Duplicate protection depends on unique indexes. Do not run sample seeds against sensitive production data.', ''
  );
  if (spec.outbox.enabled) {
    deployment.push(
      '## Background work', '',
      'Durable events and jobs are backed by the ' + databaseLabel + ' outbox.', '',
      'Worker mode: ' + spec.outbox.worker + '.', '',
      '    npm run worker',
      '    npm run worker:once',
      '    npm run outbox:retry', ''
    );
  }
  if (spec.admin.enabled) {
    deployment.push(
      '## Generated admin UI', '',
      'A standalone React/Vite admin application is generated in ' + spec.admin.outputDir + '.', '',
      '    cd ' + spec.admin.outputDir,
      '    npm install',
      '    npm run dev', '',
      'Production build: npm run build. Override the API URL with VITE_API_BASE_URL when needed.', ''
    );
  }
  if (spec.sdk.enabled) {
    deployment.push(
      '## Generated SDK', '',
      'A standalone API client package is generated in ' + spec.sdk.outputDir + '.', '',
      ...(spec.sdk.languages.includes('javascript') ? ['JavaScript: require("./' + spec.sdk.outputDir + '/javascript")', ''] : []),
      ...(spec.sdk.languages.includes('typescript') ? ['TypeScript: cd ' + spec.sdk.outputDir + ' && npm install && npm run build', ''] : [])
    );
  }
  if (spec.deployment.docker.enabled) {
    deployment.push('## Docker', '', '    docker build -t ' + spec.app.package.name + ' -f ' + spec.deployment.docker.file + ' .', '');
  }
  if (spec.deployment.compose.enabled) {
    deployment.push('## Docker Compose', '', '    docker compose -f ' + spec.deployment.compose.file + ' up --build', '');
  }
  if (spec.deployment.kubernetes.enabled) {
    deployment.push(
      '## Kubernetes', '',
      '1. Copy and fill ' + spec.deployment.kubernetes.directory + '/secret.example.yaml.', '',
      '2. Apply the secret, config, deployment, and service manifests with kubectl.', ''
    );
  }

  return [
    '# ' + spec.app.name, '',
    spec.app.package.description, '',
    'Generated by json-to-express.', '',
    'Database target: ' + databaseLabel + '.', '',
    'API targets: ' + [spec.api.rest ? 'REST' : null, spec.api.graphql.enabled ? 'GraphQL' : null].filter(Boolean).join(' + ') + '.', '',
    ...(spec.auth.enabled ? [
      '## Authentication', '',
      'Enabled strategies: ' + spec.auth.strategies.join(', ') + '.', '',
      ...(spec.auth.local.enabled ? [
        'Local email/password login is generated with scrypt password hashing' +
          (spec.auth.local.allowRegistration ? ', registration' : '') + ', logout, and password reset.', ''
      ] : []),
      ...(spec.auth.jwt.enabled ? [
        'JWT access tokens use ' + spec.auth.jwt.secretEnv + ' and expire after ' + spec.auth.jwt.accessTtlSeconds + ' seconds.', ''
      ] : []),
      ...(spec.auth.jwt.refresh.enabled ? [
        'Refresh tokens are opaque, one-time rotated, stored only as hashes, and expire after ' + spec.auth.jwt.refresh.ttlSeconds + ' seconds.', ''
      ] : []),
      ...(spec.auth.session.enabled ? [
        'Session cookies are durable and backed by the generated database auth-token store.', ''
      ] : []),
      ...(spec.auth.apiKey.enabled ? [
        'API keys are read from the ' + spec.auth.apiKey.header + ' header and configured through environment variables.', ''
      ] : []),
      ...(spec.auth.oidc.enabled ? [
        'OIDC supports discovery, remote JWKS verification, Authorization Code + PKCE login, and bearer verification.', ''
      ] : []),
      'REST and GraphQL apply the same per-operation strategy allowlists and RBAC rules.', ''
    ] : []),
    ...(spec.storage.enabled ? [
      '## File uploads and object storage', '',
      'Storage provider: ' + spec.storage.provider + '.', '',
      ...(spec.storage.provider === 'local' ? [
        'Local storage directory: ' + spec.storage.local.directory + '.', '',
        ...(spec.storage.signedUrls.enabled ? [
          'Signed download URLs expire after ' + spec.storage.signedUrls.expiresSeconds + ' seconds and use ' + spec.storage.signedUrls.signingSecretEnv + '.', ''
        ] : [])
      ] : [
        'S3 bucket environment: ' + spec.storage.s3.bucketEnv + '.', '',
        'S3 region environment: ' + spec.storage.s3.regionEnv + '.', '',
        'The generated runtime is compatible with AWS S3 and S3-compatible endpoints.', ''
      ]),
      'File fields are accepted through multipart/form-data on create/update routes. MIME type and maxBytes policies are enforced per field.', '',
      'Responses persist metadata only (key, originalName, mimeType, size, checksum, provider, uploadedAt) and add signed URLs at request time.', '',
      'Replacing or deleting records automatically cleans up the corresponding stored objects. Failed uploads are rolled back before the request completes.', '',
      'Read caching is disabled automatically for entities with signed file URLs so expired signed URLs are never served from cache.', ''
    ] : []),
    ...(spec.cache.enabled ? [
      '## Caching', '',
      'Cache provider: ' + spec.cache.provider + '.', '',
      'Default TTL: ' + spec.cache.defaultTtlSeconds + ' seconds.', '',
      ...(spec.cache.provider === 'redis' ? [
        'Redis connection environment: ' + spec.cache.redis.urlEnv + '.', ''
      ] : [
        'The generated in-memory cache is single-process only and is bounded to ' + spec.cache.memory.maxEntries + ' entries.', ''
      ]),
      'Only read operations explicitly enabling cache are cached. Successful create/update/delete operations and workflow mutations automatically invalidate affected entity generations.', '',
      'Cached reads vary by authenticated identity by default and return X-Cache: MISS or X-Cache: HIT.', '',
      'Relation-aware invalidation also bumps entities that reference a mutated entity.', ''
    ] : []),
    ...(spec.observability.enabled ? [
      '## Observability', '',
      ...(spec.observability.logging.enabled ? [
        'Structured logging: ' + spec.observability.logging.format + ' at ' + spec.observability.logging.level + ' level.', ''
      ] : []),
      ...(spec.observability.metrics.enabled ? [
        'Prometheus metrics: ' + spec.observability.metrics.path + ' with prefix ' + spec.observability.metrics.prefix + '.', ''
      ] : []),
      ...(spec.observability.health.liveness.enabled ? [
        'Liveness: ' + spec.observability.health.liveness.path + '.', ''
      ] : []),
      ...(spec.observability.health.readiness.enabled ? [
        'Readiness: ' + spec.observability.health.readiness.path + ' (database' +
          (spec.observability.health.readiness.outbox && spec.outbox.enabled ? ' + outbox' : '') + ').', ''
      ] : []),
      ...(spec.observability.tracing.enabled ? [
        'OpenTelemetry tracing: ' + spec.observability.tracing.exporter + ', service ' + spec.observability.tracing.serviceName +
          ', sample rate ' + spec.observability.tracing.sampleRate + '.', ''
      ] : []),
      'Request bodies and authentication headers are not included in generated request logs.', ''
    ] : []),
    ...(spec.api.graphql.enabled ? [
      '## GraphQL', '',
      'GraphQL endpoint: ' + spec.api.graphql.path + '.', '',
      'Generated queries use get<Entity> and list<Entities>; mutations use create/update/delete<Entity>.', '',
      'GraphQL exposes a backend-agnostic id: ID! even when the REST target uses MongoDB _id.', ''
    ] : []),
    '## Run', '',
    ...setup, '',
    'Default bind: ' + spec.app.host + ':' + spec.app.port + '.', '',
    ...deployment,
    '## Endpoints', '',
    ...endpointLines(spec), ''
  ].join('\n');
};
