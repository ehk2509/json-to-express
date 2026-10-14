'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {compareSnapshots, policyErrors} = require('./evolution');

const MANIFEST_NAME = '.j2e-manifest.json';
const MANIFEST_VERSION = 2;

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}
function manifestPath(outputDir) {
  return path.join(outputDir, MANIFEST_NAME);
}
function safeRelative(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath ||
      path.isAbsolute(relativePath) || relativePath.includes('\\') ||
      relativePath === MANIFEST_NAME) {
    throw new Error('Unsafe generated file path: ' + relativePath);
  }
  const normal = path.posix.normalize(relativePath);
  if (normal !== relativePath || normal === '.' || normal === '..' ||
      normal.startsWith('../')) {
    throw new Error('Unsafe generated file path: ' + relativePath);
  }
  return relativePath;
}
function assertNoSymlink(absolute) {
  let cursor = path.resolve(absolute);
  while (true) {
    if (fs.existsSync(cursor) || (() => {try {fs.lstatSync(cursor); return true;} catch (e) {return e.code !== 'ENOENT';}})()) {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Refusing symbolic link in output path: ' + cursor);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
function assertSafeTarget(outputDir) {
  const target = path.resolve(outputDir);
  const root = path.parse(target).root;
  const home = process.env.HOME && path.resolve(process.env.HOME);
  if (target === root || target === process.cwd() || (home && target === home)) {
    throw new Error('Refusing to generate into unsafe directory: ' + target);
  }
  assertNoSymlink(target);
}
function readManifest(outputDir) {
  const file = manifestPath(outputDir);
  assertNoSymlink(file);
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (![1, 2].includes(value.version) || !value.files ||
        typeof value.files !== 'object' || Array.isArray(value.files)) {
      throw new Error('unsupported manifest format');
    }
    for (const [relativePath, digest] of Object.entries(value.files)) {
      safeRelative(relativePath);
      if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
        throw new Error('invalid file digest for ' + relativePath);
      }
    }
    if (value.version === 2 && (!value.schema || value.schema.version !== 1)) {
      throw new Error('missing or invalid schema history');
    }
    return value;
  } catch (error) {
    throw new Error('Invalid ' + MANIFEST_NAME + ': ' + error.message);
  }
}

// The pure inspection phase does not create directories or mutate files.
function planGeneratedFiles(outputDir, files, snapshot) {
  assertSafeTarget(outputDir);
  const old = readManifest(outputDir);
  if (fs.existsSync(outputDir) && !fs.statSync(outputDir).isDirectory()) {
    throw new Error('Output target is not a directory: ' + outputDir);
  }
  if (!old && fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) {
    throw new Error('Output directory is not owned by json-to-express: ' + outputDir +
      '. Choose another directory; existing unowned directories are never deleted.');
  }
  const actions = [];
  const tracked = old ? old.files : {};
  for (const [relativePath, content] of files) {
    safeRelative(relativePath);
    const destination = path.join(outputDir, relativePath);
    assertNoSymlink(destination);
    const owned = Object.prototype.hasOwnProperty.call(tracked, relativePath);
    const exists = fs.existsSync(destination);
    if (exists && !owned) {
      // Force must never overwrite developer-owned files.
      throw new Error('Refusing to overwrite unowned file: ' + relativePath);
    }
    if (exists && !fs.statSync(destination).isFile()) throw new Error('Generated destination is not a file: ' + relativePath);
    const nextHash = hash(content);
    const currentHash = exists ? hash(fs.readFileSync(destination)) : null;
    const status = !exists ? (owned ? 'restore' : 'add') :
      currentHash === nextHash ? 'unchanged' :
      currentHash === tracked[relativePath] ? 'update' : 'conflict';
    actions.push({path: relativePath, status, currentHash, nextHash});
  }
  for (const relativePath of Object.keys(tracked)) {
    if (files.has(relativePath)) continue;
    const destination = path.join(outputDir, relativePath);
    assertNoSymlink(destination);
    if (!fs.existsSync(destination)) continue;
    if (!fs.statSync(destination).isFile()) throw new Error('Stale generated path is not a file: ' + relativePath);
    const currentHash = hash(fs.readFileSync(destination));
    actions.push({
      path: relativePath,
      status: currentHash === tracked[relativePath] ? 'remove' : 'stale-conflict',
      currentHash,
      nextHash: null
    });
  }
  actions.sort((a, b) => a.path.localeCompare(b.path));
  const changes = old ? compareSnapshots(old.version === 2 ? old.schema : null, snapshot) : [];
  const status = !old ? 'new' : old.version === 1 ? 'legacy' : 'tracked';
  return {
    outputDir: path.resolve(outputDir),
    status,
    actions,
    schemaChanges: changes,
    summary: Object.fromEntries(['add', 'update', 'restore', 'remove', 'conflict', 'stale-conflict', 'unchanged']
      .map(key => [key, actions.filter(action => action.status === key).length])),
    // A SHA-256 digest of the declarative schema only; no authentication or seed data.
    schemaFingerprint: hash(JSON.stringify(snapshot)),
    blocking: {
      modifiedFiles: actions.filter(action => ['conflict', 'stale-conflict'].includes(action.status)).map(action => action.path),
      schema: policyErrors(changes)
    }
  };
}
function writeGeneratedFiles(outputDir, files, options = {}) {
  if (!options.schemaSnapshot) throw new Error('Schema snapshot required for safe regeneration');
  const plan = planGeneratedFiles(outputDir, files, options.schemaSnapshot);
  const problems = policyErrors(plan.schemaChanges, options);
  if (problems.length) throw new Error('Unsafe schema evolution: ' + problems.join('; '));
  if (plan.blocking.modifiedFiles.length && !options.force) {
    throw new Error('Refusing to overwrite developer-modified generated files: ' +
      plan.blocking.modifiedFiles.join(', ') +
      '. Re-run with --force to replace only these generator-owned files.');
  }
  fs.mkdirSync(outputDir, {recursive: true});
  for (const action of plan.actions) {
    if (action.status !== 'remove' && action.status !== 'stale-conflict') continue;
    const destination = path.join(outputDir, action.path);
    if (fs.existsSync(destination)) fs.rmSync(destination);
  }
  const manifest = {version: MANIFEST_VERSION, files: {}, schema: options.schemaSnapshot};
  for (const [relativePath, content] of files) {
    const destination = path.join(outputDir, relativePath);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, content, 'utf8');
    manifest.files[relativePath] = hash(content);
  }
  fs.writeFileSync(manifestPath(outputDir), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}
module.exports = {
  MANIFEST_NAME, MANIFEST_VERSION, hash, readManifest,
  planGeneratedFiles, writeGeneratedFiles, assertSafeTarget
};
