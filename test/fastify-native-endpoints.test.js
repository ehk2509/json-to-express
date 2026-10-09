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
