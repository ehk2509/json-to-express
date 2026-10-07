'use strict';

const {filePaths, js, joinUrl, relativeRequire} = require('./utils');

module.exports = function contractTestSource(spec) {
  const testFile = require('node:path').posix.join(spec.generation.paths.tests, 'contract.test.js');
  const lines = [
    "'use strict';", '',
    "const test = require('node:test');",
    "const request = require('supertest');",
    'const app = require(' + js(relativeRequire(testFile, filePaths(spec).app)) + ');', ''
  ];

  for (const entity of spec.entities) {
    const base = joinUrl(spec.app.apiPrefix, entity.route);
    const create = entity.operations.create;
    if (create.enabled && create.validate && !create.auth.required) {
      const target = create.path === '/' ? base : joinUrl(base, create.path);
      lines.push(
        "test('" + entity.name + " create rejects invalid body before DB access', async () => {",
        '  await request(app).' + create.method + '(' + js(target) + ').send({}).expect(400);',
        '});', ''
      );
    }
    const get = entity.operations.get;
    if (get.enabled && get.validate && !get.auth.required) {
      const target = joinUrl(base, get.path.replace(':' + entity.idParam, 'not-an-object-id'));
      lines.push(
        "test('" + entity.name + " get rejects invalid id before DB access', async () => {",
        '  await request(app).' + get.method + '(' + js(target) + ').expect(400);',
        '});', ''
      );
    }
  }

  return lines.join('\n');
};
