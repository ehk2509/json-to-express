'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

async function main() {
  const generatedRoot = process.argv[2];
  const baseUrl = process.argv[3];
  const idField = process.argv[4];

  if (!generatedRoot || !baseUrl || !idField) {
    throw new Error('Usage: node scripts/e2e-generated-sdk.js <generated-root> <base-url> <id-field>');
  }

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
  await client.categories.delete(categoryId);

  console.log('Generated SDK E2E passed for ' + idField + '.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
