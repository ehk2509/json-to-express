'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {joinUrl} = require('./utils');

const TEMPLATE_ROOT = path.join(__dirname, 'admin-templates');

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATE_ROOT, name), 'utf8');
}

function operationUrl(spec, entity, operation) {
  const suffix = operation.path === '/' ? '' : operation.path;
  return joinUrl(spec.app.apiPrefix, entity.route, suffix);
}

function actionEntity(spec, endpoint) {
  for (const entity of spec.entities) {
    const marker = '/' + entity.route + '/:' + entity.idParam;
    if (endpoint.path === marker || endpoint.path.startsWith(marker + '/')) {
      return {entity: entity.name, idParam: entity.idParam};
    }
  }
  return null;
}

function configObject(spec) {
  const entityByName = Object.fromEntries(spec.entities.map(entity => [entity.name, entity]));
  return {
    title: spec.admin.title,
    baseUrl: spec.admin.baseUrl,
    devPort: spec.admin.devPort,
    authEnabled: spec.auth.enabled,
    auth: spec.admin.auth,
    theme: spec.admin.theme,
    databaseType: spec.database.type,
    idField: spec.database.type === 'postgresql' ? 'id' : '_id',
    entities: spec.admin.entities.map(adminEntity => {
      const entity = entityByName[adminEntity.name];
      return {
        ...adminEntity,
        idParam: entity.idParam,
        operations: Object.fromEntries(Object.entries(entity.operations).map(([name, operation]) => [
          name,
          {
            enabled: operation.enabled,
            method: operation.method.toUpperCase(),
            path: operationUrl(spec, entity, operation),
            status: operation.status,
            query: name === 'list' ? operation.query : undefined
          }
        ]))
      };
    }),
    actions: spec.admin.includeCustomActions ? spec.endpoints.map(endpoint => {
      const bound = actionEntity(spec, endpoint);
      return {
        name: endpoint.name,
        label: endpoint.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
        method: endpoint.method.toUpperCase(),
        path: joinUrl(spec.app.apiPrefix, endpoint.path),
        status: endpoint.status,
        pathParams: [...endpoint.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1]),
        entity: bound && bound.entity,
        entityIdParam: bound && bound.idParam
      };
    }) : []
  };
}

function packageJson(spec) {
  return JSON.stringify({
    name: spec.app.package.name + '-admin',
    version: spec.app.package.version,
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview --host 127.0.0.1'
    },
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1'
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.3.4',
      vite: '^5.4.14'
    }
  }, null, 2) + '\n';
}

function viteConfig(spec) {
  return [
    "import {defineConfig} from 'vite';",
    "import react from '@vitejs/plugin-react';",
    '',
    'export default defineConfig({',
    '  plugins: [react()],',
    '  server: {host: "127.0.0.1", port: ' + spec.admin.devPort + '},',
    '  preview: {host: "127.0.0.1", port: ' + spec.admin.devPort + '},',
    '});',
    ''
  ].join('\n');
}

function readmeSource(spec) {
  return [
    '# ' + spec.admin.title, '',
    'Generated admin UI for ' + spec.app.name + '.', '',
    '## Run', '',
    '    npm install',
    '    npm run dev', '',
    'Default admin URL: http://127.0.0.1:' + spec.admin.devPort, '',
    'Default API URL: ' + spec.admin.baseUrl, '',
    'Override the API URL with VITE_API_BASE_URL.', '',
    '## Production build', '',
    '    npm run build', '',
    'The dist directory is a static SPA. Configure backend CORS when it is hosted on a different origin from the API.', '',
    '## Generated capabilities', '',
    '- dashboard and resource navigation',
    '- configurable tables, columns, filters, sorting and pagination',
    '- create/edit forms with client-side validation',
    '- string, textarea, number, boolean, date, enum and relation widgets',
    '- relation selectors loaded from referenced resources',
    '- delete confirmation and HTTP error feedback',
    '- optional bearer-token gate with local/session storage',
    '- row-bound and global custom workflow actions',
    '- responsive light/dark/system UI', ''
  ].join('\n');
}

module.exports = function adminFiles(spec) {
  const root = spec.admin.outputDir;
  return new Map([
    [path.posix.join(root, 'package.json'), packageJson(spec)],
    [path.posix.join(root, 'vite.config.js'), viteConfig(spec)],
    [path.posix.join(root, 'index.html'), readTemplate('index.html')],
    [path.posix.join(root, 'README.md'), readmeSource(spec)],
    [path.posix.join(root, 'src/config.js'), 'export const config = ' + JSON.stringify(configObject(spec), null, 2) + ';\n'],
    [path.posix.join(root, 'src/api.js'), readTemplate('api.js')],
    [path.posix.join(root, 'src/App.jsx'), readTemplate('App.jsx')],
    [path.posix.join(root, 'src/main.jsx'), readTemplate('main.jsx')],
    [path.posix.join(root, 'src/styles.css'), readTemplate('styles.css')]
  ]);
};

module.exports.configObject = configObject;
