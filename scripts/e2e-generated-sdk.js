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
  const client = sdk.createClient({baseUrl});
  const suffix = Date.now().toString(36);

  const category = await client.categories.create({name: 'SDK Category ' + suffix});
  const categoryId = category[idField];
  assert.ok(categoryId);

  const product = await client.products.create({
    name: 'SDK Keyboard ' + suffix,
    price: 149,
    category: categoryId
  });
  const productId = product[idField];
  assert.ok(productId);

  const listed = await client.products.list({
    name: 'SDK Keyboard ' + suffix,
    price__gte: 100,
    limit: 1,
    page: 1
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'SDK Keyboard ' + suffix);
  assert.equal(listed[0].category.name, 'SDK Category ' + suffix);

  const fetched = await client.products.get(productId);
  assert.equal(fetched.price, 149);

  const updated = await client.products.update(productId, {price: 175});
  assert.equal(updated.price, 175);

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
  if (idField === '_id') await client.categories.delete(categoryId);

  console.log('Generated SDK E2E passed for ' + idField + '.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
