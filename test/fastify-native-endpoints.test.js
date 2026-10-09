'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {normalizeSpec} = require('../src');
const {buildFiles} = require('../src/generators');

test('Fastify generated workflow endpoints are native and preserve auth and response handling', () => {
  const base = {
    specVersion: '1.0',
    app: {name: 'native-workflows', framework: 'fastify'},
    database: {type: 'mongodb'},
    entities: {Todo: {fields: {name: {type: 'string'}}}},
    workflows: {doWork: {steps:[{name:'reply',action:'respond',status:202,body:{ok:true}}]}},
    endpoints: {work: {method:'post',path:'/work',workflow:'doWork',status:202}}
  };
  const files = buildFiles(normalizeSpec(base));
  const source = files.get('src/fastify-endpoints.js');
  assert.match(source, /fastify.route/);
  assert.match(source, /workflows.execute/);
  assert.match(files.get('src/app.js'), /register2\(fastify\)/);
  new vm.Script(source);
});

test('Express generation does not create native workflow endpoints', () => {
  const source = buildFiles(normalizeSpec({
    specVersion: '1.0', app: {name:'express-isolated'},
    database: {type:'mongodb'},
    entities: {Todo:{fields:{name:{type:'string'}}}}
  }));
  assert.equal(source.has('src/fastify-endpoints.js'), false);
});

test('GraphQL uses a Fastify route and generated native executor', () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name: 'native-graphql', framework: 'fastify'},
    database: {type: 'mongodb'},
    api: {graphql: {enabled: true}},
    entities: {Todo: {fields: {name: {type: 'string'}}}}
  });
  const files = buildFiles(spec);
  assert.match(files.get('src/fastify-native.js'), /graphqlApi.fastifyHandler/);
  assert.match(files.get('src/graphql/index.js'), /async function fastifyHandler/);
  assert.match(files.get('src/graphql/index.js'), /contextValue: \{req, \.\.\.loaders\}/);
  new vm.Script(files.get('src/graphql/index.js'));
});

test('Fastify rate limit and compression use native plugins when enabled', () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name: 'native-plugins', framework: 'fastify', production: {
      rateLimit: {enabled:true,max:15,windowMs:60000}, compression:true
    }},
    database: {type:'mongodb'},
    entities: {Todo:{fields:{name:{type:'string'}}}}
  });
  const files = buildFiles(spec);
  const pkg = JSON.parse(files.get('package.json'));
  assert.ok(pkg.dependencies['@fastify/rate-limit']);
  assert.ok(pkg.dependencies['@fastify/compress']);
  assert.match(files.get('src/app.js'), /@fastify\/rate-limit/);
  assert.match(files.get('src/app.js'), /@fastify\/compress/);
});

test('native Fastify local auth register and login emit Fastify handlers', () => {
  const spec = normalizeSpec({
    specVersion: '1.0', app: {name:'fastify-local-auth',framework:'fastify'},
    database: {type:'mongodb'},
    auth: {enabled:true, strategies:['jwt'], jwt:{secretEnv:'TEST_JWT_SECRET'}, local:{enabled:true,allowRegistration:true}},
    entities: {Todo:{fields:{name:{type:'string'}}}}
  });
  const files = buildFiles(spec);
  const source = files.get('src/fastify-auth.js');
  assert.match(source,/fastify.post/);
  assert.match(source,/auth.issueCredentials/);
  assert.match(source,/auth.verifyPassword/);
  assert.match(files.get('src/app.js'),/register3\(fastify\)/);
  new vm.Script(source);
});

test('Fastify OIDC routes delegate PKCE state handling to shared auth engine', () => {
  const spec = normalizeSpec({
    specVersion: '1.0', app: {name:'fastify-oidc-native',framework:'fastify'},
    database: {type:'mongodb'},
    auth: {enabled:true,strategies:['oidc'],oidc:{enabled:true,issuer:'https://issuer.example',audience:'client',clientIdEnv:'OIDC_CLIENT_ID'}},
    entities: {Todo:{fields:{name:{type:'string'}}}}
  });
  const files = buildFiles(spec);
  const native = files.get('src/fastify-auth.js');
  assert.match(native, /auth.beginOidc/);
  assert.match(native, /auth.completeOidc/);
  assert.match(native, /oidcRoutes.callback/);
  new vm.Script(native);
});

test('native Fastify observability intercepts native routes only to avoid duplicate Express metrics', () => {
  const spec = normalizeSpec({specVersion:'1.0',app:{name:'native-observable',framework:'fastify'},database:{type:'mongodb'},observability:{enabled:true},entities:{Todo:{fields:{title:{type:'string'}}}}});
  const files=buildFiles(spec);
  const native=files.get('src/app.js');
  assert.match(native,/observability.requestMiddleware\(request.raw, reply.raw, done\)/);
  assert.match(native,/register1\(fastify\)/);
  new vm.Script(server);
});

test('custom middleware can supply a native Fastify onRequest hook without touching fallback routes', () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name: 'native-middleware', framework: 'fastify', middlewareModules: ['src/middleware/tenant.js']},
    database: {type: 'mongodb'},
    entities: {Todo: {fields: {title: {type: 'string'}}}}
  });
  const files = buildFiles(spec);
  const server = files.get('src/server.js');
  assert.match(server, /middleware\.fastifyOnRequest/);
  assert.match(server, /fastify\.addHook\("onRequest"/);
  assert.match(server, /registerNativeCrud\.matches\(request\.raw\.method, pathname\)/);
  assert.match(server, /await middleware\.fastifyOnRequest\(request, reply\)/);
  new vm.Script(server);
});

test('native middleware lifecycle hooks register and execute on native routes', async () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name: 'native-lifecycle', framework: 'fastify', middlewareModules: ['src/middleware/check.js']},
    database: {type: 'mongodb'},
    entities: {Todo: {fields: {title: {type: 'string'}}}}
  });
  const server = buildFiles(spec).get('src/server.js');
  const hooks = {};
  const calls = [];
  const middleware = {
    fastifyOnRequest: async () => calls.push('request'),
    fastifyPreValidation: async () => calls.push('validation'),
    fastifyPreHandler: async () => calls.push('handler'),
    fastifyPreSerialization: async (req, reply, payload) => ({...payload, serialized: true}),
    fastifyOnSend: async (req, reply, payload) => String(payload) + ':sent',
    fastifyOnError: async () => calls.push('error'),
    fastifyOnResponse: async () => calls.push('response')
  };
  const fakeFastify = {
    register: async () => {},
    use: () => {},
    addHook: (stage, fn) => { (hooks[stage] ||= []).push(fn); },
    listen: async () => {},
    close: async () => {}
  };
  const match = (method, pathname) => method === 'GET' && pathname === '/api/todos';
  const mockModule = {matches: match, default: () => {}};
  const required = name => {
    if (name === 'dotenv') return {config: () => {}};
    if (name === 'fastify') return () => fakeFastify;
    if (name === '@fastify/express') return async () => {};
    if (name.includes('check')) return middleware;
    if (name.includes('environment')) return () => {};
    if (name.includes('database')) return Object.assign(async () => {}, {disconnect: async () => {}});
    if (name.includes('fastify-')) return Object.assign(() => {}, {matches: match});
    if (name.includes('app')) return () => {};
    throw new Error('Unexpected generated server dependency: ' + name);
  };
  vm.runInNewContext(server, {
    require: required,
    process: {env: {}, once: () => {}, exitCode: 0},
    console: {log: () => {}, error: () => {}}
  });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const native = {raw: {method: 'GET', url: '/api/todos'}};
  const fallback = {raw: {method: 'GET', url: '/fallback'}};
  const reply = {};
  for (const stage of ['onRequest', 'preValidation', 'preHandler']) {
    assert.equal(hooks[stage].length, 1);
    await hooks[stage][0](native, reply);
    await hooks[stage][0](fallback, reply);
  }
  assert.deepEqual(calls, ['request', 'validation', 'handler']);
  assert.equal((await hooks.preSerialization[0](native, reply, {ok:true})).serialized, true);
  assert.equal((await hooks.preSerialization[0](fallback, reply, {ok:true})).serialized, undefined);
  assert.equal(await hooks.onSend[0](native, reply, 'value'), 'value:sent');
  assert.equal(await hooks.onSend[0](fallback, reply, 'value'), 'value');
  await hooks.onError[0](native, reply, new Error('boom'));
  await hooks.onError[0](fallback, reply, new Error('boom'));
  await hooks.onResponse[0](native, reply);
  await hooks.onResponse[0](fallback, reply);
  assert.deepEqual(calls, ['request', 'validation', 'handler', 'error', 'response']);
});

test('audited PostgreSQL entities use native CRUD and protect audit attribution', () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name: 'native-postgres-audit', framework: 'fastify'},
    database: {type: 'postgresql'},
    entities: {Todo: {fields: {title: {type: 'string'}}, audit: {enabled: true}}}
  });
  const files = buildFiles(spec);
  const native = files.get('src/fastify-crud.js');
  assert.match(native, /"name":"Todo"/);
  assert.match(native, /delete data\[entry.audit.createdBy\]/);
  assert.match(native, /delete data\[entry.audit.updatedBy\]/);
  assert.match(native, /data\[entry.audit.createdBy\] = request.raw.auth.userId/);
  assert.match(native, /data\[entry.audit.updatedBy\] = request.raw.auth.userId/);
  new vm.Script(native);
});

test('PostgreSQL soft-delete entities stay native and filter tombstones', () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name:'postgres-soft-native', framework:'fastify'},
    database: {type:'postgresql'},
    entities: {Todo: {fields: {title: {type:'string'}}, softDelete:{enabled:true}}}
  });
  const source = buildFiles(spec).get('src/fastify-crud.js');
  assert.match(source, /"name":"Todo"/);
  assert.match(source, /model.findFirst\(\{where: liveFilter\(entry, \{id\}\)/);
  assert.match(source, /rows = await model.findMany\(\{where: conditions/);
  const planner = buildFiles(spec).get('src/fastify-postgres-delete.js');
  assert.match(source, /postgresDelete\(tx, entry.name, id\)/);
  assert.match(planner, /meta.softDelete.enabled && !forceHard/);
  new vm.Script(source);
});

test('PostgreSQL transactional writes use Prisma interactive transactions', () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name:'postgres-native-transaction', framework:'fastify'},
    database: {type:'postgresql'},
    entities: {Todo: {fields: {title: {type:'string'}}, operations: {
      create: {transaction:true}, update: {transaction:true}, delete: {transaction:true}
    }}}
  });
  const source = buildFiles(spec).get('src/fastify-crud.js');
  assert.match(source, /"name":"Todo"/);
  assert.match(source, /connectDatabase.client.\$transaction\(async tx => work/);
  assert.match(source, /isolationLevel: "Serializable"/);
  assert.match(source, /op.transaction && !await delegate.findFirst/);
  assert.match(source, /postgresTransaction\(entry, op.transaction, delegate => delegate.create/);
  assert.match(source, /postgresTransaction\(entry, op.transaction, async delegate =>/);
  assert.match(source, /postgresDelete\(tx, entry.name, id\)/);
  new vm.Script(source);
});

test('PostgreSQL update and soft-delete writes are guarded against concurrent tombstones', () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name:'postgres-concurrent-soft-delete',framework:'fastify'},
    database: {type:'postgresql'},
    entities: {Todo: {fields: {title: {type:'string'}}, softDelete:{enabled:true}}}
  });
  const source = buildFiles(spec).get('src/fastify-crud.js');
  assert.match(source, /delegate.update\(\{where: liveFilter\(entry, \{id\}\), data: writeData/);
  assert.match(buildFiles(spec).get('src/fastify-postgres-delete.js'), /meta.softDelete.enabled && !forceHard/);
  new vm.Script(source);
});

test('native PostgreSQL CRUD maps concurrent missing-record writes to not found', () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name:'postgres-race-safe', framework:'fastify'},
    database: {type:'postgresql'},
    entities: {Todo:{fields:{title:{type:'string'}},softDelete:{enabled:true},operations:{update:{transaction:true},delete:{transaction:true}}}}
  });
  const source = buildFiles(spec).get('src/fastify-crud.js');
  assert.match(source, /error.code === "P2025"/);
  assert.match(source, /reply.code\(op.notFoundStatus \|\| 404\)/);
  assert.match(source, /error.code === "P2003"/);
  new vm.Script(source);
});

test('PostgreSQL soft-delete parent applies inbound policies in one Prisma transaction', () => {
  for (const onDelete of ['restrict', 'nullify', 'cascade']) {
    const spec = normalizeSpec({
      specVersion: '1.0',
      app: {name:'postgres-soft-relation',framework:'fastify'},
      database: {type:'postgresql'},
      entities: {
        User: {fields: {name: {type:'string'}}, softDelete: {enabled:true}},
        Post: {fields: {title: {type:'string'}, author: {type:'reference', ref:'User', onDelete}}}
      }
    });
    const source = buildFiles(spec).get('src/fastify-crud.js');
    assert.match(source, /"name":"User"/);
    const planner = buildFiles(spec).get('src/fastify-postgres-delete.js');
    assert.match(source, /postgresDelete\(tx, entry.name, id\)/);
    assert.match(source, /isolationLevel: "Serializable"/);
    assert.match(planner, /relation.onDelete === "restrict"/);
    assert.match(planner, /relation.onDelete === "nullify"/);
    assert.match(planner, /relation.onDelete === "cascade"/);
    new vm.Script(planner);
    new vm.Script(source);
  }
});

test('PostgreSQL serializable transactions retry P2034 at most twice', () => {
  const spec = normalizeSpec({
    specVersion: '1.0', app: {name: 'postgres-conflict-retry', framework: 'fastify'},
    database: {type: 'postgresql'},
    entities: {Todo: {fields: {title: {type: 'string'}}, operations: {update: {transaction: true}}}}
  });
  const source = buildFiles(spec).get('src/fastify-crud.js');
  assert.match(source, /attempt < 3/);
  assert.match(source, /error.code !== "P2034" \|\| attempt === 2/);
  assert.match(source, /isolationLevel: "Serializable"/);
  new vm.Script(source);
});

test('PostgreSQL native hooks are loaded alongside transactional and soft-delete routes', () => {
  const spec = normalizeSpec({
    specVersion:'1.0',
    app:{name:'postgres-hook-parity',framework:'fastify'},
    database:{type:'postgresql'},
    entities:{Todo:{
      fields:{title:{type:'string'}},
      hooks:{module:'src/hooks/todo.js',before:{create:'beforeCreate'},after:{create:'afterCreate'}},
      softDelete:{enabled:true},
      operations:{create:{transaction:true},update:{transaction:true},delete:{transaction:true}}
    }}
  });
  const source=buildFiles(spec).get('src/fastify-crud.js');
  assert.match(source, /"name":"Todo"/);
  assert.match(source, /const hooksTodo = require/);
  assert.match(source, /"Todo": hooksTodo/);
  assert.match(source, /callHook\(entry, "before", action/);
  assert.match(source, /callHook\(entry, "after", action/);
  new vm.Script(source);
});

test('PostgreSQL recursive relation deletion planner includes multi-hop and many-to-many policies', () => {
  const spec = normalizeSpec({
    specVersion:'1.0',app:{name:'pg-recursive',framework:'fastify'},database:{type:'postgresql'},
    entities:{
      Account:{fields:{name:{type:'string'}},softDelete:{enabled:true}},
      Project:{fields:{account:{type:'reference',ref:'Account',onDelete:'cascade'}},softDelete:{enabled:true}},
      Task:{fields:{project:{type:'reference',ref:'Project',onDelete:'cascade'}}},
      Label:{fields:{accounts:{type:'reference',ref:'Account',many:true,onDelete:'nullify'}}}
    }
  });
  const files=buildFiles(spec);
  const planner=files.get('src/fastify-postgres-delete.js');
  assert.match(planner, /"model":"Project"/);
  assert.match(planner, /"model":"Task"/);
  assert.match(planner, /"many":true/);
  assert.match(planner, /await remove\(db, relation.model, item.id/);
  assert.match(planner, /disconnect: \[\{id\}\]/);
  assert.match(planner, /Cyclic relationship cascade/);
  new vm.Script(planner);
});
