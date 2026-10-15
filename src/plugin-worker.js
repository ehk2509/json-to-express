'use strict';

const fs = require('node:fs');

(async () => {
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  const plugin = require(request.modulePath);
  if (!plugin || plugin.apiVersion !== 1 || plugin.kind !== request.kind ||
      typeof plugin.id !== 'string' || typeof plugin.generate !== 'function') {
    throw new Error('Plugin must export apiVersion:1, id, kind, and generate(context)');
  }
  const context = {
    spec: request.spec,
    options: request.options,
    apiVersion: 1,
    kind: request.kind
  };
  // Every hook is executed in the same disposable subprocess. Hooks must not
  // mutate user files. The host performs all managed generated-file writes.
  if (typeof plugin.validate === 'function') await plugin.validate(context);
  if (typeof plugin.beforeGenerate === 'function') await plugin.beforeGenerate(context);
  const result = await plugin.generate(context);
  if (typeof plugin.afterGenerate === 'function') await plugin.afterGenerate(context, result);
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('generate(context) must return a contribution object');
  }
  const output = {
    apiVersion: 1,
    id: plugin.id,
    kind: plugin.kind,
    mode: plugin.mode || 'augment',
    files: result.files || {},
    overrides: result.overrides || []
  };
  process.stdout.write(JSON.stringify(output));
})().catch(error => {
  // Keep plugin diagnostic readable without exposing stack paths or spec JSON.
  process.stderr.write('plugin worker: ' + String(error && error.message || error).slice(0, 400) + '\n');
  process.exitCode = 1;
});
