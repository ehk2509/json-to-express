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

  return Object.entries(values).map(([name, value]) => '      ' + name + ': ' + yamlScalar(value));
}

function appHealthcheck(spec, indent) {
  if (!spec.app.health.enabled) return [];
  const prefix = ' '.repeat(indent);
  const expression = "const p=process.env." + spec.app.portEnv + "||'" + spec.app.port +
    "';fetch('http://127.0.0.1:'+p+" + JSON.stringify(spec.app.health.path) +
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

  if (spec.deployment.compose.database) {
    lines.push(
      '    depends_on:',
      '      database:',
      '        condition: service_healthy'
    );
  }

  if (name === 'api') lines.push(...appHealthcheck(spec, 4));
  lines.push('    restart: unless-stopped');
  return lines;
}

module.exports = function composeSource(spec) {
  const lines = [
    'services:',
    ...serviceBlock('api', spec, null, true)
  ];

  if (spec.outbox.enabled && spec.outbox.worker === 'separate') {
    lines.push(...serviceBlock('worker', spec, '["npm", "run", "worker"]', false));
  }

  if (spec.deployment.compose.database) {
    lines.push(...databaseService(spec), '', 'volumes:', '  db-data:');
  }

  lines.push('');
  return lines.join('\n');
};
