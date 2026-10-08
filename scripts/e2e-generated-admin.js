'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

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
  throw lastError || new Error('Generated API did not become healthy');
}

async function main() {
  const generatedRoot = process.argv[2];
  const baseUrl = process.argv[3];
  const idField = process.argv[4];

  if (!generatedRoot || !baseUrl || !idField) {
    throw new Error('Usage: node scripts/e2e-generated-admin.js <generated-root> <base-url> <id-field>');
  }

  await waitForHealth(baseUrl);

  const configModule = await import(pathToFileURL(path.resolve(generatedRoot, 'admin/src/config.js')).href);
  const apiModule = await import(pathToFileURL(path.resolve(generatedRoot, 'admin/src/api.js')).href);
  const config = configModule.config;
  const api = apiModule.createApi(config, {baseUrl});

  assert.ok(config.title);
  assert.equal(config.idField, idField);

  const categoryEntity = config.entities.find(entity => entity.name === 'Category');
  const productEntity = config.entities.find(entity => entity.name === 'Product');
  assert.ok(categoryEntity);
  assert.ok(productEntity);
  assert.ok(productEntity.listFields.includes('name'));
  assert.ok(productEntity.fields.find(field => field.name === 'category' && field.ref === 'Category'));

  const suffix = Date.now().toString(36);
  const category = await api.entity(categoryEntity).create({name: 'Admin Category ' + suffix});
  const categoryId = category[idField];
  assert.ok(categoryId);

  const product = await api.entity(productEntity).create({
    name: 'Admin Keyboard ' + suffix,
    price: 189,
    category: categoryId
  });
  const productId = product[idField];
  assert.ok(productId);

  const pagination = productEntity.operations.list.query.pagination;
  const query = {name: 'Admin Keyboard ' + suffix, price__gte: 100};
  if (pagination.enabled) {
    query[pagination.pageParam] = 1;
    query[pagination.limitParam] = productEntity.pageSize;
  }

  const listed = await api.entity(productEntity).list(query);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'Admin Keyboard ' + suffix);

  const fetched = await api.entity(productEntity).get(productId);
  assert.equal(fetched.price, 189);

  const updated = await api.entity(productEntity).update(productId, {price: 205});
  assert.equal(updated.price, 205);

  const queueAction = config.actions.find(action => action.name === 'queueReprice');
  if (queueAction) {
    assert.equal(queueAction.entity, 'Product');
    const result = await api.action(queueAction, {
      params: {[queueAction.entityIdParam]: productId},
      body: {price: 219}
    });
    assert.equal(result.queued, true);

    let repriced;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await api.entity(productEntity).get(productId);
      if (current.price === 219) {
        repriced = current;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(repriced);
  }

  await assert.rejects(
    () => api.entity(productEntity).get('not-a-valid-id'),
    error => {
      assert.ok(error instanceof apiModule.ApiError);
      assert.equal(error.status, 400);
      return true;
    }
  );

  await api.entity(productEntity).remove(productId);
  if (idField === '_id') await api.entity(categoryEntity).remove(categoryId);

  console.log('Generated admin API runtime E2E passed for ' + idField + '.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
