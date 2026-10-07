'use strict';

const {js} = require('./utils');

module.exports = function databaseSource(spec) {
  return [
    "'use strict';", '',
    "const mongoose = require('mongoose');", '',
    'async function connectDatabase() {',
    '  const uri = process.env[' + js(spec.database.uriEnv) + '];',
    "  if (!uri) throw new Error('Missing required environment variable " + spec.database.uriEnv + "');",
    '  await mongoose.connect(uri, ' + js(spec.database.options) + ');',
    '  return mongoose.connection;',
    '}', '',
    'module.exports = connectDatabase;', ''
  ].join('\n');
};
