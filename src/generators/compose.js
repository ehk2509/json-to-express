'use strict';

const {composeDatabaseUrl, databaseName, environmentContract, yamlScalar} = require('./deployment-utils');

function environmentLines(spec) {
  const contract = environmentContract(spec);
  const values = {...contract.config};
  values[spec.database.uriEnv] = spec.deployment.compose.database
    ? composeDatabaseUrl(spec)
    : '\${' + spec.database.uriEnv + ':-}';

  for (const name of Object.keys(contract.secrets)) {
    if (name === spec.database.uriEnv) continue;
    values[name] = '\${' + name + ':-}';
  }

  if (spec.cache.enabled && spec.cache.provider === 'redis') {
    values[spec.cache.redis.urlEnv] = 'redis://cache:6379';
  }

  return Object.entries(values).map(([name, value]) => '      ' + name + ': ' + yamlScalar(value));
}

function appHealthcheck(spec, indent) {
  const healthPath = spec.observability.health.readiness.enabled
    ? spec.observability.health.readiness.path
    : (spec.app.health.enabled ? spec.app.health.path : null);
  if (!healthPath) return [];
  const prefix = ' '.repeat(indent);
  const expression = "const p=process.env." + spec.app.portEnv + "||'" + spec.app.port +
    "';fetch('http://127.0.0.1:'+p+" + JSON.stringify(healthPath) +
    ").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))";
  return [
    prefix + 'healthcheck:',
    prefix + '  test: ["CMD", "node", "-e", ' + yamlScalar(expression) + ']',
    prefix + '  interval: 10s',
    prefix + '  timeout: 5s',
    prefix + '  retries: 5',
    prefix + '  start_period: 10s'
  ];
}

function databaseService(spec) {
  const name = databaseName(spec);
  if (spec.database.type === 'postgresql') {
    return [
      '  database:',
      '    image: postgres:16-alpine',
      '    environment:',
      '      POSTGRES_USER: "postgres"',
      '      POSTGRES_PASSWORD: "postgres"',
      '      POSTGRES_DB: ' + yamlScalar(name),
      '    volumes:',
      '      - db-data:/var/lib/postgresql/data',
      '    healthcheck:',
      '      test: ["CMD-SHELL", ' + yamlScalar('pg_isready -U postgres -d ' + name) + ']',
      '      interval: 5s',
      '      timeout: 5s',
      '      retries: 10'
    ];
  }

  return [
    '  database:',
    '    image: mongo:7',
    '    volumes:',
    '      - db-data:/data/db',
    '    healthcheck:',
    '      test: ["CMD", "mongosh", "--quiet", "--eval", "quit(db.runCommand({ping:1}).ok ? 0 : 2)"]',
    '      interval: 5s',
    '      timeout: 5s',
    '      retries: 10'
  ];
}

function cacheService(spec) {
  if (!spec.cache.enabled || spec.cache.provider !== 'redis') return [];
  return [
    '  cache:',
    '    image: redis:7-alpine',
    '    command: ["redis-server", "--save", "", "--appendonly", "no"]',
    '    healthcheck:',
    '      test: ["CMD", "redis-cli", "ping"]',
    '      interval: 5s',
    '      timeout: 3s',
    '      retries: 10',
    '    restart: unless-stopped'
  ];
}

function serviceBlock(name, spec, command, exposePort) {
  const dockerfile = spec.deployment.docker.file;
  const lines = [
    '  ' + name + ':',
    '    build:',
    '      context: .',
    '      dockerfile: ' + yamlScalar(dockerfile)
  ];

  if (command) lines.push('    command: ' + command);
  if (exposePort) {
    lines.push(
      '    ports:',
      '      - ' + yamlScalar(spec.deployment.compose.apiPort + ':' + spec.app.port)
    );
  }

  lines.push('    environment:', ...environmentLines(spec));
  if (name === 'api' && spec.storage.enabled && spec.storage.provider === 'local') {
    lines.push('    volumes:', '      - ' + yamlScalar('file-data:/app/' + spec.storage.local.directory));
  }

  const dependencies = [];
  if (spec.deployment.compose.database) {
    if (spec.database.type === 'postgresql') dependencies.push(['migrate', 'service_completed_successfully']);
    else dependencies.push(['database', 'service_healthy']);
  }
  if (spec.cache.enabled && spec.cache.provider === 'redis') dependencies.push(['cache', 'service_healthy']);
  if (dependencies.length) {
    lines.push('    depends_on:');
    for (const [dependency, condition] of dependencies) lines.push('      ' + dependency + ':', '        condition: ' + condition);
  }

  if (name === 'api') lines.push(...appHealthcheck(spec, 4));
  lines.push('    restart: unless-stopped');
  return lines;
}

function migrationService(spec) {
  if (!spec.deployment.compose.database || spec.database.type !== 'postgresql') return [];
  return [
    '  migrate:',
    '    build:',
    '      context: .',
    '      dockerfile: ' + yamlScalar(spec.deployment.docker.file),
    '      target: build',
    '    command: ["npm", "run", "db:push"]',
    '    environment:',
    ...environmentLines(spec),
    '    depends_on:',
    '      database:',
    '        condition: service_healthy',
    '    restart: "no"'
  ];
}

module.exports = function composeSource(spec) {
  const lines = [
    'services:',
    ...serviceBlock('api', spec, null, true)
  ];

  if (spec.outbox.enabled && spec.outbox.worker === 'separate') {
    lines.push(...serviceBlock('worker', spec, '["npm", "run", "worker"]', false));
  }

  lines.push(...migrationService(spec));
  lines.push(...cacheService(spec));

  if (spec.deployment.compose.database) lines.push(...databaseService(spec));

  const volumes = [];
  if (spec.deployment.compose.database) volumes.push('  db-data:');
  if (spec.storage.enabled && spec.storage.provider === 'local') volumes.push('  file-data:');
  if (volumes.length) lines.push('', 'volumes:', ...volumes);

  lines.push('');
  return lines.join('\n');
};
