'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registryUrl, checkPublished, waitForPublished, WAIT_MS, INTERVAL_MS
} = require('../scripts/npm-registry-visibility');

const name = 'json-to-express', version = '0.2.0-beta.3';

test('publication visibility timeout allows up to 15 minutes with 10-second checks', () => {
  assert.equal(WAIT_MS, 900000);
  assert.equal(INTERVAL_MS, 10000);
  assert.equal(registryUrl(name, version), 'https://registry.npmjs.org/json-to-express/0.2.0-beta.3');
  for (const v of ['latest', '0.2.0', '../beta', '0.2.0-beta.x']) {
    assert.throws(() => registryUrl(name, v), /exact beta version/);
  }
  assert.throws(() => registryUrl('../../unsafe', version), /unscoped npm package/);
});

test('only a matching 200 package/version response confirms publication', async () => {
  let requestOptions;
  const published = await checkPublished(name, version, {fetchImpl: async (url, options) => {
    assert.equal(url, registryUrl(name, version));
    requestOptions = options;
    return {status: 200, json: async () => ({name, version})};
  }});
  assert.equal(published, true);
  assert.equal(requestOptions.cache, 'no-store');
  assert.equal(requestOptions.headers['cache-control'], 'no-cache');
  for (const status of [404, 429, 500, 502, 503]) {
    assert.equal(await checkPublished(name, version, {fetchImpl: async () => ({status})}), false);
  }
  await assert.rejects(checkPublished(name, version, {
    fetchImpl: async () => ({status: 200, json: async () => ({name, version: '0.2.0-beta.2'})})
  }), /unexpected package\/version metadata/);
  await assert.rejects(checkPublished(name, version, {
    fetchImpl: async () => ({status: 401})
  }), /HTTP status 401/);
});

test('404 and transient failures resolve successfully after delayed npm processing', async () => {
  let clock = 0, checks = 0;
  const messages = [];
  const result = await waitForPublished(name, version, {
    check: async () => {
      checks++;
      if (checks === 3) throw new Error('temporary network problem');
      return checks >= 8;
    },
    now: () => clock,
    sleep: async ms => {clock += ms;},
    timeoutMs: 120000, intervalMs: 10000,
    log: text => messages.push(text)
  });
  assert.equal(result.published, true);
  assert.equal(result.attempts, 8);
  assert.equal(clock, 70000);
  assert.ok(messages.some(text => text.includes('Registry confirmed')));
});

test('after timeout the verifier fails without invoking a publisher', async () => {
  let clock = 0, checks = 0;
  await assert.rejects(waitForPublished(name, version, {
    check: async () => {checks++; return false;},
    now: () => clock,
    sleep: async ms => {clock += ms;},
    timeoutMs: 25000, intervalMs: 10000, log: () => {}
  }), /not visible after 25 seconds/);
  assert.equal(checks, 4);
  assert.equal(clock, 25000);
});

test('malformed 200 responses and other fatal statuses do not count as published', async () => {
  let clock = 0;
  await assert.rejects(waitForPublished(name, version, {
    check: () => checkPublished(name, version, {
      fetchImpl: async () => ({status: 200, json: async () => ({name: 'other', version})})
    }),
    now: () => clock,
    sleep: async ms => {clock += ms;}, timeoutMs: 30000,
    log: () => {}
  }), /unexpected package\/version metadata/);
  assert.equal(clock, 0);
});

test('release workflow calls visibility verifier only after a successful publish', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/publish-beta.yml'), 'utf8');
  const publish = workflow.indexOf('npm publish --tag beta --access public');
  const verify = workflow.indexOf('node scripts/npm-registry-visibility.js "$PACKAGE" "$VERSION"');
  assert.ok(publish >= 0 && verify > publish, 'Verifier must run after the successful publish command');
  assert.match(workflow, /if npm view "\$PACKAGE@\$VERSION" version/);
  assert.match(workflow, /npm-beta:[\s\S]*?timeout-minutes: 20/);
});
