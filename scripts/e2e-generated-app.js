'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3456';

async function request(urlPath, options = {}) {
  const response = await fetch(base + urlPath, {
    ...options,
    headers: {'content-type': 'application/json', ...(options.headers || {})}
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
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw lastError || new Error('Generated application did not become healthy');
}

async function main() {
  let webhookPayload;
  const webhookServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      webhookPayload = JSON.parse(raw || '{}');
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise(resolve => webhookServer.listen(4567, '127.0.0.1', resolve));

  try {
    await waitForHealth();

  const category = await request('/api/categories', {
    method: 'POST',
    body: JSON.stringify({name: 'Accessories'})
  });
  assert.equal(category.response.status, 201);
  assert.ok(category.body._id);

  const created = await request('/api/products', {
    method: 'POST',
    body: JSON.stringify({name: 'Keyboard', price: 99, category: category.body._id})
  });
  assert.equal(created.response.status, 201);
  assert.ok(created.body._id);
  const id = created.body._id;

  const restricted = await request('/api/categories/' + category.body._id, {method: 'DELETE'});
  assert.equal(restricted.response.status, 409);

  const listed = await request('/api/products?name=Keyboard&price__gte=90&limit=1&page=1&sort=-price');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].category.name, 'Accessories');

  const fetched = await request('/api/products/' + id);
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.body.category.name, 'Accessories');

  const updated = await request('/api/products/' + id, {
    method: 'PATCH',
    body: JSON.stringify({price: 120})
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.price, 120);

  const published = await request('/api/products/' + id + '/publish', {method: 'POST'});
  assert.equal(published.response.status, 200);
  assert.equal(published.body.id, id);
  assert.equal(published.body.published, true);
  assert.equal(webhookPayload.id, id);
  assert.equal(webhookPayload.name, 'Keyboard');
  assert.equal(webhookPayload.published, true);

  const removed = await request('/api/products/' + id, {method: 'DELETE'});
  assert.equal(removed.response.status, 204);

  const missing = await request('/api/products/' + id);
  assert.equal(missing.response.status, 404);

  const categoryDeleted = await request('/api/categories/' + category.body._id, {method: 'DELETE'});
  assert.equal(categoryDeleted.response.status, 204);

  const openapiPath = path.join(process.cwd(), '.tmp/e2e-app/openapi.json');
  const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  assert.equal(openapi.openapi, '3.1.0');
  assert.ok(openapi.components.schemas.Product);
  assert.ok(openapi.paths['/api/products']);

    console.log('Generated application E2E v1 + workflows passed.');
  } finally {
    await new Promise(resolve => webhookServer.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
