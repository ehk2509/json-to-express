'use strict';

const isDirectFastify = require('./fastify-direct');

module.exports = function packageSource(spec) {
  const config = spec.app.package;
  const dependencies = {...config.dependencies};
  const devDependencies = {...config.devDependencies};
  if (isDirectFastify(spec)) {
    for (const name of ['express', '@fastify/express', 'express-rate-limit', 'cors', 'compression']) delete dependencies[name];
    delete devDependencies.supertest;
  }
  return JSON.stringify({
    name: config.name,
    version: config.version,
    private: config.private,
    description: config.description,
    main: config.main,
    scripts: config.scripts,
    engines: {node: config.nodeEngine},
    dependencies,
    devDependencies
  }, null, 2) + '\n';
};
