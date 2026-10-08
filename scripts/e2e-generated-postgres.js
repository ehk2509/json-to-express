'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.E2E_POSTGRES_BASE_URL || 'http://127.0.0.1:3457';

async function request(urlPath, options = {}) {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(base + urlPath, {
    ...options,
    headers: {
      ...(!isForm ? {'content-type': 'application/json'} : {}),
      'x-api-key': process.env.E2E_API_KEY || 'ci-api-key',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return {response, body};
}


async function graphqlRequest(query, variables = {}) {
  const {response, body} = await request('/graphql', {
    method: 'POST',
    body: JSON.stringify({query, variables})
  });
  assert.equal(response.status, 200);
  if (body.errors) throw new Error('GraphQL errors: ' + JSON.stringify(body.errors));
  return body.data;
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

  const live = await request('/health/live', {headers: {'x-request-id': 'e2e-correlation-id'}});
  assert.equal(live.response.status, 200);
  assert.equal(live.body.status, 'alive');
  assert.equal(live.response.headers.get('x-request-id'), 'e2e-correlation-id');

  const ready = await request('/health/ready');
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.status, 'ready');
  assert.equal(ready.body.checks.database, 'ok');
  assert.ok(ready.body.checks.outbox);


  const viewerDenied = await request('/api/products/not-an-id/publish', {
    method: 'POST',
    headers: {'x-api-key': process.env.E2E_VIEWER_API_KEY || 'ci-viewer-key'},
    body: JSON.stringify({})
  });
  assert.equal(viewerDenied.response.status, 403);

  const viewerGraphql = await request('/graphql', {
    method: 'POST',
    headers: {'x-api-key': process.env.E2E_VIEWER_API_KEY || 'ci-viewer-key'},
    body: JSON.stringify({
      query: 'mutation($params: JSON) { actionPublishProduct(params: $params) }',
      variables: {params: {id: 'not-an-id'}}
    })
  });
  assert.equal(viewerGraphql.response.status, 200);
  assert.ok(Array.isArray(viewerGraphql.body.errors));
  assert.equal(viewerGraphql.body.errors[0].extensions.code, 'FORBIDDEN');


  const gqlCategory = await graphqlRequest(
    'mutation($input: CategoryCreateInput!) { createCategory(input: $input) { id name } }',
    {input: {name: 'GraphQL Accessories'}}
  );
  assert.ok(gqlCategory.createCategory.id);

  const gqlTag = await graphqlRequest(
    'mutation($input: TagCreateInput!) { createTag(input: $input) { id name } }',
    {input: {name: 'GraphQL Featured'}}
  );
  assert.ok(gqlTag.createTag.id);

  const gqlProduct = await graphqlRequest(
    'mutation($input: ProductCreateInput!) { createProduct(input: $input) { id name price category { id name } tags { id name } } }',
    {input: {
      name: 'GraphQL Keyboard',
      price: 249,
      category: gqlCategory.createCategory.id,
      tags: [gqlTag.createTag.id]
    }}
  );
  assert.equal(gqlProduct.createProduct.category.name, 'GraphQL Accessories');
  assert.equal(gqlProduct.createProduct.tags[0].name, 'GraphQL Featured');
  const gqlProductId = gqlProduct.createProduct.id;

  const gqlListed = await graphqlRequest(
    'query($filter: ProductFilterInput) { listProducts(filter: $filter, sort: "-price", page: 1, limit: 5) { id name price category { name } tags { name } } }',
    {filter: {name: 'GraphQL Keyboard', price__gte: 200, tags: gqlTag.createTag.id}}
  );
  assert.equal(gqlListed.listProducts.length, 1);
  assert.equal(gqlListed.listProducts[0].id, gqlProductId);
  assert.equal(gqlListed.listProducts[0].tags[0].name, 'GraphQL Featured');

  const gqlUpdated = await graphqlRequest(
    'mutation($id: ID!, $input: ProductUpdateInput!) { updateProduct(id: $id, input: $input) { id price tags { id } } }',
    {id: gqlProductId, input: {price: 260, tags: []}}
  );
  assert.equal(gqlUpdated.updateProduct.price, 260);
  assert.deepEqual(gqlUpdated.updateProduct.tags, []);

  const gqlQueued = await graphqlRequest(
    'mutation($params: JSON, $body: JSON) { actionQueueReprice(params: $params, body: $body) }',
    {params: {id: gqlProductId}, body: {price: 275}}
  );
  assert.equal(gqlQueued.actionQueueReprice.queued, true);

  let gqlRepriced;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await graphqlRequest(
      'query($id: ID!) { getProduct(id: $id) { id price } }',
      {id: gqlProductId}
    );
    if (current.getProduct && current.getProduct.price === 275) {
      gqlRepriced = current.getProduct;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(gqlRepriced);

  const gqlDeleted = await graphqlRequest(
    'mutation($id: ID!) { deleteProduct(id: $id) }',
    {id: gqlProductId}
  );
  assert.equal(gqlDeleted.deleteProduct, true);

  const gqlTagDeleted = await graphqlRequest(
    'mutation($id: ID!) { deleteTag(id: $id) }',
    {id: gqlTag.createTag.id}
  );
  assert.equal(gqlTagDeleted.deleteTag, true);


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

  const productForm = new FormData();
  productForm.set('name', 'Keyboard');
  productForm.set('price', '99');
  productForm.set('category', category.body.id);
  productForm.set('tags', JSON.stringify([tagA.body.id, tagB.body.id]));
  productForm.set('image', new Blob(['image-one'], {type: 'text/plain'}), 'image-one.txt');
  productForm.append('attachments', new Blob(['attachment-a'], {type: 'text/plain'}), 'a.txt');
  productForm.append('attachments', new Blob(['attachment-b'], {type: 'text/plain'}), 'b.txt');

  const createdProduct = await request('/api/products', {
    method: 'POST',
    body: productForm
  });
  assert.equal(createdProduct.response.status, 201);
  assert.match(createdProduct.body.id, /^[0-9a-f-]{36}$/i);
  const id = createdProduct.body.id;
  assert.equal(createdProduct.body.image.originalName, 'image-one.txt');
  assert.equal(createdProduct.body.image.mimeType, 'text/plain');
  assert.equal(createdProduct.body.image.provider, 'local');
  assert.equal(createdProduct.body.image.checksumSha256.length, 64);
  assert.ok(createdProduct.body.image.url);
  assert.equal(createdProduct.body.attachments.length, 2);
  const originalImageUrl = createdProduct.body.image.url;
  const attachmentUrls = createdProduct.body.attachments.map(file => file.url);
  const imageResponse = await fetch(originalImageUrl);
  assert.equal(imageResponse.status, 200);
  assert.equal(await imageResponse.text(), 'image-one');

  const badMimeForm = new FormData();
  badMimeForm.set('name', 'Bad Mime');
  badMimeForm.set('price', '10');
  badMimeForm.set('category', category.body.id);
  badMimeForm.set('image', new Blob(['bad'], {type: 'application/json'}), 'bad.json');
  const badMime = await request('/api/products', {method: 'POST', body: badMimeForm});
  assert.equal(badMime.response.status, 400);

  const oversizedForm = new FormData();
  oversizedForm.set('name', 'Too Large');
  oversizedForm.set('price', '10');
  oversizedForm.set('category', category.body.id);
  oversizedForm.set('image', new Blob(['x'.repeat(1500)], {type: 'text/plain'}), 'large.txt');
  const oversized = await request('/api/products', {method: 'POST', body: oversizedForm});
  assert.equal(oversized.response.status, 400);

  const restricted = await request('/api/categories/' + category.body.id, {method: 'DELETE'});
  assert.equal(restricted.response.status, 409);

  const listed = await request('/api/products?name=Keyboard&price__gte=90&tags=' + tagA.body.id + '&limit=1&page=1&sort=-price');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].category.name, 'Accessories');
  assert.deepEqual(listed.body[0].tags.map(tag => tag.name).sort(), ['Featured', 'Mechanical']);

  const fetched = await request('/api/products/' + id);
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.response.headers.get('x-cache'), null);
  assert.equal(fetched.body.category.name, 'Accessories');
  assert.equal(fetched.body.tags.length, 2);

  const fetchedCached = await request('/api/products/' + id);
  assert.equal(fetchedCached.response.status, 200);
  assert.equal(fetchedCached.response.headers.get('x-cache'), null);

  const updateForm = new FormData();
  updateForm.set('price', '120');
  updateForm.set('tags', JSON.stringify([tagA.body.id]));
  updateForm.set('image', new Blob(['image-two'], {type: 'text/plain'}), 'image-two.txt');
  const updated = await request('/api/products/' + id, {
    method: 'PATCH',
    body: updateForm
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.price, 120);
  assert.equal(updated.body.tags.length, 1);
  assert.equal(updated.body.tags[0].name, 'Featured');
  assert.equal(updated.body.image.originalName, 'image-two.txt');
  assert.notEqual(updated.body.image.url, originalImageUrl);
  const oldImageAfterReplace = await fetch(originalImageUrl);
  assert.equal(oldImageAfterReplace.status, 404);
  const newImageUrl = updated.body.image.url;
  const newImageResponse = await fetch(newImageUrl);
  assert.equal(newImageResponse.status, 200);
  assert.equal(await newImageResponse.text(), 'image-two');

  const afterUpdate = await request('/api/products/' + id);
  assert.equal(afterUpdate.response.status, 200);
  assert.equal(afterUpdate.response.headers.get('x-cache'), null);
  assert.equal(afterUpdate.body.price, 120);

  const afterUpdateCached = await request('/api/products/' + id);
  assert.equal(afterUpdateCached.response.headers.get('x-cache'), null);

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
  assert.equal(publishedRecord.response.headers.get('x-cache'), null);
  assert.equal(publishedRecord.body.published, true);
  const publishedRecordCached = await request('/api/products/' + id);
  assert.equal(publishedRecordCached.response.headers.get('x-cache'), null);

  const queued = await request('/api/products/' + id + '/reprice', {
    method: 'POST',
    body: JSON.stringify({price: 135})
  });
  assert.equal(queued.response.status, 202);
  assert.equal(queued.body.queued, true);

  let repriced;
  let repricedCacheState;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await request('/api/products/' + id);
    if (current.response.status === 200 && current.body.price === 135) {
      repriced = current.body;
      repricedCacheState = current.response.headers.get('x-cache');
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(repriced);
  assert.equal(repriced.price, 135);
  assert.equal(repricedCacheState, null);

  const removed = await request('/api/products/' + id, {method: 'DELETE'});
  assert.equal(removed.response.status, 204);
  assert.equal((await fetch(newImageUrl)).status, 404);
  for (const url of attachmentUrls) assert.equal((await fetch(url)).status, 404);

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


  const metricsResponse = await fetch(base + '/metrics');
  assert.equal(metricsResponse.status, 200);
  assert.match(metricsResponse.headers.get('content-type') || '', /text\/plain/);
  const metricsText = await metricsResponse.text();
  assert.match(metricsText, /j2e_http_requests_total/);
  assert.match(metricsText, /j2e_http_request_duration_seconds/);
  assert.match(metricsText, /j2e_graphql_operations_total/);
  assert.match(metricsText, /j2e_workflow_executions_total/);
  assert.match(metricsText, /j2e_workflow_steps_total/);
  assert.match(metricsText, /j2e_worker_records_total/);
  assert.match(metricsText, /j2e_outbox_pending/);
  assert.match(metricsText, /j2e_outbox_dead/);

  console.log('Generated PostgreSQL + Prisma E2E passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
