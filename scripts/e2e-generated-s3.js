'use strict';

const assert = require('node:assert/strict');

const base = process.env.E2E_S3_BASE_URL || 'http://127.0.0.1:3458';

async function request(route, options = {}) {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(base + route, {
    ...options,
    headers: {
      ...(!isForm ? {'content-type': 'application/json'} : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return {response, body};
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(base + '/health');
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw lastError || new Error('S3 generated application did not become healthy');
}

async function assertMissing(url) {
  const response = await fetch(url);
  assert.equal(response.ok, false);
  assert.ok([403, 404].includes(response.status), 'expected missing S3 object, got ' + response.status);
}

async function main() {
  await waitForHealth();

  const first = new FormData();
  first.set('name', 'S3 Asset');
  first.set('file', new Blob(['first-object'], {type: 'text/plain'}), 'first.txt');

  const created = await request('/api/assets', {method: 'POST', body: first});
  assert.equal(created.response.status, 201);
  assert.ok(created.body._id);
  assert.equal(created.body.file.provider, 's3');
  assert.equal(created.body.file.originalName, 'first.txt');
  assert.equal(created.body.file.mimeType, 'text/plain');
  assert.equal(created.body.file.size, Buffer.byteLength('first-object'));
  assert.equal(created.body.file.checksumSha256.length, 64);
  assert.ok(created.body.file.key.startsWith('assets/files/'));
  assert.ok(created.body.file.url);

  const firstUrl = created.body.file.url;
  const downloadedFirst = await fetch(firstUrl);
  assert.equal(downloadedFirst.status, 200);
  assert.equal(await downloadedFirst.text(), 'first-object');

  const badMime = new FormData();
  badMime.set('name', 'Bad MIME');
  badMime.set('file', new Blob(['{}'], {type: 'application/json'}), 'bad.json');
  const rejectedMime = await request('/api/assets', {method: 'POST', body: badMime});
  assert.equal(rejectedMime.response.status, 400);

  const oversized = new FormData();
  oversized.set('name', 'Too Large');
  oversized.set('file', new Blob(['x'.repeat(3000)], {type: 'text/plain'}), 'large.txt');
  const rejectedSize = await request('/api/assets', {method: 'POST', body: oversized});
  assert.equal(rejectedSize.response.status, 400);

  const replacement = new FormData();
  replacement.set('file', new Blob(['second-object'], {type: 'text/plain'}), 'second.txt');
  const updated = await request('/api/assets/' + created.body._id, {method: 'PATCH', body: replacement});
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.file.provider, 's3');
  assert.equal(updated.body.file.originalName, 'second.txt');
  assert.ok(updated.body.file.url);
  assert.notEqual(updated.body.file.key, created.body.file.key);

  await assertMissing(firstUrl);

  const secondUrl = updated.body.file.url;
  const downloadedSecond = await fetch(secondUrl);
  assert.equal(downloadedSecond.status, 200);
  assert.equal(await downloadedSecond.text(), 'second-object');

  const removed = await request('/api/assets/' + created.body._id, {method: 'DELETE'});
  assert.equal(removed.response.status, 204, JSON.stringify(removed.body));

  await assertMissing(secondUrl);

  const missing = await request('/api/assets/' + created.body._id);
  assert.equal(missing.response.status, 404);

  console.log('Generated S3-compatible storage E2E passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
