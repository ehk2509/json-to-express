'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.E2E_POSTGRES_BASE_URL || 'http://127.0.0.1:3457';

async function request(urlPath, options = {}) {
  const response = await fetch(base + urlPath, {
    ...options,
    headers: {
      'content-type': 'application/json',
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
