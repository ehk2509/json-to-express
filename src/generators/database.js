'use strict';

const {js} = require('./utils');

// Unreachable databases must fail requests quickly instead of hanging them.
const MONGO_DEFAULT_OPTIONS = {serverSelectionTimeoutMS: 5000, timeoutMS: 10000};
const POSTGRES_URL_DEFAULTS = {connect_timeout: '5', pool_timeout: '5', socket_timeout: '10'};
const PING_TIMEOUT_MS = 2000;

function boundedPing(check) {
  return [
    'connectDatabase.ping = async () => {',
    '  let timer;',
    '  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error("Database ping timed out after ' + PING_TIMEOUT_MS + 'ms")), ' + PING_TIMEOUT_MS + '); });',
    '  try {',
    '    await Promise.race([(async () => {',
    ...check.map(line => '      ' + line),
    '    })(), timeout]);',
    '    return true;',
    '  } finally { clearTimeout(timer); }',
    '};'
  ];
}

module.exports = function databaseSource(spec) {
  if (spec.database.type === 'postgresql') {
    return [
      "'use strict';", '',
      "const {PrismaClient} = require('@prisma/client');", '',
      '// Explicit URL parameters win; otherwise bound connect, pool checkout and query time.',
      'function withTimeouts(raw) {',
      '  if (!raw) return raw;',
      '  try {',
      '    const url = new URL(raw);',
      '    for (const [name, value] of Object.entries(' + js(POSTGRES_URL_DEFAULTS) + ')) if (!url.searchParams.has(name)) url.searchParams.set(name, value);',
      '    return url.toString();',
      '  } catch { return raw; }',
      '}',
      'const databaseUrl = withTimeouts(process.env[' + js(spec.database.uriEnv) + ']);',
      'const prisma = databaseUrl ? new PrismaClient({datasources: {db: {url: databaseUrl}}}) : new PrismaClient();', '',
      'async function connectDatabase() {',
      '  await prisma.$connect();',
      '  return prisma;',
      '}', '',
      'connectDatabase.client = prisma;',
      'connectDatabase.disconnect = () => prisma.$disconnect();',
      ...boundedPing(['await prisma.$queryRawUnsafe("SELECT 1");']), '',
      'module.exports = connectDatabase;', ''
    ].join('\n');
  }

  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');", '',
    'async function connectDatabase() {',
    '  const uri = process.env[' + js(spec.database.uriEnv) + '];',
    "  if (!uri) throw new Error('Missing required environment variable " + spec.database.uriEnv + "');",
    '  await mongoose.connect(uri, ' + js({...MONGO_DEFAULT_OPTIONS, ...spec.database.options}) + ');',
    '  return mongoose.connection;',
    '}', '',
    'connectDatabase.client = mongoose;',
    'connectDatabase.disconnect = () => mongoose.disconnect();',
    ...boundedPing([
      'if (mongoose.connection.readyState !== 1) throw new Error("MongoDB is not connected");',
      'await mongoose.connection.db.admin().ping();'
    ]), '',
    'module.exports = connectDatabase;', ''
  ].join('\n');
};
