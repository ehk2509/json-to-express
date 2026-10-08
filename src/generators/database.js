'use strict';

const {js} = require('./utils');

module.exports = function databaseSource(spec) {
  if (spec.database.type === 'postgresql') {
    return [
      "'use strict';", '',
      "const {PrismaClient} = require('@prisma/client');",
      'const prisma = new PrismaClient();', '',
      'async function connectDatabase() {',
      '  await prisma.$connect();',
      '  return prisma;',
      '}', '',
      'connectDatabase.client = prisma;',
      'connectDatabase.disconnect = () => prisma.$disconnect();',
      'connectDatabase.ping = async () => { await prisma.$queryRawUnsafe("SELECT 1"); return true; };', ''
      'module.exports = connectDatabase;', ''
    ].join('\n');
  }

  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');", '',
    'async function connectDatabase() {',
    '  const uri = process.env[' + js(spec.database.uriEnv) + '];',
    "  if (!uri) throw new Error('Missing required environment variable " + spec.database.uriEnv + "');",
    '  await mongoose.connect(uri, ' + js(spec.database.options) + ');',
    '  return mongoose.connection;',
    '}', '',
    'connectDatabase.client = mongoose;',
    'connectDatabase.disconnect = () => mongoose.disconnect();',
    'connectDatabase.ping = async () => {',
    '  if (mongoose.connection.readyState !== 1) throw new Error("MongoDB is not connected");',
    '  await mongoose.connection.db.admin().ping();',
    '  return true;',
    '};', ''
    'module.exports = connectDatabase;', ''
  ].join('\n');
};
