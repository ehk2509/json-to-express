'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

function serverSource(spec) {
  const paths = filePaths(spec);
  return [
    "'use strict';", '',
    "require('dotenv').config();",
    'const validateEnvironment = require(' + js(relativeRequire(paths.server, paths.environment)) + ');',
    ...(spec.observability.enabled ? ['const observability = require(' + js(relativeRequire(paths.server, paths.observability)) + ');'] : []),
    'const app = require(' + js(relativeRequire(paths.server, paths.app)) + ');',
    'const connectDatabase = require(' + js(relativeRequire(paths.server, paths.database)) + ');',
    ...(spec.outbox.enabled && spec.outbox.worker === 'embedded' ? ['const outboxWorker = require(' + js(relativeRequire(paths.server, paths.worker)) + ');'] : []), '',
    'validateEnvironment();',
    'const port = Number(process.env[' + js(spec.app.portEnv) + '] || ' + spec.app.port + ');',
    'const host = process.env[' + js(spec.app.hostEnv) + '] || ' + js(spec.app.host) + ';',
    'let server;', '',
    'async function start() {',
    ...(spec.observability.enabled ? ['  await observability.startTracing();'] : []),
    '  await connectDatabase();',
    ...(spec.outbox.enabled && spec.outbox.worker === 'embedded' ? [
      spec.observability.enabled
        ? '  outboxWorker.startWorker().catch(error => observability.logger.error("worker.loop.failed", {error: error.message}));'
        : '  outboxWorker.startWorker().catch(error => console.error("Outbox worker failed:", error));'
    ] : []),
    '  server = app.listen(port, host, () => ' +
      (spec.observability.enabled
        ? 'observability.logger.info("server.started", {host, port})'
        : 'console.log(' + js(spec.app.startupMessage) + '.replace("{host}", host).replace("{port}", String(port)))') +
      ');',
    '}', '',
    'async function shutdown(signal) {',
    '  console.log(signal + " received, shutting down");',
    '  if (server) await new Promise(resolve => server.close(resolve));',
    ...(spec.outbox.enabled && spec.outbox.worker === 'embedded' ? ['  outboxWorker.stopWorker();'] : []),
    '  if (connectDatabase.disconnect) await connectDatabase.disconnect();',
    ...(spec.observability.enabled ? ['  await observability.shutdownTracing();'] : []),
    '}', '',
    "for (const signal of ['SIGTERM', 'SIGINT']) {",
    '  process.once(signal, () => shutdown(signal).then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); }));',
    '}', '',
    "start().catch(error => { " +
      (spec.observability.enabled
        ? "observability.logger.error('server.start.failed', {error: error.message});"
        : "console.error('Failed to start application:', error);") +
      " process.exitCode = 1; });", ''
  ].join('\n');
}

module.exports = serverSource;
