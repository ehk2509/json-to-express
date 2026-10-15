'use strict';

// Standalone external-style plugin. Core does not know about flatfile.
// Demo provider uses a JSON file and is not safe for concurrent writers.
module.exports = {
  apiVersion: 1,
  id: 'example.flatfile',
  kind: 'database',
  mode: 'project',
  validate({spec}) {
    if (!spec.database || spec.database.type !== 'flatfile') {
      throw new Error('This plugin requires database.type = flatfile');
    }
    if (!spec.entities || !spec.entities.Note ||
        !spec.entities.Note.fields || !spec.entities.Note.fields.title) {
      throw new Error('Demo provider requires a Note entity with title');
    }
  },
  beforeGenerate({spec}) {
    if (spec.app.framework && spec.app.framework !== 'express') {
      throw new Error('Flatfile example supports standalone Node HTTP only');
    }
  },
  generate({spec}) {
    const packageJson = {
      name: spec.app.name, version: '0.1.0', private: true, main: 'src/server.js',
      scripts: {start: 'node src/server.js'},
      engines: {node: '>=18'}, dependencies: {}
    };
    const source = [
      "'use strict';",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const http = require('node:http');",
      "const crypto = require('node:crypto');",
      "const filename = path.join(__dirname, '..', 'notes.json');",
      "function read() {",
      "  if (!fs.existsSync(filename)) return [];",
      "  return JSON.parse(fs.readFileSync(filename, 'utf8'));",
      "}",
      "function reply(res, status, payload) {",
      "  res.writeHead(status, {'content-type': 'application/json'});",
      "  res.end(JSON.stringify(payload));",
      "}",
      "const server = http.createServer(async (req, res) => {",
      "  try {",
      "    if (req.method === 'GET' && req.url === '/health') return reply(res, 200, {ok:true});",
      "    if (req.method === 'GET' && req.url === '/api/notes') return reply(res, 200, read());",
      "    if (req.method === 'POST' && req.url === '/api/notes') {",
      "      let data = '';",
      "      for await (const chunk of req) {",
      "        data += chunk;",
      "        if (data.length > 16384) return reply(res, 413, {error:'Too large'});",
      "      }",
      "      const body = JSON.parse(data);",
      "      if (!body || typeof body.title !== 'string' || !body.title.trim())",
      "        return reply(res, 400, {error:'title is required'});",
      "      const records = read();",
      "      const record = {id: crypto.randomUUID(), title: body.title};",
      "      records.push(record);",
      "      fs.writeFileSync(filename, JSON.stringify(records, null, 2));",
      "      return reply(res, 201, record);",
      "    }",
      "    return reply(res, 404, {error:'Not found'});",
      "  } catch (error) { return reply(res, 500, {error:'Request failed'}); }",
      "});",
      "const port = Number(process.env.PORT || 3000);",
      "server.listen(port, '127.0.0.1', () => {",
      "  console.log('Listening on ' + server.address().port);",
      "});",
      ""
    ].join('\n');
    return {files: {
      'package.json': JSON.stringify(packageJson, null, 2) + '\n',
      'src/server.js': source,
      'README.md': '# Flatfile demo provider\n\nRun npm start. GET /health, GET and POST /api/notes.\n',
      '.env.example': 'PORT=3000\n'
    }};
  },
  afterGenerate(context, result) {
    if (!result.files['src/server.js']) throw new Error('Missing demo server');
  }
};
