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
  assert.match(files.get('src/server.js'), /registerNativeEndpoints.matches/);
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
  assert.match(files.get('src/server.js'), /@fastify\/rate-limit/);
  assert.match(files.get('src/server.js'), /@fastify\/compress/);
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
  assert.match(files.get('src/server.js'),/registerNativeAuth.matches/);
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
  const server=files.get('src/server.js');
  assert.match(server,/observability.requestMiddleware\(request.raw, reply.raw, done\)/);
  assert.match(server,/registerNativeCrud.matches/);
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
