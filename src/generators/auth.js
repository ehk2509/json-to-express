'use strict';

const {js} = require('./utils');

module.exports = function authSource(spec) {
  if (!spec.auth.enabled) return null;
  return [
    "'use strict';", '',
    "const jwt = require('jsonwebtoken');", '',
    'function authenticate(req, res, next) {',
    "  const header = req.headers.authorization || '';",
    "  const token = header.startsWith('Bearer ') ? header.slice(7) : null;",
    "  if (!token) return res.status(401).json({error: 'Authentication required'});",
    '  try {',
    '    const payload = jwt.verify(token, process.env[' + js(spec.auth.secretEnv) + '], {algorithms: ' + js(spec.auth.algorithms) + '});',
    '    req.auth = {',
    '      userId: payload[' + js(spec.auth.userClaim) + '],',
    '      roles: Array.isArray(payload[' + js(spec.auth.rolesClaim) + ']) ? payload[' + js(spec.auth.rolesClaim) + '] : []',
    '    };',
    '    next();',
    "  } catch (error) { return res.status(401).json({error: 'Invalid or expired token'}); }",
    '}', '',
    'function requireRoles(roles) {',
    '  return function authorize(req, res, next) {',
    "    if (!req.auth) return res.status(401).json({error: 'Authentication required'});",
    '    if (!roles.every(role => req.auth.roles.includes(role))) return res.status(403).json({error: "Forbidden"});',
    '    next();',
    '  };',
    '}', '',
    'module.exports = {authenticate, requireRoles};', ''
  ].join('\n');
};
