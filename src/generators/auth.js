'use strict';

const {js} = require('./utils');

module.exports = function authSource(spec) {
  if (!spec.auth.enabled) return null;
  return [
    "'use strict';", '',
    "const jwt = require('jsonwebtoken');", '',
    'function readAuth(req, options = {}) {',
    "  const header = req.headers.authorization || '';",
    "  const token = header.startsWith('Bearer ') ? header.slice(7) : null;",
    "  if (!token) {",
    "    if (options.required === false) return null;",
    "    const error = new Error('Authentication required'); error.statusCode = 401; throw error;",
    '  }',
    '  try {',
    '    const payload = jwt.verify(token, process.env[' + js(spec.auth.secretEnv) + '], {algorithms: ' + js(spec.auth.algorithms) + '});',
    '    return {',
    '      userId: payload[' + js(spec.auth.userClaim) + '],',
    '      roles: Array.isArray(payload[' + js(spec.auth.rolesClaim) + ']) ? payload[' + js(spec.auth.rolesClaim) + '] : []',
    '    };',
    "  } catch (error) { const authError = new Error('Invalid or expired token'); authError.statusCode = 401; throw authError; }",
    '}', '',
    'function authenticate(req, res, next) {',
    '  try { req.auth = readAuth(req); next(); }',
    "  catch (error) { return res.status(error.statusCode || 401).json({error: error.message}); }",
    '}', '',
    'function requireRoles(roles) {',
    '  return function authorize(req, res, next) {',
    "    if (!req.auth) return res.status(401).json({error: 'Authentication required'});",
    '    if (!roles.every(role => req.auth.roles.includes(role))) return res.status(403).json({error: "Forbidden"});',
    '    next();',
    '  };',
    '}', '',
    'module.exports = {authenticate, requireRoles, readAuth};', ''
  ].join('\n');
};
