#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BETA_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta\.(?:0|[1-9]\d*)$/;

function loadRelease(root = path.resolve(__dirname, '..')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'json-to-express') throw new Error('Unexpected npm package name');
  if (!BETA_VERSION.test(pkg.version)) {
    throw new Error('package.json must declare a valid beta prerelease version');
  }
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const pattern = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})[ \t]*$/gm;
  const headers = [...changelog.matchAll(pattern)];
  if (!headers.length) throw new Error('CHANGELOG.md has no dated release entries');
  const seen = new Set();
  const entries = headers.map((header, index) => {
    const version = header[1];
    if (seen.has(version)) throw new Error('Duplicate changelog release ' + version);
    seen.add(version);
    const date = header[2];
    if (!BETA_VERSION.test(version)) throw new Error('Invalid beta changelog version: ' + version);
    const timestamp = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString().slice(0, 10) !== date) {
      throw new Error('Invalid changelog release date: ' + date);
    }
    const begin = header.index + header[0].length;
    const end = index + 1 < headers.length ? headers[index + 1].index : changelog.length;
    const body = changelog.slice(begin, end).trim();
    if (!/^- \S/m.test(body)) throw new Error('Changelog release ' + version + ' needs a substantive bullet');
    return {version, date, body};
  });
  if (entries[0].version !== pkg.version) {
    throw new Error('Latest changelog release ' + entries[0].version +
      ' does not match package.json ' + pkg.version);
  }
  return {name: pkg.name, version: pkg.version, tag: 'v' + pkg.version, entry: entries[0]};
}

function releaseNotes(release) {
  return [
    '# ' + release.name + ' ' + release.tag,
    '',
    'Public beta release (' + release.entry.date + ').',
    '',
    release.entry.body,
    '',
    'Install: npm install -g ' + release.name + '@beta',
    '',
    'Requires Node.js >=18. Prerelease APIs may change before 1.0.0.',
    ''
  ].join('\n');
}

function main(args) {
  const command = args[0] || 'check';
  const release = loadRelease();
  if (command === 'check') console.log('Release metadata OK: ' + release.tag);
  else if (command === 'version') console.log(release.version);
  else if (command === 'tag') console.log(release.tag);
  else if (command === 'notes') process.stdout.write(releaseNotes(release));
  else throw new Error('Unknown release metadata command: ' + command);
}

if (require.main === module) {
  try {main(process.argv.slice(2));}
  catch (error) {
    console.error('release-metadata: ' + error.message);
    process.exitCode = 1;
  }
}
module.exports = {loadRelease, releaseNotes};
