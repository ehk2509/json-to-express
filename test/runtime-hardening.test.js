'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeSpec} = require('../src');
const {buildFiles} = require('../src/generators');

function load(source, stubs) {
  const module = {exports: {}};
  const stubRequire = name => {
    for (const [suffix, value] of Object.entries(stubs)) if (name === suffix || name.endsWith('/' + suffix)) return value;
    return require(name);
  };
  new Function('module', 'exports', 'require', source)(module, module.exports, stubRequire);
  return module.exports;
}

function cacheSpec() {
  return normalizeSpec({
    specVersion: '1.0',
    app: {name: 'cache-api'},
    database: {type: 'postgresql'},
    cache: {enabled: true, provider: 'redis', redis: {commandTimeoutMs: 50}},
    entities: {
      Category: {fields: {name: {type: 'string'}}},
      Shelf: {fields: {category: {type: 'reference', ref: 'Category'}}}
    }
  });
}

test('generated Redis cache fails open on a hung server, cools down and flushes missed invalidations', async () => {
  const calls = [];
  let mode = 'hang';
  const store = new Map();
  const fake = {
    isReady: true, isOpen: true, on() {}, async connect() {},
    get(key) { calls.push('get ' + key); return mode === 'hang' ? new Promise(() => {}) : Promise.resolve(store.get(key) || null); },
    incr(key) { calls.push('incr ' + key); return mode === 'hang' ? new Promise(() => {}) : Promise.resolve(store.set(key, String(Number(store.get(key) || 0) + 1))); },
    setEx(key, ttl, value) { return Promise.resolve(store.set(key, value)); }
  };
  const source = [...buildFiles(cacheSpec()).entries()].find(([name]) => name.endsWith('config/cache.js'))[1];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(message);
  const realNow = Date.now;
  try {
    const cache = load(source, {redis: {createClient: () => fake}});
    const policy = {varyByAuth: false};

    let started = realNow();
    const first = await cache.nativeRead('Category', 'list', policy, {params: {}, query: {}});
    const elapsed = realNow() - started;
    assert.equal(first.cached, null);
    assert.ok(elapsed >= 40 && elapsed < 400, 'hung read should time out near commandTimeoutMs, took ' + elapsed + 'ms');

    const before = calls.length;
    started = realNow();
    await cache.nativeRead('Category', 'list', policy, {params: {}, query: {}});
    assert.ok(realNow() - started < 30, 'reads during cooldown must not wait on Redis');
    assert.equal(calls.length, before, 'cooldown skips Redis entirely');

    await cache.invalidateEntity('Category');
    mode = 'ok';
    Date.now = () => realNow() + 6000;
    calls.length = 0;
    await cache.nativeRead('Category', 'list', policy, {params: {}, query: {}});
    const flushed = calls.filter(call => call.startsWith('incr ')).map(call => call.split(':').pop()).sort();
    assert.deepEqual(flushed, ['Category', 'Shelf']);
    assert.ok(calls.findIndex(call => call.startsWith('get ')) > calls.findIndex(call => call.startsWith('incr ')), 'flush happens before the first read');
    assert.ok(warnings.some(message => /timed out after 50ms/.test(message)));
  } finally {
    Date.now = realNow;
    console.warn = originalWarn;
  }
});

function workflowSpec() {
  return normalizeSpec({
    specVersion: '1.0',
    app: {name: 'workflow-api'},
    database: {type: 'postgresql'},
    entities: {
      Product: {softDelete: {enabled: true, field: 'deletedAt'}, fields: {name: {type: 'string'}}},
      Order: {fields: {qty: {type: 'number', required: true, min: 1}}}
    },
    endpoints: {
      order: {method: 'post', path: '/orders/custom', workflow: 'order'},
      touch: {method: 'post', path: '/products/:id/touch', workflow: 'touch'},
      remove: {method: 'post', path: '/products/:id/remove', workflow: 'remove'}
    },
    workflows: {
      order: {transaction: true, steps: [{name: 'create', action: 'create', entity: 'Order', data: {qty: '$body.qty'}}]},
      touch: {steps: [{name: 'update', action: 'updateById', entity: 'Product', id: '$params.id', data: {name: 'touched'}}]},
      remove: {steps: [{name: 'delete', action: 'deleteById', entity: 'Product', id: '$params.id'}]}
    }
  });
}

test('generated Prisma workflows validate data, respect soft delete and 404 on missing records', async () => {
  const files = buildFiles(workflowSpec());
  const validation = load(files.get('src/middleware/validation.js'), {});
  const live = '00000000-0000-4000-8000-000000000001';
  const deleted = '00000000-0000-4000-8000-000000000002';
  const missing = '00000000-0000-4000-8000-000000000003';
  const products = [{id: live, name: 'a', deletedAt: null}, {id: deleted, name: 'b', deletedAt: new Date()}];
  const writes = [];
  const prisma = {
    product: {
      async findFirst({where}) { return products.find(item => item.id === where.id && (!('deletedAt' in where) || item.deletedAt === where.deletedAt)) || null; },
      async update(args) { writes.push(['product.update', args]); return {...products.find(item => item.id === args.where.id), ...args.data}; },
      async delete(args) { writes.push(['product.delete', args]); return {}; }
    },
    order: {async create(args) { writes.push(['order.create', args]); return {id: 'o1', ...args.data}; }},
    async $transaction(work) { return work(prisma); }
  };
  const engine = load(files.get('src/workflows/engine.js'), {
    '../config/database': {client: prisma},
    events: {publish: async () => {}},
    outbox: {enqueueJob: async () => {}},
    '../middleware/validation': validation
  });

  await assert.rejects(engine.execute('order', {body: {qty: 0}}), error => error.statusCode === 400 && error.details[0] === 'qty must be at least 1');
  await assert.rejects(engine.execute('order', {body: {}}), error => error.statusCode === 400 && error.details[0] === 'qty is required');
  assert.equal(writes.length, 0, 'invalid workflow data never reaches Prisma');
  await engine.execute('order', {body: {qty: 2}});
  assert.deepEqual(writes.pop(), ['order.create', {data: {qty: 2}}]);

  await assert.rejects(engine.execute('touch', {params: {id: missing}}), error => error.statusCode === 404);
  await assert.rejects(engine.execute('touch', {params: {id: deleted}}), error => error.statusCode === 404);
  await assert.rejects(engine.execute('touch', {params: {id: 'not-a-uuid'}}), error => error.statusCode === 400);
  assert.equal(writes.length, 0);

  await engine.execute('remove', {params: {id: live}});
  const [kind, args] = writes.pop();
  assert.equal(kind, 'product.update', 'soft-delete entities are soft-deleted by workflows');
  assert.ok(args.data.deletedAt instanceof Date);
});

test('generated Mongo workflows apply the same soft-delete, 404 and validation rules', () => {
  const spec = workflowSpec();
  spec.database.type = 'mongodb';
  const source = buildFiles(spec).get('src/workflows/engine.js');
  assert.match(source, /const live = id => policy\.enabled \? \{_id: id, \[policy\.field\]: null\} : \{_id: id\};/);
  assert.match(source, /requireRecord\(step\.entity, await withSession\(model\.findOne\(live\(stepId\(step, context\)\)\)\)\)/);
  assert.match(source, /validateStepData\(step\.entity, assertProtectedStorageFields\(step\.entity, resolve\(step\.data, context\)\), false\)/);
  assert.match(source, /model\.findOneAndUpdate\(live\(id\), \{\$set: \{\[policy\.field\]: new Date\(\)\}\}, \{new: true\}\)/);
  assert.doesNotMatch(source, /findByIdAndDelete|findByIdAndUpdate|model\.findById\(/);
});

test('generated error handlers pass workflow error details through', () => {
  const files = buildFiles(workflowSpec());
  assert.match(files.get('src/middleware/error-handler.js'), /res\.status\(error\.statusCode\)\.json\(\{error: error\.message, \.\.\.\(error\.details \? \{details: error\.details\} : \{\}\)\}\)/);
  const mongo = workflowSpec();
  mongo.app.framework = 'fastify';
  mongo.database.type = 'mongodb';
  const native = buildFiles(mongo).get('src/fastify-native.js');
  assert.match(native, /error\.name === "ValidationError"\) return reply\.code\(400\)/);
  assert.match(native, /status < 500 && error\.details \? \{details: error\.details\} : \{\}/);
});

test('generated storage verifies file signatures and serves downloads defensively', () => {
  const spec = normalizeSpec({
    specVersion: '1.0',
    app: {name: 'files-api'},
    database: {type: 'postgresql'},
    storage: {enabled: true, provider: 'local', signedUrls: {enabled: true}},
    entities: {Doc: {fields: {file: {type: 'file', upload: {mimeTypes: ['image/png', 'application/pdf', 'text/plain', 'application/zip']}}}}}
  });
  const source = buildFiles(spec).get('src/config/storage.js');
  const start = source.indexOf('// The declared MIME type comes from the client');
  const end = source.indexOf('async function putFile');
  const helpers = new Function('path', source.slice(start, end) + '\nreturn {contentMatches, downloadHeaders};')(require('node:path'));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  assert.equal(helpers.contentMatches('image/png', png), true);
  assert.equal(helpers.contentMatches('image/png', Buffer.from('not a png')), false);
  assert.equal(helpers.contentMatches('image/png', png.subarray(0, 4)), false, 'truncated signature');
  assert.equal(helpers.contentMatches('application/pdf', Buffer.from('%PDF-1.7\n')), true);
  assert.equal(helpers.contentMatches('application/pdf', png), false);
  assert.equal(helpers.contentMatches('text/plain; charset=utf-8', Buffer.from('hello')), true);
  assert.equal(helpers.contentMatches('text/plain', Buffer.from([0x68, 0x00, 0x69])), false, 'binary declared as text');
  assert.equal(helpers.contentMatches('application/zip', Buffer.from('PK')), true, 'unknown signatures stay accepted');
  assert.match(source, /if \(!contentMatches\(file\.mimetype, file\.buffer\)\) throw storageError/);

  const html = helpers.downloadHeaders({key: 'a/b.html', mimeType: 'text/html', originalName: 'x.html'});
  assert.match(html['Content-Disposition'], /^attachment;/);
  assert.equal(html['X-Content-Type-Options'], 'nosniff');
  assert.match(html['Content-Security-Policy'], /sandbox/);
  assert.match(helpers.downloadHeaders({key: 'a/b.png', mimeType: 'image/png', originalName: 'b.png'})['Content-Disposition'], /^inline;/);
});

function outageSpec(database, options) {
  return normalizeSpec({
    specVersion: '1.0',
    app: {name: 'outage-api'},
    database: {type: database, ...(options ? {options} : {})},
    entities: {Item: {fields: {name: {type: 'string'}}}}
  });
}

test('generated database clients bound connection and query time, keeping explicit overrides', () => {
  const mongo = buildFiles(outageSpec('mongodb')).get('src/config/database.js');
  assert.match(mongo, /mongoose\.connect\(uri, \{"serverSelectionTimeoutMS":5000,"timeoutMS":10000\}\)/);
  const overridden = buildFiles(outageSpec('mongodb', {timeoutMS: 30000, maxPoolSize: 5})).get('src/config/database.js');
  assert.match(overridden, /mongoose\.connect\(uri, \{"serverSelectionTimeoutMS":5000,"timeoutMS":30000,"maxPoolSize":5\}\)/);

  const postgres = buildFiles(outageSpec('postgresql')).get('src/config/database.js');
  const withTimeouts = new Function(postgres.slice(postgres.indexOf('function withTimeouts'), postgres.indexOf('const databaseUrl')) + '\nreturn withTimeouts;')();
  const url = new URL(withTimeouts('postgresql://u:p@db:5432/app?schema=public'));
  assert.deepEqual(Object.fromEntries(url.searchParams), {schema: 'public', connect_timeout: '5', pool_timeout: '5', socket_timeout: '10'});
  assert.equal(new URL(withTimeouts('postgresql://u:p@db/app?socket_timeout=60')).searchParams.get('socket_timeout'), '60');
  assert.equal(withTimeouts('not a url'), 'not a url');
  assert.match(postgres, /new PrismaClient\(\{datasources: \{db: \{url: databaseUrl\}\}\}\)/);
});

test('generated readiness ping gives up on a hung database', async () => {
  const source = buildFiles(outageSpec('mongodb')).get('src/config/database.js');
  const fakeMongoose = {connection: {readyState: 1, db: {admin: () => ({ping: () => new Promise(() => {})})}}};
  const connectDatabase = load(source, {mongoose: fakeMongoose});
  const started = Date.now();
  await assert.rejects(connectDatabase.ping(), /ping timed out after 2000ms/);
  assert.ok(Date.now() - started < 3000);
});

test('generated error handlers answer database outages with 503 and Retry-After', () => {
  for (const database of ['mongodb', 'postgresql']) {
    const handler = load(buildFiles(outageSpec(database)).get('src/middleware/error-handler.js'), {});
    for (const error of [
      Object.assign(new Error('x'), {name: 'MongoServerSelectionError'}),
      Object.assign(new Error('x'), {name: 'MongoOperationTimeoutError'}),
      Object.assign(new Error('Operation `items.find()` buffering timed out after 10000ms'), {name: 'MongooseError'}),
      Object.assign(new Error('x'), {code: 'P1001'}),
      Object.assign(new Error('x'), {code: 'P2024'}),
      Object.assign(new Error('x'), {name: 'PrismaClientInitializationError'})
    ]) {
      const sent = {headers: {}};
      handler(error, {}, {setHeader(name, value) { sent.headers[name] = value; }, status(code) { sent.code = code; return this; }, json(body) { sent.body = body; return this; }}, () => {});
      assert.equal(sent.code, 503, database + ' ' + (error.name || error.code));
      assert.equal(sent.headers['Retry-After'], '5');
      assert.deepEqual(sent.body, {error: 'Service unavailable'});
    }
  }
  const fastify = outageSpec('postgresql');
  fastify.app.framework = 'fastify';
  assert.match(buildFiles(fastify).get('src/fastify-native.js'), /return reply\.code\(503\)\.header\("Retry-After", "5"\)\.send\(\{error: "Service unavailable"\}\)/);
});

test('generated local auth accepts ordinary email addresses on both frameworks', () => {
  for (const framework of ['express', 'fastify']) {
    const files = buildFiles(normalizeSpec({
      specVersion: '1.0',
      app: {name: 'mail-api', framework},
      database: {type: 'mongodb'},
      auth: {enabled: true, strategies: ['jwt'], jwt: {secretEnv: 'JWT_SECRET'}, local: {enabled: true}},
      entities: {Note: {fields: {title: {type: 'string'}}}}
    }));
    const source = [...files.values()].find(content => typeof content === 'string' && content.includes('function validEmail'));
    const validEmail = new Function(source.match(/function validEmail[^\n]*/)[0] + '\nreturn validEmail;')();
    for (const email of ['bob@shop.com', 'sales@example.co.uk', 'first.last+tag@sub.domain.org']) assert.equal(validEmail(email), true, `${framework}: ${email}`);
    for (const email of ['no-at-sign', 'a b@ex.com', 'a@nodot', '@ex.com']) assert.equal(validEmail(email), false, `${framework}: ${email}`);
  }
});

function relationSpec(framework, database) {
  return normalizeSpec({
    specVersion: '1.0',
    app: {name: 'rel-api', framework},
    database: {type: database},
    entities: {
      Author: {fields: {name: {type: 'string'}}},
      Book: {fields: {author: {type: 'reference', ref: 'Author', required: true, onDelete: 'cascade'}}},
      Review: {fields: {book: {type: 'reference', ref: 'Book', required: true, onDelete: 'cascade'}}},
      Shelf: {fields: {books: {type: 'reference', ref: 'Book', many: true, onDelete: 'restrict'}}}
    }
  });
}

test('generated MongoDB delete engine refuses a deep restrict before writing when there is no transaction', async () => {
  const source = buildFiles(relationSpec('express', 'mongodb')).get('src/config/relation-delete.js');
  const relationDelete = load(source, {});
  const data = {Author: [{_id: 'a1'}], Book: [{_id: 'b1', author: 'a1'}], Review: [{_id: 'r1', book: 'b1'}], Shelf: [{_id: 's1', books: ['b1']}]};
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => value === null ? doc[key] == null : Array.isArray(doc[key]) ? doc[key].includes(value) : doc[key] === value);
  const query = run => ({session() { return this; }, select() { return this; }, then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); }});
  const models = Object.fromEntries(Object.keys(data).map(name => [name, {
    findOne: filter => query(() => data[name].find(doc => matches(doc, filter)) || null),
    find: filter => query(() => data[name].filter(doc => matches(doc, filter))),
    countDocuments: filter => query(() => data[name].filter(doc => matches(doc, filter)).length),
    updateMany: async () => {},
    findOneAndDelete: async filter => { data[name] = data[name].filter(doc => !matches(doc, filter)); }
  }]));
  await assert.rejects(relationDelete(models, 'Author', 'a1', null), error => error.statusCode === 409 && /Shelf\.books/.test(error.message));
  assert.deepEqual([data.Author.length, data.Book.length, data.Review.length], [1, 1, 1]);
  data.Shelf = [];
  await relationDelete(models, 'Author', 'a1', null);
  assert.deepEqual([data.Author.length, data.Book.length, data.Review.length], [0, 0, 0]);
});

test('generated Express controllers delete through the shared relation engine and PostgreSQL checks references', () => {
  for (const database of ['mongodb', 'postgresql']) {
    const files = buildFiles(relationSpec('express', database));
    assert.ok(files.has('src/config/relation-delete.js'), database);
    const author = files.get('src/controllers/AuthorController.js');
    assert.match(author, /relationDelete\(/);
    assert.doesNotMatch(author, /deleteMany/);
    if (database === 'mongodb') assert.match(author, /const relationModels = \{Author, Book, Review, Shelf\};/);
    else assert.match(files.get('src/controllers/BookController.js'), /const missing = await missingReferences\(req\.body \|\| \{\}\);/);
  }
  const native = buildFiles(relationSpec('fastify', 'postgresql')).get('src/fastify-crud.js');
  assert.match(native, /if \(postgres && \["create", "update"\]\.includes\(action\)\) \{/);
});

test('generated MongoDB delete engine ignores soft-deleted dependents for restrict', async () => {
  const spec = normalizeSpec({
    specVersion: '1.0', app: {name: 'soft-api'}, database: {type: 'mongodb'},
    entities: {
      Category: {fields: {name: {type: 'string'}}},
      Product: {softDelete: {enabled: true, field: 'deletedAt'}, fields: {category: {type: 'reference', ref: 'Category', onDelete: 'restrict'}}}
    }
  });
  const relationDelete = load(buildFiles(spec).get('src/config/relation-delete.js'), {});
  const filters = [];
  const query = value => ({session() { return this; }, then(resolve) { return Promise.resolve(value).then(resolve); }});
  const models = {
    Category: {findOne: () => query({_id: 'c1'}), findOneAndDelete: async () => {}},
    Product: {countDocuments: filter => { filters.push(filter); return query(0); }}
  };
  await relationDelete(models, 'Category', 'c1', {});
  assert.deepEqual(filters, [{category: 'c1', deletedAt: null}]);
});
