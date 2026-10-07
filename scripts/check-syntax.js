'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const roots = ['bin', 'src', 'scripts'];

function collect(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file, files);
    else if (entry.isFile() && file.endsWith('.js')) files.push(file);
  }
  return files;
}

const files = roots.flatMap(root => collect(root));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log('Syntax OK for ' + files.length + ' JavaScript files.');
