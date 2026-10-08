'use strict';

module.exports = function dockerfileSource(spec) {
  const docker = spec.deployment.docker;
  const lines = [
    'FROM ' + docker.nodeImage + ' AS build',
    'WORKDIR /app',
    'COPY package*.json ./',
    'RUN npm install --no-audit --no-fund',
    'COPY . .'
  ];

  if (spec.database.type === 'postgresql') lines.push('RUN npm run prisma:generate');

  lines.push(
    'RUN npm prune --omit=dev',
    '',
    'FROM ' + docker.nodeImage + ' AS runtime',
    'WORKDIR /app',
    'ENV NODE_ENV=production',
    'COPY --from=build --chown=node:node /app /app',
    ...(spec.storage.enabled && spec.storage.provider === 'local'
      ? ['RUN mkdir -p ' + JSON.stringify('/app/' + spec.storage.local.directory) + ' && chown -R node:node ' + JSON.stringify('/app/' + spec.storage.local.directory)]
      : []),
    'USER node',
    'EXPOSE ' + spec.app.port
  );

  const healthPath = spec.observability.health.readiness.enabled
    ? spec.observability.health.readiness.path
    : (spec.app.health.enabled ? spec.app.health.path : null);
  if (docker.healthcheck && healthPath) {
    const healthScript =
      "const p=process.env." + spec.app.portEnv + "||'" + spec.app.port +
      "';fetch('http://127.0.0.1:'+p+'" + healthPath +
      "').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))";
    lines.push(
      'HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ' +
      JSON.stringify(['node', '-e', healthScript])
    );
  }

  lines.push('CMD ["npm", "start"]', '');
  return lines.join('\n');
};

module.exports.ignoreSource = function dockerignoreSource(spec) {
  return [
    'node_modules',
    'npm-debug.log*',
    '.env',
    ...(spec && spec.storage && spec.storage.enabled && spec.storage.provider === 'local' ? [spec.storage.local.directory] : []),
    '.env.*',
    '!.env.example',
    '.git',
    '.github',
    '.tmp',
    'coverage',
    '*.log',
    ''
  ].join('\n');
};
