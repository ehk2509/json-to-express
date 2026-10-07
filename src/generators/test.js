'use strict';

const {js} = require('./utils');

module.exports = function smokeTestSource(spec) {
  return [
    "'use strict';", '',
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const request = require('supertest');",
    "const app = require('../src/app');", '',
    "test('configured health endpoint responds', async () => {",
    '  const response = await request(app).get(' + js(spec.app.health.path) + ').expect(' + spec.app.health.status + ');',
    '  assert.deepEqual(response.body, ' + js(spec.app.health.response) + ');',
    '});', ''
  ].join('\n');
};
