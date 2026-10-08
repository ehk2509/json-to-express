'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

async function waitForHealth(baseUrl) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl + '/health');
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw lastError || new Error('Generated application did not become healthy');
}

async function main() {
  const generatedRoot = process.argv[2];
  const baseUrl = process.argv[3];
  const idField = process.argv[4];

  if (!generatedRoot || !baseUrl || !idField) {
    throw new Error('Usage: node scripts/e2e-generated-sdk.js <generated-root> <base-url> <id-field>');
  }

  await waitForHealth(baseUrl);

  const sdk = require(path.resolve(generatedRoot, 'sdk/javascript'));
  const client = sdk.createClient({
    baseUrl,
    apiKey: process.env.E2E_API_KEY || 'ci-api-key',
    fetch: async (url, options = {}) => {
      if (String(url).includes('/api/products') && ['POST', 'PATCH'].includes(options.method)) {
        const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
        console.log('SDK multipart diagnostic', JSON.stringify({
          method: options.method,
          isForm,
          bodyType: options.body && options.body.constructor && options.body.constructor.name,
          keys: isForm ? Array.from(options.body.keys()) : []
        }));
      }
      return fetch(url, options);
    }
  });
  const suffix = Date.now().toString(36);

  const category = await client.categories.create({name: 'SDK Category ' + suffix});
  const categoryId = category[idField];
  assert.ok(categoryId);

  const tag = await client.tags.create({name: 'SDK Tag ' + suffix});
  const tagId = tag[idField];
  assert.ok(tagId);

  const product = await client.products.create({
    name: 'SDK Keyboard ' + suffix,
    price: 149,
    category: categoryId,
    tags: [tagId],
    image: new Blob(['sdk-image'], {type: 'text/plain'})
  });
  const productId = product[idField];
  assert.ok(productId);
  assert.equal(product.image.mimeType, 'text/plain');
  assert.equal(product.image.provider, 'local');
  assert.ok(product.image.url);

  const listed = await client.products.list({
    name: 'SDK Keyboard ' + suffix,
    price__gte: 100,
    limit: 1,
    page: 1
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'SDK Keyboard ' + suffix);
  assert.equal(listed[0].category.name, 'SDK Category ' + suffix);
  assert.equal(listed[0].tags.length, 1);
  assert.equal(listed[0].tags[0].name, 'SDK Tag ' + suffix);

  const fetched = await client.products.get(productId);
  assert.equal(fetched.price, 149);
  assert.equal(fetched.tags[0].name, 'SDK Tag ' + suffix);

  const updated = await client.products.update(productId, {
    price: 175,
    tags: [],
    image: new Blob(['sdk-image-updated'], {type: 'text/plain'})
  });
  assert.equal(updated.price, 175);
  assert.deepEqual(updated.tags, []);
  assert.equal(updated.image.mimeType, 'text/plain');
  assert.ok(updated.image.url);

  if (client.actions && client.actions.queueReprice) {
    const queued = await client.actions.queueReprice({
      params: {id: productId},
      body: {price: 199}
    });
    assert.equal(queued.queued, true);

    let repriced;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await client.products.get(productId);
      if (current.price === 199) {
        repriced = current;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(repriced);
    assert.equal(repriced.price, 199);
  }

  await assert.rejects(
    () => client.products.get('not-a-valid-id'),
    error => {
      assert.ok(error instanceof sdk.ApiError);
      assert.equal(error.status, 400);
      assert.ok(error.body);
      return true;
    }
  );

  await client.products.delete(productId);
  await client.tags.delete(tagId);
  if (idField === '_id') await client.categories.delete(categoryId);

  console.log('Generated SDK E2E passed for ' + idField + '.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
