'use strict';

const {filePaths, js, relativeRequire} = require('./utils');
const isDirectFastify = require('./fastify-direct');

module.exports = function smokeTestSource(spec) {
  const paths = filePaths(spec);
  if (isDirectFastify(spec)) return [
    "'use strict';", '',
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    'const app = require(' + js(relativeRequire(paths.test, paths.app)) + ');',
    "test('configured health endpoint responds', async () => {",
    '  const response = await app.inject({method: "GET", url: ' + js(spec.app.health.path) + '});',
    '  assert.equal(response.statusCode, ' + spec.app.health.status + ');',
    '  assert.deepEqual(response.json(), ' + js(spec.app.health.response) + ');',
    '});', ''
  ].join('\n');

  return [
    "'use strict';", '',
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const request = require('supertest');",
    'const app = require(' + js(relativeRequire(paths.test, paths.app)) + ');', '',
    "test('configured health endpoint responds', async () => {",
    '  const response = await request(app).get(' + js(spec.app.health.path) + ').expect(' + spec.app.health.status + ');',
    '  assert.deepEqual(response.body, ' + js(spec.app.health.response) + ');',
    '});', ''
  ].join('\n');
};
