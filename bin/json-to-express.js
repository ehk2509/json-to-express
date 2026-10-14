#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const {generateApplication, planApplication, validateSpec} = require('../src');

function printHelp() {
  console.log([
    'json-to-express ' + pkg.version,
    '',
    'Usage:',
    '  j2e validate <spec.json>',
    '  j2e generate <spec.json> [--output <dir>] [--force]',
    '  j2e diff <spec.json> [--output <dir>] [--json]',
    '  j2e plan <spec.json> [--output <dir>] [--json]',
    '  j2e upgrade <spec.json> [--output <dir>] [options]',
    '',
    'Options:',
    '  -o, --output <dir>     Output directory',
    '  --force                Replace developer-modified generator-owned files',
    '  --approve-schema       Acknowledge review-level schema risks',
    '  --allow-destructive    Acknowledge breaking schema changes (backup/migrate first)',
    '  --allow-unknown-schema Acknowledge missing legacy schema history',
    '  --json                 Print machine-readable diff or plan',
    '  -h, --help             Show help',
    '  -v, --version          Show version',
    '',
    'Note: schema flags acknowledge risk; they do not execute database migrations.'
  ].join('\n'));
}

function readSpec(file) {
  const absolute = path.resolve(file);
  let raw;
  try {raw = fs.readFileSync(absolute, 'utf8');}
  catch (error) {throw new Error('Could not read specification: ' + absolute + '\n' + error.message);}
  try {return JSON.parse(raw);}
  catch (error) {throw new Error('Invalid JSON in ' + absolute + ': ' + error.message);}
}
function formatPlan(plan, fileOnly = false) {
  console.log('Output: ' + plan.outputDir + ' (' + plan.status + ')');
  for (const action of plan.actions.filter(item => item.status !== 'unchanged')) {
    console.log('  ' + action.status.padEnd(14) + ' ' + action.path);
  }
  if (!fileOnly) {
    console.log('Schema evolution: ' + (plan.schemaChanges.length ? '' : 'no detected risks'));
    for (const change of plan.schemaChanges) {
      console.log('  [' + change.severity + '] ' + change.path + ': ' + change.message);
    }
    for (const error of plan.blocking.schema) console.log('  ACTION REQUIRED: ' + error);
    if (plan.blocking.modifiedFiles.length) {
      console.log('  ACTION REQUIRED: Developer-modified files: ' + plan.blocking.modifiedFiles.join(', '));
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) return printHelp();
  if (args.includes('-v') || args.includes('--version')) return console.log(pkg.version);
  const command = args[0], specFile = args[1];
  if (!specFile || specFile.startsWith('-')) throw new Error('Missing specification file. Run j2e --help.');
  const allowed = new Set(['-o', '--output', '--force', '--approve-schema',
    '--allow-destructive', '--allow-unknown-schema', '--json']);
  let outputDir;
  const flags = new Set();
  for (let index = 2; index < args.length; index++) {
    const flag = args[index];
    if (!allowed.has(flag)) throw new Error('Unknown option: ' + flag);
    if (flag === '-o' || flag === '--output') {
      if (!args[index + 1] || args[index + 1].startsWith('-') || outputDir) {
        throw new Error('--output expects one directory');
      }
      outputDir = path.resolve(args[++index]);
    } else {
      if (flags.has(flag)) throw new Error('Duplicate option: ' + flag);
      flags.add(flag);
    }
  }
  const spec = readSpec(specFile);
  if (command === 'validate') {
    validateSpec(spec);
    console.log('✓ Specification is valid.');
    return;
  }
  if (command === 'diff' || command === 'plan') {
    const plan = planApplication(spec, outputDir);
    if (flags.has('--json')) {
      console.log(JSON.stringify(command === 'diff'
        ? {outputDir: plan.outputDir, status: plan.status, summary: plan.summary, actions: plan.actions}
        : plan, null, 2));
    } else formatPlan(plan, command === 'diff');
    return;
  }
  if (command === 'generate' || command === 'upgrade') {
    const result = generateApplication(spec, outputDir, {
      force: flags.has('--force'),
      approveSchema: flags.has('--approve-schema'),
      allowDestructive: flags.has('--allow-destructive'),
      allowUnknownSchema: flags.has('--allow-unknown-schema')
    });
    console.log('✓ Generated ' + result.files.length + ' files in ' + result.outputDir);
    if (command === 'generate') {
      console.log('  cd ' + path.relative(process.cwd(), result.outputDir));
      console.log('  npm install');
      console.log('  cp .env.example .env');
      console.log('  npm start');
    } else console.log('  Review schema changes and apply database migrations separately.');
    return;
  }
  throw new Error('Unknown command: ' + command + '. Run j2e --help for usage.');
}
try {main();}
catch (error) {
  console.error('json-to-express: ' + error.message);
  process.exitCode = 1;
}
