'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.E2E_POSTGRES_BASE_URL || 'http://127.0.0.1:3457';

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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const {response} = await request('/health');
      if (response.status === 200) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw lastError || new Error('Generated PostgreSQL application did not become healthy');
}

async function main() {
  await waitForHealth();

  const category = await request('/api/categories', {
    method: 'POST',
    body: JSON.stringify({name: 'Accessories'})
  });
  assert.equal(category.response.status, 201);
  assert.match(category.body.id, /^[0-9a-f-]{36}$/i);

  const tagA = await request('/api/tags', {
    method: 'POST',
    body: JSON.stringify({name: 'Featured'})
  });
  assert.equal(tagA.response.status, 201);
  assert.match(tagA.body.id, /^[0-9a-f-]{36}$/i);

  const tagB = await request('/api/tags', {
    method: 'POST',
    body: JSON.stringify({name: 'Mechanical'})
  });
  assert.equal(tagB.response.status, 201);
  assert.match(tagB.body.id, /^[0-9a-f-]{36}$/i);

  const createdProduct = await request('/api/products', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Keyboard',
      price: 99,
      category: category.body.id,
      tags: [tagA.body.id, tagB.body.id]
    })
  });
  assert.equal(createdProduct.response.status, 201);
  assert.match(createdProduct.body.id, /^[0-9a-f-]{36}$/i);
  const id = createdProduct.body.id;

  const restricted = await request('/api/categories/' + category.body.id, {method: 'DELETE'});
  assert.equal(restricted.response.status, 409);

  const listed = await request('/api/products?name=Keyboard&price__gte=90&tags=' + tagA.body.id + '&limit=1&page=1&sort=-price');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].category.name, 'Accessories');
  assert.deepEqual(listed.body[0].tags.map(tag => tag.name).sort(), ['Featured', 'Mechanical']);

  const fetched = await request('/api/products/' + id);
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.body.category.name, 'Accessories');
  assert.equal(fetched.body.tags.length, 2);

  const updated = await request('/api/products/' + id, {
    method: 'PATCH',
    body: JSON.stringify({price: 120, tags: [tagA.body.id]})
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.price, 120);
  assert.equal(updated.body.tags.length, 1);
  assert.equal(updated.body.tags[0].name, 'Featured');

  const tagDeleted = await request('/api/tags/' + tagA.body.id, {method: 'DELETE'});
  assert.equal(tagDeleted.response.status, 204);

  const unlinked = await request('/api/products/' + id);
  assert.equal(unlinked.response.status, 200);
  assert.deepEqual(unlinked.body.tags, []);

  const published = await request('/api/products/' + id + '/publish', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(published.response.status, 200);
  assert.equal(published.body.id, id);
  assert.equal(published.body.published, true);

  const publishedRecord = await request('/api/products/' + id);
  assert.equal(publishedRecord.response.status, 200);
  assert.equal(publishedRecord.body.published, true);

  const queued = await request('/api/products/' + id + '/reprice', {
    method: 'POST',
    body: JSON.stringify({price: 135})
  });
  assert.equal(queued.response.status, 202);
  assert.equal(queued.body.queued, true);

  let repriced;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await request('/api/products/' + id);
    if (current.response.status === 200 && current.body.price === 135) {
      repriced = current.body;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(repriced);
  assert.equal(repriced.price, 135);

  const removed = await request('/api/products/' + id, {method: 'DELETE'});
  assert.equal(removed.response.status, 204);

  const missing = await request('/api/products/' + id);
  assert.equal(missing.response.status, 404);

  const invalid = await request('/api/products/not-a-uuid');
  assert.equal(invalid.response.status, 400);

  const openapi = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.tmp/e2e-postgres/openapi.json'), 'utf8'));
  assert.equal(openapi.openapi, '3.1.0');
  assert.equal(openapi.components.schemas.Product.properties.id.format, 'uuid');
  assert.equal(openapi.components.schemas.Product.properties.tags.type, 'array');
  assert.equal(openapi.components.schemas.Product.properties.tags.items.format, 'uuid');
  assert.equal(openapi.paths['/api/products/{id}'].get.parameters[0].schema.format, 'uuid');

  const remainingTagDeleted = await request('/api/tags/' + tagB.body.id, {method: 'DELETE'});
  assert.equal(remainingTagDeleted.response.status, 204);

  console.log('Generated PostgreSQL + Prisma E2E passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
