'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

module.exports = function eventBusSource(spec) {
  const paths = filePaths(spec);
  return [
    "'use strict';", '',
    'const outbox = require(' + js(relativeRequire(paths.eventBus, paths.outbox)) + ');',
    'const events = ' + js(spec.events) + ';', '',
    'async function publish(name, payload, options = {}) {',
    '  if (!events[name]) throw new Error("Unknown event: " + name);',
    '  return outbox.enqueueEvent(name, payload, options);',
    '}', '',
    'async function deliver(name, payload) {',
    '  const definition = events[name];',
    '  if (!definition) throw new Error("Unknown event: " + name);',
    '  for (const webhook of definition.webhooks) {',
    '    const url = process.env[webhook.urlEnv];',
    "    if (!url) throw new Error('Missing webhook URL environment variable: ' + webhook.urlEnv);",
    '    try {',
    '      const response = await fetch(url, {',
    '        method: webhook.method.toUpperCase(),',
    "        headers: {'content-type': 'application/json', ...webhook.headers},",
    '        body: JSON.stringify(payload)',
    '      });',
    '      if (!response.ok) throw new Error("Webhook " + name + " failed with HTTP " + response.status);',
    '    } catch (error) {',
    '      if (webhook.failure === "fail") throw error;',
    '      console.error("Webhook delivery failed:", error);',
    '    }',
    '  }',
    '}', '',
    'module.exports = {deliver, publish};', ''
  ].join('\n');
};
