'use strict';

const assert = require('node:assert/strict');

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3456';

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return {response, body};
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const {response} = await request('/health');
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw lastError || new Error('Generated application did not become healthy');
}

async function main() {
  await waitForHealth();

  const created = await request('/api/products', {
    method: 'POST',
    body: JSON.stringify({name: 'Keyboard', price: 99})
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.name, 'Keyboard');
  assert.ok(created.body._id);
  const id = created.body._id;

  const listed = await request('/api/products?name=Keyboard&limit=1&page=1&sort=-price&fields=name%20price');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].name, 'Keyboard');

  const fetched = await request('/api/products/' + id + '?select=name%20price');
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.body.name, 'Keyboard');

  const updated = await request('/api/products/' + id, {
    method: 'PATCH',
    body: JSON.stringify({price: 120})
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.price, 120);

  const removed = await request('/api/products/' + id, {method: 'DELETE'});
  assert.equal(removed.response.status, 204);

  const missing = await request('/api/products/' + id);
  assert.equal(missing.response.status, 404);

  console.log('Generated application E2E CRUD passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
