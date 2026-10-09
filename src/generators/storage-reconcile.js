'use strict';

const {filePaths, js, relativeRequire} = require('./utils');

module.exports = function storageReconcileSource(spec) {
  const paths = filePaths(spec);
  const target = 'scripts/storage-reconcile.js';
  const entities = spec.entities.filter(entity => entity.fields.some(field => field.type === 'file')).map(entity => ({
    name: entity.name,
    modelPath: spec.database.type === 'mongodb' ? relativeRequire(target, filePaths(spec, entity.name).model) : null,
    fields: entity.fields.filter(field => field.type === 'file').map(field => ({
      name: field.name,
      prefix: (field.upload && field.upload.directory) || entity.name.toLowerCase() + '/' + field.name
    }))
  }));
  const template = String.raw`
'use strict';

require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const connectDatabase = require(__DATABASE_REQUIRE__);
const storage = require(__STORAGE_REQUIRE__);
const config = __STORAGE_CONFIG__;
const entities = __ENTITY_CONFIG__;
const postgres = __IS_POSTGRES__;

function args(argv) {
  const readValue = (name, fallback) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : argv[index + 1];
  };
  const execute = argv.includes('--execute');
  const olderThanHours = Number(readValue('--older-than-hours', '24'));
  const limit = Number(readValue('--limit', '100'));
  const maxScan = Number(readValue('--max-scan', '5000'));
  if (!Number.isFinite(olderThanHours) || olderThanHours < 24) throw new Error('The minimum storage reconciliation age is 24 hours');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be 1..100');
  if (!Number.isSafeInteger(maxScan) || maxScan < 1 || maxScan > 50000) throw new Error('--max-scan must be 1..50000');
  return {execute, olderThanHours, limit, maxScan};
}
function safePrefix(prefix) {
  const value = String(prefix || '').replace(/\\/g, '/');
  const normalized = path.posix.normalize(value).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized === '..' ||
      normalized.startsWith('../') || normalized.includes('/../') ||
      path.posix.isAbsolute(value)) throw new Error('Unsafe storage prefix');
  return normalized.replace(/\/?$/, '/');
}
function referencesIn(value, target) {
  if (Array.isArray(value)) {for (const part of value) referencesIn(part, target);return;}
  if (value && typeof value === 'object' && typeof value.key === 'string') target.add(value.key);
}
async function referencedKeys() {
  const keys = new Set();
  for (const entity of entities) {
    const names = entity.fields.map(field => field.name);
    if (postgres) {
      const model = connectDatabase.client[entity.name[0].toLowerCase() + entity.name.slice(1)];
      const select = Object.fromEntries(names.map(name => [name, true]));
      select.id = true;
      let skip = 0;
      for (;;) {
        const records = await model.findMany({select, skip, take: 200, orderBy: {id: 'asc'}});
        for (const record of records) for (const name of names) referencesIn(record[name], keys);
        skip += records.length;
        if (records.length < 200) break;
      }
    } else {
      const model = require(entity.modelPath);
      for await (const record of model.find({}, names.join(' ')).lean().cursor()) {
        for (const name of names) referencesIn(record[name], keys);
      }
    }
  }
  return keys;
}
async function inventory(prefixes, cutoff, maxScan) {
  const items = [];
  let scanned = 0;
  let truncated = false;
  if (config.provider === 'local') {
    const root = path.resolve(process.cwd(), config.local.directory);
    async function visit(folder) {
      if (scanned >= maxScan) {truncated = true; return;}
      let entries;
      try {entries = await fs.readdir(folder, {withFileTypes: true});}
      catch (error) {if (error.code === 'ENOENT') return; throw error;}
      for (const entry of entries) {
        if (scanned >= maxScan) {truncated = true; return;}
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) await visit(full);
        else if (entry.isFile()) {
          scanned += 1;
          const stat = await fs.stat(full);
          if (stat.mtime <= cutoff) items.push({key: path.relative(root, full).split(path.sep).join('/'), provider: 'local'});
        }
      }
    }
    for (const prefix of prefixes) {
      const base = path.resolve(root, prefix);
      if (!base.startsWith(root + path.sep)) throw new Error('Unsafe inventory folder');
      await visit(base);
      if (truncated) break;
    }
  } else {
    const {S3Client, ListObjectsV2Command} = require('@aws-sdk/client-s3');
    const options = {region: process.env[config.s3.regionEnv], forcePathStyle: config.s3.forcePathStyle};
    if (config.s3.endpointEnv && process.env[config.s3.endpointEnv]) options.endpoint = process.env[config.s3.endpointEnv];
    if (config.s3.accessKeyEnv && config.s3.secretKeyEnv &&
        process.env[config.s3.accessKeyEnv] && process.env[config.s3.secretKeyEnv]) {
      options.credentials = {accessKeyId: process.env[config.s3.accessKeyEnv], secretAccessKey: process.env[config.s3.secretKeyEnv]};
    }
    const s3 = new S3Client(options);
    try {
      for (const prefix of prefixes) {
        let continuationToken;
        do {
          const response = await s3.send(new ListObjectsV2Command({
            Bucket: process.env[config.s3.bucketEnv], Prefix: prefix,
            MaxKeys: Math.min(1000, maxScan - scanned), ContinuationToken: continuationToken
          }));
          const contents = response.Contents || [];
          scanned += contents.length;
          for (const entry of contents) {
            if (entry.LastModified && entry.LastModified <= cutoff && entry.Key)
              items.push({key: entry.Key, provider: 's3'});
          }
          continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
          if (scanned >= maxScan) {truncated = true; break;}
        } while (continuationToken);
        if (truncated) break;
      }
    } finally {s3.destroy();}
  }
  return {items, scanned, truncated};
}
async function reconcile(options) {
  const prefixes = [...new Set(entities.flatMap(entity => entity.fields.map(field => safePrefix(field.prefix))))];
  const cutoff = new Date(Date.now() - options.olderThanHours * 3600000);
  const referenced = await referencedKeys();
  const listed = await inventory(prefixes, cutoff, options.maxScan);
  const orphaned = listed.items.filter(item => !referenced.has(item.key));
  const selected = orphaned.slice(0, options.limit);
  let removed = 0;
  if (options.execute) {
    // Re-check all references before executing physical deletion.
    const nowReferenced = await referencedKeys();
    for (const item of selected) if (!nowReferenced.has(item.key)) {
      await storage.cleanup([item]);
      removed += 1;
    }
  }
  return {
    mode: options.execute ? 'execute' : 'dry-run', provider: config.provider,
    minAgeHours: options.olderThanHours, scanned: listed.scanned, truncated: listed.truncated,
    referenced: referenced.size, candidates: orphaned.length,
    selected: selected.length, removed, keys: selected.slice(0, 25).map(item => item.key)
  };
}
async function main() {
  const options = args(process.argv.slice(2));
  await connectDatabase();
  try {console.log(JSON.stringify(await reconcile(options), null, 2));}
  finally {await connectDatabase.disconnect();}
}
if (require.main === module) main().catch(error => {console.error(error);process.exitCode = 1;});
module.exports = {args, safePrefix, reconcile, referencedKeys, inventory};
`;
  return template.trimStart()
    .replace('__DATABASE_REQUIRE__', js(relativeRequire(target, paths.database)))
    .replace('__STORAGE_REQUIRE__', js(relativeRequire(target, paths.storage)))
    .replace('__STORAGE_CONFIG__', js(spec.storage))
    .replace('__ENTITY_CONFIG__', js(entities))
    .replace('__IS_POSTGRES__', String(spec.database.type === 'postgresql'));
};
