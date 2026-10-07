'use strict';

module.exports = function packageSource(spec) {
  const config = spec.app.package;
  return JSON.stringify({
    name: config.name,
    version: config.version,
    private: config.private,
    description: config.description,
    main: 'src/server.js',
    scripts: config.scripts,
    engines: {node: config.nodeEngine},
    dependencies: config.dependencies,
    devDependencies: config.devDependencies
  }, null, 2) + '\n';
};
