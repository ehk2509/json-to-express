#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const {generateApplication, planApplication, validateSpec, recoverTransaction} = require('../src');
const {initialize, parseInitArgs, TEMPLATES} = require('../src/onboarding');
const {parseDoctorArgs, diagnose} = require('../src/doctor');
const pluginCommands = require('../src/plugin-cli');

function printHelp() {
  console.log([
    'json-to-express ' + pkg.version,
    '',
    'Usage:',
    '  j2e init [name] [--template crud|saas|ecommerce] [--yes] [options]',
    '  j2e doctor [spec.json] [--output <dir>] [--json] [--strict]',
    '  j2e plugin catalog | search [term] | info <name[@version]>',
    '  j2e plugin add <package@exact-version> --spec app.j2e.json [--yes]',
    '  j2e plugin list|verify --spec app.j2e.json [--json]',
    '  j2e validate <spec.json>',
    '  j2e generate <spec.json> [--output <dir>] [--force]',
    '  j2e diff <spec.json> [--output <dir>] [--json]',
    '  j2e plan <spec.json> [--output <dir>] [--json]',
    '  j2e upgrade <spec.json> [--output <dir>] [options]',
    '  j2e recover --output <dir>  Recover an interrupted generation',
    '',
    'Options:',
    '  -o, --output <dir>     Output directory',
    '  --force                Replace developer-modified generator-owned files',
    '  --approve-schema       Acknowledge review-level schema risks',
    '  --allow-destructive    Acknowledge breaking schema changes (backup/migrate first)',
    '  --allow-unknown-schema Acknowledge missing legacy schema history',
    '  --json                 Print machine-readable diff, plan or doctor report',
    '  --template <name>      CRUD, SaaS or e-commerce starter (init)',
    '  --framework <name>     express or fastify (init)',
    '  --database <name>      mongodb or postgresql (init)',
    '  --auth <mode>          none, jwt, local, api-key or oidc (init)',
    '  --deployment <mode>    none, docker, compose, kubernetes (init)',
    '  --issuer <https-url>   OIDC issuer (required if auth is oidc)',
    '  --yes                  Use defaults non-interactively (init)',
    '  --dry-run              Validate and preview init without writing',
    '  --list-templates       List built-in starters (init)',
    '  --strict               Treat doctor warnings as failures',
    '  -h, --help             Show help',
    '  -v, --version          Show version',
    '',
    'Plugins are declared in spec.plugins and resolved relative to the spec file.',
    'Install and run only plugins you trust; subprocess isolation is not an OS sandbox.',
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

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) return printHelp();
  if (args.includes('-v') || args.includes('--version')) return console.log(pkg.version);
  const command = args[0], specFile = args[1];
  if (command === 'plugin') {
    console.log(await pluginCommands.execute(args.slice(1)));
    return;
  }
  if (command === 'init') {
    const options = parseInitArgs(args.slice(1));
    const result = await initialize(options);
    if (result.templates) {
      for (const entry of result.templates) console.log(entry.name.padEnd(12) + entry.description);
      return;
    }
    if (result.dryRun) {
      console.log('✓ Starter configuration valid (dry run; no files written).');
      console.log(JSON.stringify({workspace: result.workspace, specFile: result.specFile,
        appDir: result.appDir, template: options['--template'] || 'crud',
        name: result.spec.app.name, framework: result.spec.app.framework,
        database: result.spec.database.type,
        plannedFiles: result.plan.summary.add}, null, 2));
      return;
    }
    console.log('✓ Created ' + result.workspace);
    console.log('  Specification: ' + result.specFile);
    console.log('  Application:   ' + result.appDir);
    console.log('  cd ' + path.relative(process.cwd(), result.workspace));
    if (result.spec.deployment.compose.enabled) {
      console.log('  cd server && docker compose up -d --build');
    } else {
      console.log('  cd server && npm install && npm start');
    }
    console.log('  Run j2e doctor app.j2e.json to check local prerequisites.');
    return;
  }
  if (command === 'doctor') {
    const options = parseDoctorArgs(args.slice(1));
    const report = diagnose(options);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const check of report.checks) {
        console.log('[' + check.level.toUpperCase() + '] ' + check.code + ': ' + check.message);
        if (check.remedy && check.level !== 'ok') console.log('  → ' + check.remedy);
      }
      console.log(report.errors + ' error(s), ' + report.warnings + ' warning(s).');
    }
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === 'recover') {
    if (args.length !== 3 || !['-o', '--output'].includes(args[1]) ||
        !args[2] || args[2].startsWith('-')) {
      throw new Error('Usage: j2e recover --output <dir>');
    }
    const result = recoverTransaction(path.resolve(args[2]));
    console.log('Recovery: ' + result.status);
    if (result.quarantine) console.log('Interrupted generated tree preserved at: ' + result.quarantine);
    return;
  }
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
  const pluginOptions = {pluginRoot: path.dirname(path.resolve(specFile))};
  if (command === 'validate') {
    if (spec.database && !['mongodb', 'postgresql'].includes(spec.database.type)) {
      planApplication(spec, outputDir || path.resolve('generated', spec.app && spec.app.name || 'app'), pluginOptions);
    } else validateSpec(spec);
    console.log('✓ Specification is valid.');
    return;
  }
  if (command === 'diff' || command === 'plan') {
    const plan = planApplication(spec, outputDir, pluginOptions);
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
      allowUnknownSchema: flags.has('--allow-unknown-schema'),
      ...pluginOptions
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
main().catch(error => {
  console.error('json-to-express: ' + error.message);
  process.exitCode = 1;
});
