'use strict';

const {filePaths, js, joinUrl, relativeRequire} = require('./utils');
const isDirectFastify = require('./fastify-direct');

module.exports = function contractTestSource(spec) {
  const testFile = require('node:path').posix.join(spec.generation.paths.tests, 'contract.test.js');
  const directFastify = isDirectFastify(spec);
  const lines = [
    "'use strict';", '',
    "const test = require('node:test');",
    ...(directFastify ? [] : ["const request = require('supertest');"]),
    ...(directFastify ? ["const assert = require('node:assert/strict');"] : []),
    'const app = require(' + js(relativeRequire(testFile, filePaths(spec).app)) + ');', ''
  ];

  for (const entity of spec.entities) {
    const base = joinUrl(spec.app.apiPrefix, entity.route);
    const create = entity.operations.create;
    if (create.enabled && create.validate && !create.auth.required) {
      const target = create.path === '/' ? base : joinUrl(base, create.path);
      lines.push(
        "test('" + entity.name + " create rejects invalid body before DB access', async () => {",
        (directFastify
          ? '  const response = await app.inject({method: ' + js(create.method.toUpperCase()) + ', url: ' + js(target) + ', payload: {}}); assert.equal(response.statusCode, 400);'
          : '  await request(app).' + create.method + '(' + js(target) + ').send({}).expect(400);'),
        '});', ''
      );
    }
    const get = entity.operations.get;
    if (get.enabled && get.validate && !get.auth.required) {
      const target = joinUrl(base, get.path.replace(':' + entity.idParam, 'not-an-object-id'));
      lines.push(
        "test('" + entity.name + " get rejects invalid id before DB access', async () => {",
        (directFastify
          ? '  const response = await app.inject({method: ' + js(get.method.toUpperCase()) + ', url: ' + js(target) + '}); assert.equal(response.statusCode, 400);'
          : '  await request(app).' + get.method + '(' + js(target) + ').expect(400);'),
        '});', ''
      );
    }
  }

  return lines.join('\n');
};
