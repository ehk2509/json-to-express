'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

function invalidationMap(spec) {
  const result = Object.fromEntries(spec.entities.map(entity => [entity.name, new Set([entity.name])]));
  for (const source of spec.entities) {
    for (const field of source.fields) {
      if (field.type === 'reference' && result[field.ref]) result[field.ref].add(source.name);
    }
  }
  return Object.fromEntries(Object.entries(result).map(([name, values]) => [name, [...values].sort()]));
}

module.exports = function cacheSource(spec) {
  if (!spec.cache.enabled) return null;
  const paths = filePaths(spec);
  const config = spec.cache;
  const affected = invalidationMap(spec);

  return [
    "'use strict';", '',
    "const crypto = require('node:crypto');",
    ...(config.provider === 'redis' ? ["const {createClient} = require('redis');"] : []),
    ...(spec.observability.enabled
      ? ['const observability = require(' + js(relativeRequire(paths.cache, paths.observability)) + ');']
      : []),
    '',
    'const config = ' + js(config) + ';',
    'const affectedEntities = ' + js(affected) + ';',
    'const memoryEntries = new Map();',
    'const memoryVersions = new Map();',
    ...(config.provider === 'redis' ? [
      'let redis = null;',
      'let redisConnectPromise = null;'
    ] : []),
    '',
    'function report(event, error, fields = {}) {',
    ...(spec.observability.enabled
      ? ['  observability.logger.warn(event, {...fields, error: error && error.message});']
      : ['  console.warn(event + ": " + (error && error.message || error));']),
    '}',
    '',
    'function stableValue(value) {',
    '  if (value === undefined) return null;',
    '  if (Array.isArray(value)) return value.map(stableValue);',
    '  if (value && typeof value === "object") {',
    '    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));',
    '  }',
    '  return value;',
    '}',
    'function stableStringify(value) { return JSON.stringify(stableValue(value)); }',
    '',
    'function authScope(req, varyByAuth) {',
    '  if (!varyByAuth) return "public";',
    '  if (!req.auth) return "anonymous";',
    '  return stableStringify({',
    '    userId: req.auth.userId === undefined ? null : String(req.auth.userId),',
    '    strategy: req.auth.strategy || null,',
    '    roles: Array.isArray(req.auth.roles) ? [...req.auth.roles].map(String).sort() : []',
    '  });',
    '}',
    '',
    'function versionKey(entity) { return config.prefix + "version:" + entity; }',
    'function entryKey(entity, operation, version, req, policy) {',
    '  const material = stableStringify({',
    '    params: req.params || {}, query: req.query || {}, auth: authScope(req, policy.varyByAuth)',
    '  });',
    '  const digest = crypto.createHash("sha256").update(material).digest("hex");',
    '  return config.prefix + "entry:" + entity + ":" + version + ":" + operation + ":" + digest;',
    '}',
    '',
    ...(config.provider === 'redis' ? [
      'async function client() {',
      '  if (redis && redis.isReady) return redis;',
      '  if (!redis) {',
      '    redis = createClient({',
      '      url: process.env[config.redis.urlEnv],',
      '      socket: {connectTimeout: config.redis.connectTimeoutMs}',
      '    });',
      '    redis.on("error", error => report("cache.redis.error", error));',
      '  }',
      '  if (!redisConnectPromise) redisConnectPromise = redis.connect().finally(() => { redisConnectPromise = null; });',
      '  await redisConnectPromise;',
      '  return redis;',
      '}',
      ''
    ] : []),
    'async function getVersion(entity) {',
    '  try {',
    ...(config.provider === 'redis'
      ? [
        '    const value = await (await client()).get(versionKey(entity));',
        '    return value || "0";'
      ]
      : ['    return String(memoryVersions.get(entity) || 0);']),
    '  } catch (error) { report("cache.version.read_failed", error, {entity}); return "0"; }',
    '}',
    '',
    'async function read(key) {',
    '  try {',
    ...(config.provider === 'redis'
      ? [
        '    const value = await (await client()).get(key);',
        '    return value === null ? null : JSON.parse(value);'
      ]
      : [
        '    const item = memoryEntries.get(key);',
        '    if (!item) return null;',
        '    if (item.expiresAt <= Date.now()) { memoryEntries.delete(key); return null; }',
        '    memoryEntries.delete(key); memoryEntries.set(key, item);',
        '    return item.value;'
      ]),
    '  } catch (error) { report("cache.read_failed", error); return null; }',
    '}',
    '',
    'async function write(key, value, ttlSeconds) {',
    '  try {',
    ...(config.provider === 'redis'
      ? ['    await (await client()).setEx(key, ttlSeconds, JSON.stringify(value));']
      : [
        '    if (memoryEntries.size >= config.memory.maxEntries && !memoryEntries.has(key)) {',
        '      const oldest = memoryEntries.keys().next().value;',
        '      if (oldest !== undefined) memoryEntries.delete(oldest);',
        '    }',
        '    const snapshot = JSON.parse(JSON.stringify(value));',
        '    memoryEntries.set(key, {value: snapshot, expiresAt: Date.now() + ttlSeconds * 1000});'
      ]),
    '    return true;',
    '  } catch (error) { report("cache.write_failed", error); return false; }',
    '}',
    '',
    'async function bump(entity) {',
    '  try {',
    ...(config.provider === 'redis'
      ? ['    await (await client()).incr(versionKey(entity));']
      : ['    memoryVersions.set(entity, (memoryVersions.get(entity) || 0) + 1);']),
    '    return true;',
    '  } catch (error) { report("cache.invalidate_failed", error, {entity}); return false; }',
    '}',
    '',
    'async function invalidateEntity(entity) {',
    '  const entities = affectedEntities[entity] || [entity];',
    '  await Promise.all(entities.map(bump));',
    '}',
    'async function invalidateMany(entities) {',
    '  const expanded = new Set();',
    '  for (const entity of entities) for (const item of affectedEntities[entity] || [entity]) expanded.add(item);',
    '  await Promise.all([...expanded].map(bump));',
    '}',
    '',
    'function mark(res, value) { if (res && typeof res.setHeader === "function") res.setHeader("X-Cache", value); }',
    '',
    'function cacheController(entity, operation, policy, handler) {',
    '  if (!policy || !policy.enabled) return handler;',
    '  return async function cachedController(req, res, next) {',
    '    const version = await getVersion(entity);',
    '    const key = entryKey(entity, operation, version, req, policy);',
    '    const cached = await read(key);',
    '    if (cached !== null) {',
    '      mark(res, "HIT");',
    '      return res.status(cached.status || 200).json(cached.body);',
    '    }',
    '    mark(res, "MISS");',
    '    const originalJson = res.json.bind(res);',
    '    res.json = async body => {',
    '      if (res.statusCode >= 200 && res.statusCode < 300) {',
    '        await write(key, {status: res.statusCode, body}, policy.ttlSeconds);',
    '      }',
    '      return originalJson(body);',
    '    };',
    '    return handler(req, res, next);',
    '  };',
    '}',
    '',
    'function invalidateController(entity, handler) {',
    '  return async function invalidatingController(req, res, next) {',
    '    let invalidated = false;',
    '    const invalidate = async () => {',
    '      if (invalidated || res.statusCode < 200 || res.statusCode >= 300) return;',
    '      invalidated = true;',
    '      await invalidateEntity(entity);',
    '    };',
    '    const originalJson = res.json.bind(res);',
    '    const originalEnd = res.end.bind(res);',
    '    res.json = async body => { await invalidate(); return originalJson(body); };',
    '    res.end = async (...args) => { await invalidate(); return originalEnd(...args); };',
    '    return handler(req, res, next);',
    '  };',
    '}',
    '',
    'async function disconnect() {',
    ...(config.provider === 'redis'
      ? [
        '  try { if (redis && redis.isOpen) await redis.quit(); }',
        '  catch (error) { report("cache.disconnect_failed", error); }',
        '  redis = null; redisConnectPromise = null;'
      ]
      : ['  memoryEntries.clear();']),
    '}',
    '',
    'module.exports = {cacheController, invalidateController, invalidateEntity, invalidateMany, disconnect};',
    ''
  ].join('\n');
};
