'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_NAME = '.j2e-manifest.json';
const MANIFEST_VERSION = 1;

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function manifestPath(outputDir) {
  return path.join(outputDir, MANIFEST_NAME);
}

function readManifest(outputDir) {
  const file = manifestPath(outputDir);
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.version !== MANIFEST_VERSION || !value.files || typeof value.files !== 'object') {
      throw new Error('unsupported manifest format');
    }
    return value;
  } catch (error) {
    throw new Error('Invalid ' + MANIFEST_NAME + ': ' + error.message);
  }
}

function assertSafeTarget(outputDir) {
  const target = path.resolve(outputDir);
  const root = path.parse(target).root;
  const home = process.env.HOME && path.resolve(process.env.HOME);
  if (target === root || target === process.cwd() || (home && target === home)) {
    throw new Error('Refusing to generate into unsafe directory: ' + target);
  }
}

function writeGeneratedFiles(outputDir, files, options = {}) {
  assertSafeTarget(outputDir);
  fs.mkdirSync(outputDir, {recursive: true});

  const existing = fs.readdirSync(outputDir);
  const oldManifest = readManifest(outputDir);
  if (existing.length > 0 && !oldManifest) {
    throw new Error(
      'Output directory is not owned by json-to-express: ' + outputDir +
      '. Choose another directory; existing unowned directories are never deleted.'
    );
  }

  const conflicts = [];
  const staleConflicts = [];

  if (oldManifest) {
    for (const [relativePath, oldHash] of Object.entries(oldManifest.files)) {
      const destination = path.join(outputDir, relativePath);
      if (!fs.existsSync(destination)) continue;
      const currentHash = hash(fs.readFileSync(destination));
      const nextContent = files.get(relativePath);
      if (nextContent !== undefined) {
        const nextHash = hash(nextContent);
        if (currentHash !== oldHash && currentHash !== nextHash) conflicts.push(relativePath);
      } else if (currentHash !== oldHash) {
        staleConflicts.push(relativePath);
      }
    }
  }

  if ((conflicts.length || staleConflicts.length) && !options.force) {
    const paths = [...conflicts, ...staleConflicts];
    throw new Error(
      'Refusing to overwrite developer-modified generated files: ' + paths.join(', ') +
      '. Re-run with --force to replace only these generator-owned files.'
    );
  }

  if (oldManifest) {
    for (const relativePath of Object.keys(oldManifest.files)) {
      if (files.has(relativePath)) continue;
      const destination = path.join(outputDir, relativePath);
      if (!fs.existsSync(destination)) continue;
      const currentHash = hash(fs.readFileSync(destination));
      if (currentHash === oldManifest.files[relativePath] || options.force) fs.rmSync(destination, {force: true});
    }
  }

  const nextManifest = {version: MANIFEST_VERSION, files: {}};
  for (const [relativePath, content] of files) {
    const destination = path.join(outputDir, relativePath);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, content, 'utf8');
    nextManifest.files[relativePath] = hash(content);
  }

  fs.writeFileSync(manifestPath(outputDir), JSON.stringify(nextManifest, null, 2) + '\n', 'utf8');
  return nextManifest;
}

module.exports = {MANIFEST_NAME, hash, readManifest, writeGeneratedFiles};
