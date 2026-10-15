#!/usr/bin/env node
'use strict';

// npm may accept a signed publish before its public registry has processed
// the new packument. This script only verifies visibility; it never publishes.
const REGISTRY = 'https://registry.npmjs.org';
const WAIT_MS = 15 * 60 * 1000;
const INTERVAL_MS = 10 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

function registryUrl(name, version) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(name) ||
      typeof version !== 'string' ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error('Expected a valid unscoped npm package name and exact beta version');
  }
  return REGISTRY + '/' + encodeURIComponent(name) + '/' + encodeURIComponent(version);
}

async function checkPublished(name, version, {fetchImpl = fetch} = {}) {
  const response = await fetchImpl(registryUrl(name, version), {
    headers: {'accept': 'application/json', 'cache-control': 'no-cache'},
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (response.status === 404 || response.status === 429 || response.status >= 500) return false;
  if (response.status !== 200) throw new Error('Unexpected npm registry HTTP status ' + response.status);
  const metadata = await response.json();
  if (!metadata || metadata.name !== name || metadata.version !== version) {
    throw new Error('npm registry returned unexpected package/version metadata');
  }
  return true;
}

async function waitForPublished(name, version, {
  check = checkPublished, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = WAIT_MS, intervalMs = INTERVAL_MS,
  log = message => process.stdout.write(message + '\n')
} = {}) {
  registryUrl(name, version);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
      !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('Registry verification intervals must be positive');
  }
  const deadline = now() + timeoutMs;
  let attempts = 0;
  while (true) {
    attempts++;
    try {
      if (await check(name, version)) {
        log('Registry confirmed ' + name + '@' + version + ' after ' + attempts + ' check(s)');
        return {attempts, published: true};
      }
    } catch (error) {
      // Fail closed on an unexpected successful response or an authorization
      // error; retry transient connectivity failures during npm propagation.
      if (/unexpected package\/version metadata|Unexpected npm registry HTTP status/.test(error.message)) {
        throw error;
      }
      if (attempts === 1 || attempts % 6 === 0) {
        log('npm registry not yet reachable: ' + String(error.message).slice(0, 160));
      }
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error('npm accepted the publish but ' + name + '@' + version +
        ' was not visible after ' + timeoutMs / 1000 + ' seconds; ' +
        'check npm before attempting any new publication');
    }
    if (attempts === 1 || attempts % 6 === 0) {
      log('Waiting for npm processing: ' + name + '@' + version +
        ' (check ' + attempts + ', up to ' + Math.ceil(remaining / 1000) + 's left)');
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}

if (require.main === module) {
  waitForPublished(process.argv[2], process.argv[3])
    .catch(error => {console.error('npm publication verification: ' + error.message); process.exitCode = 1;});
}

module.exports = {registryUrl, checkPublished, waitForPublished, WAIT_MS, INTERVAL_MS};
