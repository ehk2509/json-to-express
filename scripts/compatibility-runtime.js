#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ENTRY, temporary, run, makeSpec, install, migrate,
  startServer, stopServer, exerciseCrud, assertGeneratedEngine
} = require('./compatibility-utils');

async function main() {
  const [framework, database] = process.argv.slice(2);
  const spec = makeSpec(framework, database);
  const root = temporary();
  try {
    const filename = path.join(root, 'spec.json');
    const output = path.join(root, 'app');
    fs.writeFileSync(filename, JSON.stringify(spec, null, 2));
    run(process.execPath, [ENTRY, 'validate', filename]);
    run(process.execPath, [ENTRY, 'generate', filename, '--output', output]);
    assertGeneratedEngine(output, framework);
    install(output);
    if (database === 'postgresql') migrate(output);
    const started = await startServer(output, database);
    try {
      const id = await exerciseCrud(started);
      assert.ok(id);
      console.log('PASS compatible runtime:', process.version, framework, database);
    } finally {
      await stopServer(started);
    }
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
