'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {validateSpec} = require('./validate-spec');
const {planApplication} = require('./generator');

function parseDoctorArgs(args) {
  const options = {json: false, strict: false};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json' || arg === '--strict') {
      const key = arg.slice(2);
      if (options[key]) throw new Error('Duplicate option ' + arg);
      options[key] = true;
    } else if (arg === '-o' || arg === '--output') {
      if (options.output || !args[i + 1] || args[i + 1].startsWith('-')) {
        throw new Error('--output expects one directory');
      }
      options.output = path.resolve(args[++i]);
    } else if (!arg.startsWith('-') && !options.specFile) {
      options.specFile = path.resolve(arg);
    } else throw new Error('Unknown doctor argument: ' + arg);
  }
  if (!options.specFile) {
    const candidate = path.resolve('app.j2e.json');
    if (fs.existsSync(candidate)) options.specFile = candidate;
  }
  return options;
}

function command(program, args = []) {
  try {
    const result = spawnSync(program, args, {encoding: 'utf8', timeout: 5000, windowsHide: true});
    return {ok: result.status === 0, version: ((result.stdout || '').trim().split('\n')[0] || '').slice(0, 100)};
  } catch (_) {return {ok: false, version: ''};}
}

function diagnose(options = {}) {
  const checks = [];
  function add(level, code, message, remedy) {
    checks.push({level, code, message, ...(remedy ? {remedy} : {})});
  }
  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 18 ? 'ok' : 'error', 'node', 'Node.js ' + process.versions.node,
    major < 18 ? 'Install Node.js 18 or newer' : undefined);
  const npm = command('npm', ['--version']);
  add(npm.ok ? 'ok' : 'error', 'npm', npm.ok ? 'npm ' + npm.version : 'npm is not available',
    npm.ok ? undefined : 'Install npm with Node.js');

  const templateRoot = path.resolve(__dirname, '..', 'templates');
  for (const template of ['crud', 'saas', 'ecommerce']) {
    add(fs.existsSync(path.join(templateRoot, template + '.json')) ? 'ok' : 'error',
      'template-' + template, 'Bundled starter ' + template,
      'Reinstall json-to-express if the template is missing');
  }

  let spec = null;
  if (options.specFile) {
    try {
      spec = JSON.parse(fs.readFileSync(options.specFile, 'utf8'));
      validateSpec(spec);
      add('ok', 'specification', 'Specification is valid');
    } catch (error) {
      add('error', 'specification', 'Invalid specification: ' + error.message,
        'Correct the JSON/specification and rerun j2e doctor');
    }
  } else add('info', 'specification', 'No specification supplied; environment-only checks performed',
    'Run j2e doctor app.j2e.json to inspect an application');

  if (spec) {
    const deploy = spec.deployment || {};
    const wantsDocker = Boolean(deploy.docker && deploy.docker.enabled);
    if (wantsDocker) {
      const docker = command('docker', ['--version']);
      add(docker.ok ? 'ok' : 'warning', 'docker',
        docker.ok ? docker.version : 'Docker CLI not detected',
        docker.ok ? undefined : 'Install Docker for generated container deployment');
    }
    if (deploy.compose && deploy.compose.enabled) {
      const compose = command('docker', ['compose', 'version']);
      add(compose.ok ? 'ok' : 'warning', 'compose',
        compose.ok ? compose.version : 'Docker Compose plugin not detected',
        compose.ok ? undefined : 'Install Docker Compose and ensure docker compose version works');
    }
    if (deploy.kubernetes && deploy.kubernetes.enabled) {
      const kubectl = command('kubectl', ['version', '--client']);
      add(kubectl.ok ? 'ok' : 'warning', 'kubernetes',
        kubectl.ok ? 'kubectl available' : 'kubectl CLI not detected',
        kubectl.ok ? undefined : 'Install kubectl before deploying to Kubernetes');
    }
    const auth = spec.auth || {};
    const needed = new Set();
    if (auth.enabled) {
      const strategies = auth.strategies || (auth.strategy ? [auth.strategy] : ['jwt']);
      if (strategies.includes('jwt')) needed.add(auth.jwt && auth.jwt.secretEnv || auth.secretEnv || 'JWT_SECRET');
      if (strategies.includes('apiKey')) {
        for (const key of auth.apiKey && auth.apiKey.keys || []) needed.add(key.env);
      }
      if (strategies.includes('oidc') || auth.oidc && auth.oidc.enabled) {
        needed.add(auth.oidc && auth.oidc.clientIdEnv || 'OIDC_CLIENT_ID');
      }
    }
    for (const name of [...needed].sort()) {
      add(process.env[name] ? 'ok' : 'warning', 'env-' + name,
        process.env[name] ? name + ' configured in this process' : name + ' not present in this process environment',
        process.env[name] ? undefined : 'Set ' + name + ' in the generated app runtime environment or .env file; secrets are never printed');
    }

    let output = options.output;
    if (!output) {
      output = path.resolve(path.dirname(options.specFile),
        spec.generation && spec.generation.outputDir || 'server');
    }
    try {
      const plan = planApplication(spec, output);
      if (plan.status === 'new') {
        add('warning', 'generation', 'Generated application not found at ' + output,
          'Run j2e generate app.j2e.json --output server from the workspace');
      } else {
        add('ok', 'generation', 'Generator manifest detected (' + plan.status + ')');
        if (plan.blocking.modifiedFiles.length) {
          add('error', 'modified-files',
            'Developer-modified generated files: ' + plan.blocking.modifiedFiles.join(', '),
            'Review with j2e diff; never force without a deliberate decision');
        }
        for (const risk of plan.schemaChanges) {
          const level = risk.severity === 'safe' ? 'info' :
            ['breaking', 'unknown'].includes(risk.severity) ? 'error' : 'warning';
          add(level, 'schema-' + risk.code, risk.path + ': ' + risk.message,
            'Review j2e plan and required database migrations before upgrading');
        }
        const changed = plan.actions.filter(item => item.status !== 'unchanged').length;
        if (changed) add('info', 'pending-generation', changed + ' generator-owned file changes pending',
          'Run j2e plan for details');
      }
    } catch (error) {
      add('error', 'generation', 'Cannot inspect generated application: ' + error.message,
        'Use j2e plan to identify conflicts or unsafe paths');
    }
    if (spec.database && spec.database.type === 'postgresql') {
      add('info', 'prisma', 'PostgreSQL requires reviewed Prisma migrations and a running database',
        'Review migration SQL and run db:migrate:verify / db:migrate:deploy before production');
    }
  }

  const errors = checks.filter(c => c.level === 'error').length;
  const warnings = checks.filter(c => c.level === 'warning').length;
  return {ok: errors === 0 && (!options.strict || warnings === 0), errors, warnings, checks};
}

module.exports = {parseDoctorArgs, diagnose};
