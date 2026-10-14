'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const {validateSpec} = require('./validate-spec');
const {planApplication, generateApplication} = require('./generator');
const {assertSafeTarget} = require('./manifest');

const TEMPLATES = Object.freeze({
  crud: {label: 'CRUD task manager', defaultName: 'task-api', database: 'mongodb', auth: 'none'},
  saas: {label: 'Multi-tenant SaaS starter', defaultName: 'team-saas-api', database: 'postgresql', auth: 'local'},
  ecommerce: {label: 'E-commerce catalogue and orders', defaultName: 'store-api', database: 'mongodb', auth: 'none'}
});
const FRAMEWORKS = ['express', 'fastify'];
const DATABASES = ['mongodb', 'postgresql'];
const AUTHS = ['none', 'jwt', 'local', 'api-key', 'oidc'];
const DEPLOYMENTS = ['none', 'docker', 'compose', 'kubernetes'];
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function parseInitArgs(args) {
  const options = {};
  const values = new Set(['--template', '--framework', '--database', '--auth', '--deployment', '--output', '--issuer', '--audience']);
  const switches = new Set(['--yes', '--dry-run', '--list-templates']);
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (values.has(option)) {
      if (Object.prototype.hasOwnProperty.call(options, option)) throw new Error('Duplicate option ' + option);
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(option + ' expects a value');
      options[option] = args[++i];
    } else if (switches.has(option)) {
      if (options[option]) throw new Error('Duplicate option ' + option);
      options[option] = true;
    } else if (!option.startsWith('-') && !options.name) {
      options.name = option;
    } else throw new Error('Unknown init argument: ' + option);
  }
  for (const [flag, allowed] of [
    ['--template', Object.keys(TEMPLATES)], ['--framework', FRAMEWORKS],
    ['--database', DATABASES], ['--auth', AUTHS], ['--deployment', DEPLOYMENTS]
  ]) {
    if (options[flag] && !allowed.includes(options[flag])) {
      throw new Error(flag + ' must be one of: ' + allowed.join(', '));
    }
  }
  if (options.name) assertName(options.name);
  if (options['--issuer']) assertIssuer(options['--issuer']);
  return options;
}

function assertName(name) {
  if (typeof name !== 'string' || name.length > 63 || !NAME_PATTERN.test(name)) {
    throw new Error('App name must be lowercase kebab-case (a-z, 0-9, hyphens), at most 63 characters');
  }
  return name;
}

function assertIssuer(issuer) {
  let url;
  try { url = new URL(issuer); } catch (_) { throw new Error('OIDC issuer must be an absolute HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('OIDC issuer must be an HTTPS URL without credentials');
  }
  return issuer;
}

function loadTemplate(name) {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, name)) {
    throw new Error('Unknown template: ' + name);
  }
  // Templates are bundled with the npm CLI and never loaded from arbitrary URLs.
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', name + '.json'), 'utf8'));
}

function authMode(spec) {
  if (!spec.auth || !spec.auth.enabled) return 'none';
  if (spec.auth.local && spec.auth.local.enabled) return 'local';
  if (spec.auth.oidc && spec.auth.oidc.enabled) return 'oidc';
  if (spec.auth.strategies && spec.auth.strategies.includes('apiKey')) return 'api-key';
  return 'jwt';
}

function buildStarter(config) {
  const template = config.template || 'crud';
  const spec = loadTemplate(template);
  const meta = TEMPLATES[template];
  const name = assertName(config.name || meta.defaultName);
  const framework = config.framework || 'express';
  const database = config.database || meta.database;
  const auth = config.auth || authMode(spec);
  const deployment = config.deployment || 'compose';
  if (!FRAMEWORKS.includes(framework) || !DATABASES.includes(database) ||
      !AUTHS.includes(auth) || !DEPLOYMENTS.includes(deployment)) {
    throw new Error('Invalid framework, database, authentication or deployment selection');
  }
  spec.app.name = name;
  spec.app.framework = framework;
  spec.database = {type: database};
  spec.generation = {outputDir: 'server'};
  if (auth === 'none') delete spec.auth;
  else if (auth === 'jwt') spec.auth = {enabled: true, strategies: ['jwt'], jwt: {enabled: true}};
  else if (auth === 'local') spec.auth = {
    enabled: true, strategies: ['jwt'], jwt: {enabled: true}, local: {enabled: true, allowRegistration: true}
  };
  else if (auth === 'api-key') spec.auth = {
    enabled: true, strategies: ['apiKey'], apiKey: {enabled: true, keys: [{env: 'API_KEY'}]}
  };
  else {
    if (!config.issuer) throw new Error('OIDC authentication requires --issuer (HTTPS)');
    spec.auth = {enabled: true, strategies: ['oidc'], oidc: {
      enabled: true, issuer: assertIssuer(config.issuer), clientIdEnv: 'OIDC_CLIENT_ID',
      ...(config.audience ? {audience: config.audience} : {})
    }};
  }
  spec.deployment = {
    docker: {enabled: ['docker', 'compose', 'kubernetes'].includes(deployment)},
    compose: {enabled: deployment === 'compose'},
    kubernetes: {enabled: deployment === 'kubernetes'}
  };
  validateSpec(spec);
  return spec;
}

async function select(rl, label, choices, defaultValue) {
  const lines = choices.map((value, i) => String(i + 1) + '. ' + value).join(', ');
  while (true) {
    const answer = (await rl.question(label + ' (' + lines + ') [' + defaultValue + ']: ')).trim();
    const candidate = answer || defaultValue;
    const byNumber = /^[1-9]\d*$/.test(candidate) ? choices[Number(candidate) - 1] : null;
    if (choices.includes(candidate)) return candidate;
    if (byNumber) return byNumber;
    rl.write('Invalid choice. Select a listed value or number.\n');
  }
}
async function askName(rl, suggested) {
  while (true) {
    const answer = (await rl.question('Application name [' + suggested + ']: ')).trim() || suggested;
    try {return assertName(answer);}
    catch (error) {rl.write(error.message + '\n');}
  }
}
async function askIssuer(rl) {
  while (true) {
    const answer = (await rl.question('OIDC issuer HTTPS URL: ')).trim();
    try {return assertIssuer(answer);}
    catch (error) {rl.write(error.message + '\n');}
  }
}

async function resolveConfig(options, io = {input: process.stdin, output: process.stdout}) {
  const config = {
    template: options['--template'],
    name: options.name,
    framework: options['--framework'],
    database: options['--database'],
    auth: options['--auth'],
    deployment: options['--deployment'],
    issuer: options['--issuer'],
    audience: options['--audience']
  };
  if (options['--yes']) {
    config.template ||= 'crud';
    config.name ||= TEMPLATES[config.template].defaultName;
    config.framework ||= 'express';
    config.database ||= TEMPLATES[config.template].database;
    config.auth ||= TEMPLATES[config.template].auth;
    config.deployment ||= 'compose';
    return config;
  }
  if (!io.input.isTTY || !io.output.isTTY) {
    throw new Error('Interactive init requires a terminal. Use --yes and explicit configuration options for CI.');
  }
  const rl = readline.createInterface(io);
  try {
    config.template ||= await select(rl, 'Starter template', Object.keys(TEMPLATES), 'crud');
    config.name ||= await askName(rl, TEMPLATES[config.template].defaultName);
    config.framework ||= await select(rl, 'HTTP framework', FRAMEWORKS, 'express');
    config.database ||= await select(rl, 'Database', DATABASES, TEMPLATES[config.template].database);
    config.auth ||= await select(rl, 'Authentication', AUTHS, TEMPLATES[config.template].auth);
    config.deployment ||= await select(rl, 'Deployment', DEPLOYMENTS, 'compose');
    if (config.auth === 'oidc' && !config.issuer) config.issuer = await askIssuer(rl);
    const spec = buildStarter(config);
    rl.write('\nSpecification valid: ' + spec.app.name + ' / ' + spec.database.type + '\n');
    const confirmed = await select(rl, 'Generate this starter?', ['yes', 'no'], 'yes');
    if (confirmed !== 'yes') throw new Error('Initialization cancelled; no files written');
    return config;
  } finally {rl.close();}
}

function inspectDestination(workspace) {
  assertSafeTarget(workspace);
  if (fs.existsSync(workspace)) {
    if (!fs.statSync(workspace).isDirectory()) throw new Error('Output is not a directory: ' + workspace);
    if (fs.readdirSync(workspace).length > 0) {
      throw new Error('Refusing to initialize nonempty directory: ' + workspace);
    }
  }
}

async function initialize(options, io) {
  if (options['--list-templates']) {
    return {templates: Object.entries(TEMPLATES).map(([name, value]) => ({name, description: value.label}))};
  }
  const config = await resolveConfig(options, io);
  const spec = buildStarter(config);
  const workspace = path.resolve(options['--output'] || config.name);
  inspectDestination(workspace);
  const appDir = path.join(workspace, 'server');
  const plan = planApplication(spec, appDir);
  const specFile = path.join(workspace, 'app.j2e.json');
  if (options['--dry-run']) return {dryRun: true, workspace, specFile, appDir, spec, plan};
  // Validate ownership before writing anything. Never adopt existing files.
  fs.mkdirSync(workspace, {recursive: true});
  generateApplication(spec, appDir);
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n', {flag: 'wx'});
  return {workspace, specFile, appDir, spec, generated: true};
}

module.exports = {
  TEMPLATES, FRAMEWORKS, DATABASES, AUTHS, DEPLOYMENTS,
  parseInitArgs, loadTemplate, buildStarter, initialize, resolveConfig, assertName
};
