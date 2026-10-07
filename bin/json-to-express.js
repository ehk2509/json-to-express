#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const {generateApplication, validateSpec} = require('../src');

function printHelp() {
  console.log([
    'json-to-express ' + pkg.version,
    '',
    'Usage:',
    '  j2e validate <spec.json>',
    '  j2e generate <spec.json> [--output <dir>] [--force]',
    '',
    'Options:',
    '  -o, --output <dir>  Output directory',
    '  --force             Replace an existing output directory',
    '  -h, --help          Show help',
    '  -v, --version       Show version'
  ].join('\n'));
}

function readSpec(file) {
  const absolute = path.resolve(file);
  let raw;
  try {
    raw = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new Error('Could not read specification: ' + absolute + '\n' + error.message);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid JSON in ' + absolute + ': ' + error.message);
  }
}

function optionValue(args, shortName, longName) {
  const shortIndex = args.indexOf(shortName);
  const longIndex = args.indexOf(longName);
  const index = shortIndex >= 0 ? shortIndex : longIndex;
  if (index < 0) return null;
  if (!args[index + 1] || args[index + 1].startsWith('-')) {
    throw new Error(longName + ' expects a value.');
  }
  return args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }
  if (args.includes('-v') || args.includes('--version')) {
    console.log(pkg.version);
    return;
  }

  const command = args[0];
  const specFile = args[1];
  if (!specFile) throw new Error('Missing specification file. Run j2e --help for usage.');

  const spec = readSpec(specFile);

  if (command === 'validate') {
    validateSpec(spec);
    console.log('✓ Specification is valid.');
    return;
  }

  if (command === 'generate') {
    const outputOption = optionValue(args, '-o', '--output');
    const defaultOutput = path.join(process.cwd(), 'generated', String(spec.app && spec.app.name || 'app'));
    const outputDir = path.resolve(outputOption || defaultOutput);
    const result = generateApplication(spec, outputDir, {force: args.includes('--force')});
    console.log('✓ Generated ' + result.files.length + ' files in ' + result.outputDir);
    console.log('  cd ' + path.relative(process.cwd(), result.outputDir));
    console.log('  npm install');
    console.log('  cp .env.example .env');
    console.log('  npm start');
    return;
  }

  throw new Error('Unknown command: ' + command + '. Run j2e --help for usage.');
}

try {
  main();
} catch (error) {
  console.error('json-to-express: ' + error.message);
  process.exitCode = 1;
}
