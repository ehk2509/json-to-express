'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const API_VERSION = 1;
const KINDS = Object.freeze(['generator', 'database', 'middleware', 'authentication', 'storage']);
const MAX_REQUEST = 512 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;
const MAX_FILES = 256;
const MAX_FILE_SIZE = 1024 * 1024;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateDeclarations(plugins) {
  if (plugins === undefined) return [];
  if (!Array.isArray(plugins) || plugins.length > 16) {
    throw new Error('plugins must be an array of at most 16 entries');
  }
  const names = new Set();
  for (const item of plugins) {
    if (!isObject(item) || typeof item.module !== 'string' || !item.module.trim() ||
        item.module.length > 240 || !KINDS.includes(item.kind) ||
        (item.options !== undefined && !isObject(item.options)) ||
        (item.allowOverrides !== undefined && (!Array.isArray(item.allowOverrides) ||
          item.allowOverrides.some(x => typeof x !== 'string')))) {
      throw new Error('Invalid plugin declaration (module, kind, options, allowOverrides)');
    }
    if (names.has(item.module)) throw new Error('Duplicate plugin module: ' + item.module);
    names.add(item.module);
    for (const filename of item.allowOverrides || []) safeArtifactPath(filename);
  }
  return plugins;
}

function safeArtifactPath(filename) {
  if (typeof filename !== 'string' || !filename || filename.length > 240 ||
      filename.includes('\\') || filename.includes('\0') ||
      filename === '.j2e-manifest.json' || path.posix.isAbsolute(filename) ||
      path.posix.normalize(filename) !== filename ||
      filename === '.' || filename === '..' || filename.startsWith('../') ||
      filename.split('/').some(segment => segment === '..' || segment === '.' || !segment)) {
    throw new Error('Unsafe plugin output path: ' + String(filename));
  }
  return filename;
}

function invokePlugin(declaration, spec, pluginRoot) {
  const root = path.resolve(pluginRoot || process.cwd());
  const candidate = declaration.module;
  const modulePath = candidate.startsWith('.') || path.isAbsolute(candidate)
    ? require.resolve(path.resolve(root, candidate))
    : require.resolve(candidate, {paths: [root]});
  if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
    throw new Error('Plugin module not found: ' + candidate);
  }
  const payload = JSON.stringify({modulePath, kind: declaration.kind, spec, options: declaration.options || {}});
  if (Buffer.byteLength(payload) > MAX_REQUEST) throw new Error('Plugin request exceeds size limit');
  // A worker is a fault-containment boundary, NOT a security sandbox:
  // plugins are user-installed Node modules with filesystem access.
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  const result = spawnSync(process.execPath, [
    '--max-old-space-size=96', path.join(__dirname, 'plugin-worker.js')
  ], {
    cwd: root, input: payload, encoding: 'utf8', timeout: 7500,
    maxBuffer: MAX_OUTPUT, env, windowsHide: true
  });
  if (result.error) throw new Error('Plugin process failed (' + candidate + '): ' + result.error.message);
  if (result.status !== 0) {
    // A plugin error is a failure, not an excuse to produce a partial project.
    const message = (result.stderr || '').trim().slice(0, 500);
    throw new Error('Plugin ' + candidate + ' failed: ' + (message || 'exit ' + result.status));
  }
  let response;
  try {response = JSON.parse(result.stdout);}
  catch (_) {throw new Error('Plugin ' + candidate + ' returned invalid JSON');}
  if (!isObject(response) || response.apiVersion !== API_VERSION ||
      response.kind !== declaration.kind ||
      typeof response.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(response.id) ||
      !['augment', 'project'].includes(response.mode) || !isObject(response.files) ||
      !Array.isArray(response.overrides)) {
    throw new Error('Plugin ' + candidate + ' returned an invalid API v1 contribution');
  }
  if (response.mode === 'project' && !['generator', 'database'].includes(response.kind)) {
    throw new Error('Only generator/database plugins may provide a complete project');
  }
  const entries = Object.entries(response.files);
  if (entries.length > MAX_FILES) throw new Error('Plugin ' + candidate + ' returned too many files');
  for (const [filename, content] of entries) {
    safeArtifactPath(filename);
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE_SIZE) {
      throw new Error('Invalid plugin file content: ' + filename);
    }
  }
  if (response.overrides.some(x => typeof x !== 'string' || !Object.prototype.hasOwnProperty.call(response.files, x))) {
    throw new Error('Plugin overrides must reference returned files');
  }
  for (const file of response.overrides) {
    safeArtifactPath(file);
    if (!declaration.allowOverrides || !declaration.allowOverrides.includes(file)) {
      throw new Error('Plugin ' + candidate + ' attempted undeclared file override: ' + file);
    }
  }
  return response;
}

function executePlugins(plugins, spec, {pluginRoot, builtFiles, projectMode = false} = {}) {
  const declarations = validateDeclarations(plugins);
  const files = new Map(builtFiles || []);
  const ids = new Set();
  const meta = [];
  let projectCount = 0;
  for (const declaration of declarations) {
    const result = invokePlugin(declaration, spec, pluginRoot);
    if (ids.has(result.id)) throw new Error('Duplicate plugin id ' + result.id);
    ids.add(result.id);
    if (result.mode === 'project') {
      projectCount++;
      if (!projectMode || projectCount > 1 || files.size) {
        throw new Error('Complete-project plugins must be the sole generator for a custom backend');
      }
      if (declaration.kind !== 'database' && declaration.kind !== 'generator') {
        throw new Error('Invalid complete-project provider kind');
      }
    } else if (projectMode) {
      // Other augmenting plugin kinds may be appended after a custom provider,
      // but the provider must have run first.
      if (!projectCount) throw new Error('Custom backend must declare a complete-project database plugin first');
    }
    for (const [file, content] of Object.entries(result.files)) {
      if (files.has(file) && !result.overrides.includes(file)) {
        throw new Error('Plugin output collision without explicit override: ' + file);
      }
      files.set(file, content);
    }
    meta.push({id: result.id, kind: result.kind, mode: result.mode, files: Object.keys(result.files).length});
  }
  if (projectMode && projectCount !== 1) {
    throw new Error('Custom database requires one complete-project provider plugin');
  }
  if (projectMode && !files.has('package.json')) {
    throw new Error('Complete-project provider must generate package.json');
  }
  return {files, plugins: meta};
}

module.exports = {
  API_VERSION, KINDS, validateDeclarations, safeArtifactPath, executePlugins
};
