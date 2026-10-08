'use strict';

const path = require('node:path');
const {joinUrl} = require('./utils');

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function identifier(value) {
  const parts = String(value).split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const joined = parts.map((part, index) => index === 0 ? lowerFirst(part) : part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return /^[A-Za-z_$]/.test(joined) ? joined : '_' + joined;
}

function groupName(entity) {
  return identifier(entity.route || lowerFirst(entity.name));
}

function operationPath(spec, entity, operation) {
  const suffix = operation.path === '/' ? '' : operation.path;
  return joinUrl(spec.app.apiPrefix, entity.route, suffix);
}

function customPath(spec, endpoint) {
  return joinUrl(spec.app.apiPrefix, endpoint.path);
}

function pathParams(route) {
  return [...String(route).matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]);
}

function runtimePrelude(baseUrl) {
  return [
    "'use strict';", '',
    'class ApiError extends Error {',
    '  constructor(message, status, body, response) {',
    '    super(message);',
    "    this.name = 'ApiError';",
    '    this.status = status;',
    '    this.body = body;',
    '    this.response = response;',
    '  }',
    '}', '',
    'function buildPath(template, params = {}) {',
    '  return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {',
    '    const value = params[name];',
    '    if (value === undefined || value === null) throw new Error("Missing path parameter: " + name);',
    '    return encodeURIComponent(String(value));',
    '  });',
    '}', '',
    'function appendQuery(url, query) {',
    '  if (!query) return url;',
    '  const search = new URLSearchParams();',
    '  for (const [key, value] of Object.entries(query)) {',
    '    if (value === undefined || value === null) continue;',
    '    if (Array.isArray(value)) search.set(key, value.join(","));',
    '    else search.set(key, String(value));',
    '  }',
    '  const text = search.toString();',
    '  return text ? url + (url.includes("?") ? "&" : "?") + text : url;',
    '}', '',
    'function createClient(options = {}) {',
    '  const baseUrl = String(options.baseUrl || ' + JSON.stringify(baseUrl) + ').replace(/\\/$/, "");',
    '  const fetchImpl = options.fetch || globalThis.fetch;',
    '  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");',
    '  const defaultHeaders = {...(options.headers || {})};',
    '  async function resolveToken() {',
    '    if (typeof options.getToken === "function") return options.getToken();',
    '    return options.token;',
    '  }',
    '  async function request(method, route, config = {}) {',
    '    const headers = {...defaultHeaders, ...(config.headers || {})};',
    '    const token = await resolveToken();',
    '    if (token) headers.authorization = "Bearer " + token;',
    '    let body;',
    '    if (config.body !== undefined && method !== "GET" && method !== "HEAD") {',
    '      headers["content-type"] = headers["content-type"] || "application/json";',
    '      body = headers["content-type"].includes("application/json") ? JSON.stringify(config.body) : config.body;',
    '    }',
    '    const response = await fetchImpl(appendQuery(baseUrl + buildPath(route, config.params), config.query), {',
    '      method, headers, body, signal: config.signal',
    '    });',
    '    if (response.status === 204) {',
    '      if (!response.ok) throw new ApiError("HTTP " + response.status, response.status, undefined, response);',
    '      return undefined;',
    '    }',
    '    const text = await response.text();',
    '    let parsed = text;',
    '    if (text) { try { parsed = JSON.parse(text); } catch {} } else parsed = undefined;',
    '    if (!response.ok) {',
    '      const message = parsed && typeof parsed === "object" && parsed.error ? String(parsed.error) : "HTTP " + response.status;',
    '      throw new ApiError(message, response.status, parsed, response);',
    '    }',
    '    return parsed;',
    '  }', ''
  ];
}

function jsEntityGroup(spec, entity) {
  const methods = [];
  for (const [name, operation] of Object.entries(entity.operations)) {
    if (!operation.enabled) continue;
    const route = operationPath(spec, entity, operation);
    if (name === 'list') {
      methods.push('      list: (query, options = {}) => request(' + JSON.stringify(operation.method.toUpperCase()) + ', ' + JSON.stringify(route) + ', {...options, query}),');
    } else if (name === 'get') {
      methods.push('      get: (id, query, options = {}) => request(' + JSON.stringify(operation.method.toUpperCase()) + ', ' + JSON.stringify(route) + ', {...options, params: {' + JSON.stringify(entity.idParam) + ': id}, query}),');
    } else if (name === 'create') {
      methods.push('      create: (data, options = {}) => request(' + JSON.stringify(operation.method.toUpperCase()) + ', ' + JSON.stringify(route) + ', {...options, body: data}),');
    } else if (name === 'update') {
      methods.push('      update: (id, data, options = {}) => request(' + JSON.stringify(operation.method.toUpperCase()) + ', ' + JSON.stringify(route) + ', {...options, params: {' + JSON.stringify(entity.idParam) + ': id}, body: data}),');
    } else if (name === 'delete') {
      methods.push('      delete: (id, options = {}) => request(' + JSON.stringify(operation.method.toUpperCase()) + ', ' + JSON.stringify(route) + ', {...options, params: {' + JSON.stringify(entity.idParam) + ': id}}),');
    }
  }
  return ['    ' + groupName(entity) + ': {', ...methods, '    },'];
}

function javascriptSource(spec) {
  const lines = runtimePrelude(spec.sdk.baseUrl);
  lines.push('  return {', '    request,');
  for (const entity of spec.entities) lines.push(...jsEntityGroup(spec, entity));
  if (spec.sdk.includeCustomEndpoints && spec.endpoints.length) {
    lines.push('    actions: {');
    for (const endpoint of spec.endpoints) {
      lines.push(
        '      ' + identifier(endpoint.name) + ': (input = {}, options = {}) => request(' +
        JSON.stringify(endpoint.method.toUpperCase()) + ', ' + JSON.stringify(customPath(spec, endpoint)) +
        ', {...options, params: input.params, query: input.query, body: input.body}),'
      );
    }
    lines.push('    },');
  }
  lines.push('  };', '}', '', 'module.exports = {ApiError, createClient};', '');
  return lines.join('\n');
}

function tsScalar(field, output) {
  if (field.type === 'reference') {
    const base = output ? 'string | ' + field.ref : 'string';
    return field.many ? 'Array<' + base + '>' : base;
  }
  if (field.type === 'number') return 'number';
  if (field.type === 'boolean') return 'boolean';
  if (field.type === 'date') return output ? 'string' : 'string | Date';
  return 'string';
}

function typeLines(spec) {
  const lines = [
    'export type QueryPrimitive = string | number | boolean | Date;',
    'export type QueryValue = QueryPrimitive | QueryPrimitive[] | undefined | null;',
    'export interface RequestOptions { headers?: Record<string, string>; signal?: AbortSignal; }',
    'export interface ClientOptions {',
    '  baseUrl?: string;',
    '  token?: string;',
    '  getToken?: () => string | undefined | Promise<string | undefined>;',
    '  headers?: Record<string, string>;',
    '  fetch?: typeof fetch;',
    '}', ''
  ];

  for (const entity of spec.entities) {
    const idName = spec.database.type === 'postgresql' ? 'id' : '_id';
    lines.push('export interface ' + entity.name + ' {', '  ' + idName + ': string;');
    for (const field of entity.fields) {
      const optional = field.required ? '' : '?';
      lines.push('  ' + field.name + optional + ': ' + tsScalar(field, true) + ';');
    }
    if (entity.schemaOptions.timestamps !== false) {
      lines.push('  createdAt?: string;', '  updatedAt?: string;');
    }
    if (entity.softDelete.enabled) lines.push('  ' + entity.softDelete.field + '?: string | null;');
    if (entity.audit.enabled) {
      lines.push('  ' + entity.audit.createdBy + '?: string | null;');
      lines.push('  ' + entity.audit.updatedBy + '?: string | null;');
    }
    lines.push('}', '');

    lines.push('export interface ' + entity.name + 'CreateInput {');
    for (const field of entity.fields) {
      const optional = !field.required || field.default !== undefined ? '?' : '';
      lines.push('  ' + field.name + optional + ': ' + tsScalar(field, false) + ';');
    }
    lines.push('}', 'export type ' + entity.name + 'UpdateInput = Partial<' + entity.name + 'CreateInput>;', '');

    const list = entity.operations.list;
    if (list.enabled) {
      const q = list.query;
      lines.push('export interface ' + entity.name + 'ListQuery {');
      for (const field of q.filters) {
        const definition = entity.fields.find(item => item.name === field);
        const type = definition ? tsScalar(definition, false).replace(' | Date', '') : 'QueryPrimitive';
        lines.push('  ' + JSON.stringify(field) + '?: ' + type + ';');
        for (const operator of q.operators) {
          if (operator === 'eq') continue;
          const opType = operator === 'in' ? type + '[]' : type;
          lines.push('  ' + JSON.stringify(field + '__' + operator) + '?: ' + opType + ';');
        }
      }
      if (q.sortParam) lines.push('  ' + JSON.stringify(q.sortParam) + '?: string;');
      if (q.selectParam) lines.push('  ' + JSON.stringify(q.selectParam) + '?: string;');
      if (q.pagination.enabled) {
        lines.push('  ' + JSON.stringify(q.pagination.pageParam) + '?: number;');
        lines.push('  ' + JSON.stringify(q.pagination.limitParam) + '?: number;');
      }
      lines.push('}', '');
    }
  }
  return lines;
}

function tsEntityInterface(entity) {
  const lines = ['export interface ' + entity.name + 'Client {'];
  for (const [name, operation] of Object.entries(entity.operations)) {
    if (!operation.enabled) continue;
    if (name === 'list') lines.push('  list(query?: ' + entity.name + 'ListQuery, options?: RequestOptions): Promise<' + entity.name + '[]>;');
    if (name === 'get') lines.push('  get(id: string, query?: Record<string, QueryValue>, options?: RequestOptions): Promise<' + entity.name + '>;');
    if (name === 'create') lines.push('  create(data: ' + entity.name + 'CreateInput, options?: RequestOptions): Promise<' + entity.name + '>;');
    if (name === 'update') lines.push('  update(id: string, data: ' + entity.name + 'UpdateInput, options?: RequestOptions): Promise<' + entity.name + '>;');
    if (name === 'delete') lines.push('  delete(id: string, options?: RequestOptions): Promise<' + (operation.status === 204 ? 'void' : entity.name) + '>;');
  }
  lines.push('}', '');
  return lines;
}

function customActionType(endpoint) {
  const params = pathParams(endpoint.path);
  const paramsType = params.length
    ? '{' + params.map(name => JSON.stringify(name) + ': string | number').join('; ') + '}'
    : 'Record<string, string | number>';
  return '{params?: ' + paramsType + '; query?: Record<string, QueryValue>; body?: unknown}';
}

function typescriptSource(spec) {
  const lines = [
    ...typeLines(spec),
    'export class ApiError extends Error {',
    '  status: number;',
    '  body: unknown;',
    '  response: Response;',
    '  constructor(message: string, status: number, body: unknown, response: Response) {',
    '    super(message);',
    "    this.name = 'ApiError';",
    '    this.status = status;',
    '    this.body = body;',
    '    this.response = response;',
    '  }',
    '}', '',
    'function buildPath(template: string, params: Record<string, string | number> = {}): string {',
    '  return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {',
    '    const value = params[name];',
    '    if (value === undefined || value === null) throw new Error("Missing path parameter: " + name);',
    '    return encodeURIComponent(String(value));',
    '  });',
    '}', '',
    'function appendQuery(url: string, query?: Record<string, QueryValue>): string {',
    '  if (!query) return url;',
    '  const search = new URLSearchParams();',
    '  for (const [key, value] of Object.entries(query)) {',
    '    if (value === undefined || value === null) continue;',
    '    if (Array.isArray(value)) search.set(key, value.map(String).join(","));',
    '    else search.set(key, String(value));',
    '  }',
    '  const text = search.toString();',
    '  return text ? url + (url.includes("?") ? "&" : "?") + text : url;',
    '}', ''
  ];

  for (const entity of spec.entities) lines.push(...tsEntityInterface(entity));

  if (spec.sdk.includeCustomEndpoints && spec.endpoints.length) {
    lines.push('export interface ActionsClient {');
    for (const endpoint of spec.endpoints) {
      lines.push('  ' + identifier(endpoint.name) + '(input?: ' + customActionType(endpoint) + ', options?: RequestOptions): Promise<unknown>;');
    }
    lines.push('}', '');
  }

  lines.push('export interface ApiClient {', '  request<T = unknown>(method: string, route: string, config?: {params?: Record<string, string | number>; query?: Record<string, QueryValue>; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal}): Promise<T>;');
  for (const entity of spec.entities) lines.push('  ' + groupName(entity) + ': ' + entity.name + 'Client;');
  if (spec.sdk.includeCustomEndpoints && spec.endpoints.length) lines.push('  actions: ActionsClient;');
  lines.push('}', '');

  lines.push(
    'export function createClient(options: ClientOptions = {}): ApiClient {',
    '  const baseUrl = String(options.baseUrl || ' + JSON.stringify(spec.sdk.baseUrl) + ').replace(/\\/$/, "");',
    '  const fetchImpl = options.fetch || globalThis.fetch;',
    '  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");',
    '  const defaultHeaders = {...(options.headers || {})};',
    '  async function resolveToken(): Promise<string | undefined> {',
    '    if (typeof options.getToken === "function") return options.getToken();',
    '    return options.token;',
    '  }',
    '  async function request<T = unknown>(method: string, route: string, config: {params?: Record<string, string | number>; query?: Record<string, QueryValue>; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal} = {}): Promise<T> {',
    '    const headers: Record<string, string> = {...defaultHeaders, ...(config.headers || {})};',
    '    const token = await resolveToken();',
    '    if (token) headers.authorization = "Bearer " + token;',
    '    let body: BodyInit | undefined;',
    '    if (config.body !== undefined && method !== "GET" && method !== "HEAD") {',
    '      headers["content-type"] = headers["content-type"] || "application/json";',
    '      body = headers["content-type"].includes("application/json") ? JSON.stringify(config.body) : config.body as BodyInit;',
    '    }',
    '    const response = await fetchImpl(appendQuery(baseUrl + buildPath(route, config.params), config.query), {method, headers, body, signal: config.signal});',
    '    if (response.status === 204) {',
    '      if (!response.ok) throw new ApiError("HTTP " + response.status, response.status, undefined, response);',
    '      return undefined as T;',
    '    }',
    '    const text = await response.text();',
    '    let parsed: unknown = text;',
    '    if (text) { try { parsed = JSON.parse(text); } catch {} } else parsed = undefined;',
    '    if (!response.ok) {',
    '      const bodyObject = parsed && typeof parsed === "object" ? parsed as {error?: unknown} : undefined;',
    '      const message = bodyObject && bodyObject.error ? String(bodyObject.error) : "HTTP " + response.status;',
    '      throw new ApiError(message, response.status, parsed, response);',
    '    }',
    '    return parsed as T;',
    '  }',
    '  return {',
    '    request,'
  );

  for (const entity of spec.entities) {
    const methods = [];
    for (const [name, operation] of Object.entries(entity.operations)) {
      if (!operation.enabled) continue;
      const route = operationPath(spec, entity, operation);
      const method = JSON.stringify(operation.method.toUpperCase());
      if (name === 'list') methods.push('      list: (query, options = {}) => request<' + entity.name + '[]>(' + method + ', ' + JSON.stringify(route) + ', {...options, query: query as Record<string, QueryValue>}),');
      if (name === 'get') methods.push('      get: (id, query, options = {}) => request<' + entity.name + '>(' + method + ', ' + JSON.stringify(route) + ', {...options, params: {' + JSON.stringify(entity.idParam) + ': id}, query}),');
      if (name === 'create') methods.push('      create: (data, options = {}) => request<' + entity.name + '>(' + method + ', ' + JSON.stringify(route) + ', {...options, body: data}),');
      if (name === 'update') methods.push('      update: (id, data, options = {}) => request<' + entity.name + '>(' + method + ', ' + JSON.stringify(route) + ', {...options, params: {' + JSON.stringify(entity.idParam) + ': id}, body: data}),');
      if (name === 'delete') methods.push('      delete: (id, options = {}) => request<' + (operation.status === 204 ? 'void' : entity.name) + '>(' + method + ', ' + JSON.stringify(route) + ', {...options, params: {' + JSON.stringify(entity.idParam) + ': id}}),');
    }
    lines.push('    ' + groupName(entity) + ': {', ...methods, '    },');
  }

  if (spec.sdk.includeCustomEndpoints && spec.endpoints.length) {
    lines.push('    actions: {');
    for (const endpoint of spec.endpoints) {
      lines.push(
        '      ' + identifier(endpoint.name) + ': (input = {}, options = {}) => request(' +
        JSON.stringify(endpoint.method.toUpperCase()) + ', ' + JSON.stringify(customPath(spec, endpoint)) +
        ', {...options, params: input.params, query: input.query, body: input.body}),'
      );
    }
    lines.push('    },');
  }

  lines.push('  };', '}', '');
  return lines.join('\n');
}

function packageJson(spec) {
  const hasJs = spec.sdk.languages.includes('javascript');
  const hasTs = spec.sdk.languages.includes('typescript');
  const pkg = {
    name: spec.sdk.packageName,
    version: spec.app.package.version,
    private: spec.sdk.private,
    description: 'Generated API client for ' + spec.app.name,
    license: 'MIT',
    engines: {node: '>=18'},
    main: hasJs ? 'javascript/index.js' : 'dist/index.js',
    ...(hasTs ? {types: 'dist/index.d.ts'} : {}),
    scripts: {
      ...(hasJs ? {check: 'node --check javascript/index.js'} : {}),
      ...(hasTs ? {build: 'tsc -p tsconfig.json'} : {})
    },
    ...(hasTs ? {devDependencies: {typescript: '^5.6.3'}} : {})
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

function tsconfig() {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node',
      lib: ['ES2022', 'DOM'],
      strict: true,
      declaration: true,
      outDir: 'dist',
      rootDir: 'typescript',
      esModuleInterop: true,
      skipLibCheck: true
    },
    include: ['typescript/**/*.ts']
  }, null, 2) + '\n';
}

function sdkReadme(spec) {
  const group = spec.entities.length ? groupName(spec.entities[0]) : 'resource';
  const createName = spec.entities.length ? spec.entities[0].name : 'Resource';
  return [
    '# ' + spec.sdk.packageName, '',
    'Generated client for ' + spec.app.name + '.', '',
    '## JavaScript', '',
    '    const {createClient, ApiError} = require("./javascript");',
    '    const client = createClient({baseUrl: ' + JSON.stringify(spec.sdk.baseUrl) + ', token: "..." });',
    '    const items = await client.' + group + '.list();', '',
    '## TypeScript', '',
    'Build declarations and JavaScript:', '',
    '    npm install',
    '    npm run build', '',
    'Then import createClient and the generated entity/input types from dist.', '',
    'Authentication accepts either token or async getToken. All methods also accept per-request headers and AbortSignal.', '',
    'HTTP failures throw ApiError with status, parsed body, and the original Response.', '',
    'The SDK is generated from the same normalized API model as routes and OpenAPI, including customized methods and paths.', '',
    'Example entity type: ' + createName + '.', ''
  ].join('\n');
}

module.exports = function sdkFiles(spec) {
  const root = spec.sdk.outputDir;
  const files = new Map([
    [path.posix.join(root, 'package.json'), packageJson(spec)],
    [path.posix.join(root, 'README.md'), sdkReadme(spec)]
  ]);

  if (spec.sdk.languages.includes('javascript')) {
    files.set(path.posix.join(root, 'javascript/index.js'), javascriptSource(spec));
  }
  if (spec.sdk.languages.includes('typescript')) {
    files.set(path.posix.join(root, 'typescript/index.ts'), typescriptSource(spec));
    files.set(path.posix.join(root, 'tsconfig.json'), tsconfig());
  }
  return files;
};

module.exports.javascriptSource = javascriptSource;
module.exports.typescriptSource = typescriptSource;
