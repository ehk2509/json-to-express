'use strict';

const {js} = require('./utils');

module.exports = function eventBusSource(spec) {
  return [
    "'use strict';", '',
    'const events = ' + js(spec.events) + ';', '',
    'async function publish(name, payload) {',
    '  const definition = events[name] || {webhooks: []};',
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
    'module.exports = {publish};', ''
  ].join('\n');
};
