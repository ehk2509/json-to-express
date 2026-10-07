'use strict';

const {js} = require('./utils');

function serverSource(spec) {
  return [
    "'use strict';", '',
    "require('dotenv').config();",
    "const app = require('./app');",
    "const connectDatabase = require('./config/database');", '',
    'const port = Number(process.env[' + js(spec.app.portEnv) + '] || ' + spec.app.port + ');',
    'const host = process.env[' + js(spec.app.hostEnv) + '] || ' + js(spec.app.host) + ';', '',
    'async function start() {',
    '  await connectDatabase();',
    '  app.listen(port, host, () => console.log(' + js(spec.app.startupMessage) + '.replace("{host}", host).replace("{port}", String(port))));',
    '}', '',
    "start().catch(error => { console.error('Failed to start application:', error); process.exitCode = 1; });", ''
  ].join('\n');
}

module.exports = serverSource;
