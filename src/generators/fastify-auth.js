'use strict';
const {filePaths, js, relativeRequire} = require('./utils');
module.exports = function fastifyAuthSource(spec) {
  const target = require('node:path').posix.join(spec.generation.paths.source, 'fastify-auth.js');
  const paths = filePaths(spec);
  const routes = spec.auth.routesEnabled ? [
    ...(spec.auth.local.enabled && spec.auth.local.allowRegistration ? [{url:spec.auth.local.registerPath,kind:'register'}] : []),
    ...(spec.auth.local.enabled ? [{url:spec.auth.local.loginPath,kind:'login'}] : []),
    ...(spec.auth.jwt.refresh.enabled ? [{url:spec.auth.jwt.refresh.path,kind:'refresh'}] : []),
    ...(spec.auth.local.enabled || spec.auth.session.enabled || spec.auth.jwt.refresh.enabled ? [{url:spec.auth.local.logoutPath,kind:'logout'}] : [])
  ] : [];
  return [
    "'use strict';",
    ...(routes.length ? [
      'const auth = require(' + js(relativeRequire(target,paths.auth)) + ');',
      ...(spec.auth.local.enabled ? ['const store = require(' + js(relativeRequire(target,paths.authStore)) + ');'] : [])
    ] : []),
    'const routes = ' + js(routes) + ';',
    'function responseBridge(reply) {',
    '  return {getHeader(key) {return reply.getHeader(key);}, setHeader(key, value) {reply.header(key, value);}};',
    '}',
    'function identity(user) { return {userId: String(user.id !== undefined ? user.id : user._id), email: user.email, roles: Array.isArray(user.roles) ? user.roles : []}; }',
    'function validEmail(value) {return typeof value === "string" && /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(value);}',
    'module.exports = function registerNativeAuth(fastify) {',
    '  for (const route of routes) fastify.post(route.url, async (request, reply) => {',
    '    const body = request.body || {};',
    '    if (route.kind === "refresh") {',
    '      const cookies = auth.parseCookies(request.raw);',
    '      const token = body.refreshToken || cookies[auth.config.jwt.refresh.cookieName];',
    '      try {return reply.code(200).send(await auth.rotateRefreshToken(token, responseBridge(reply)));}',
    '      catch (error) {return reply.code(error.statusCode || 401).send({error: error.message});}',
    '    }',
    '    if (route.kind === "logout") {',
    ...(spec.auth.session.enabled || spec.auth.jwt.refresh.enabled ? [
      '      try {await auth.revokeRequestTokens(request.raw, responseBridge(reply));}',
      '      catch (error) {return reply.code(error.statusCode || 401).send({error: error.message});}'
    ] : []),
    '      return reply.code(204).send();',
    '    }',
    '    const email = body.email;',
    '    const password = body.password;',
    '    if (route.kind === "register") {',
    '      if (!validEmail(email)) return reply.code(400).send({error: "Valid email is required"});',
    '      if (typeof password !== "string" || password.length < auth.config.local.passwordMinLength) return reply.code(400).send({error: "Password is too short"});',
    '      if (await store.findUserByEmail(email)) return reply.code(409).send({error: "Account already exists"});',
    '      let user;',
    '      try {user = await store.createUser({email, passwordHash: auth.hashPassword(password), roles: auth.config.local.defaultRoles});}',
    '      catch (error) {if (error.code === 11000 || error.code === "P2002") return reply.code(409).send({error: "Account already exists"}); throw error;}',
    '      return reply.code(201).send(await auth.issueCredentials(identity(user), responseBridge(reply)));',
    '    }',
    '    if (!validEmail(email) || typeof password !== "string") return reply.code(401).send({error: "Invalid credentials"});',
    '    const user = await store.findUserByEmail(email);',
    '    if (!user || !auth.verifyPassword(password, user.passwordHash)) return reply.code(401).send({error: "Invalid credentials"});',
    '    return reply.code(200).send(await auth.issueCredentials(identity(user), responseBridge(reply)));',
    '  });',
    '};',
    'module.exports.matches = (method, pathname) => method === "POST" && routes.some(route => route.url === pathname);',
    ''
  ].join('\n');
};
