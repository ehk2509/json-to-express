'use strict';

module.exports = {
  apiVersion: 1,
  id: 'community.greeting',
  kind: 'generator',
  mode: 'augment',
  validate({spec}) {
    if (!spec.app) throw new Error('Missing app');
  },
  beforeGenerate(context) {
    if (!context.spec.database) throw new Error('Missing database');
  },
  generate({spec, options}) {
    const message = typeof options.message === 'string' ? options.message : 'Welcome';
    return {files: {'extensions/greeting.txt': message + ' from ' + spec.app.name + '\n'}};
  },
  afterGenerate(_context, output) {
    if (!output.files['extensions/greeting.txt']) throw new Error('Missing greeting');
  }
};
