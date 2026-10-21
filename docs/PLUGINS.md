# Plugin API v1

json-to-express supports external generator, database, middleware,
authentication and storage plugins through a **versioned file-contribution
contract**, without modifying generator core. This interface has
apiVersion: 1. The API contract is intended to remain backward-compatible
within v1; any incompatible future interface requires a new apiVersion.

## Install and enable

Install a third-party npm plugin in the spec workspace or reference a local
module by relative path. External plugins are **not auto-installed**,
downloaded or activated. You must explicitly declare them in spec.plugins:

~~~json
{
  "specVersion": "1.0",
  "app": {"name": "example"},
  "database": {"type": "mongodb"},
  "entities": {"Note": {"fields": {"title": {"type": "string"}}}},
  "plugins": [
    {
      "module": "./custom-generator.js",
      "kind": "generator",
      "options": {"feature": true}
    }
  ]
}
~~~

For CLI commands (validate, plan, diff, generate and upgrade), local module
paths are resolved **relative to the specification JSON file**; npm package
names resolve through normal Node module resolution from that directory.
Programmatic use defaults to process.cwd(), with an explicit pluginRoot:

~~~js
const {generateApplication, planApplication, PLUGIN_API_VERSION} = require('json-to-express');
const plan = planApplication(spec, './output', {pluginRoot: '/project/specs'});
const result = generateApplication(spec, './output', {pluginRoot: '/project/specs'});
~~~

## Contract

A module exports a CommonJS object:

~~~js
module.exports = {
  apiVersion: 1,
  id: 'example.my-generator',
  kind: 'generator',
  mode: 'augment', // or 'project' for a complete database provider
  async validate({spec, options, apiVersion, kind}) {},
  async beforeGenerate(context) {},
  async generate(context) {
    return {
      files: {'extensions/hello.txt': 'Hello from a plugin!\n'},
      overrides: []
    };
  },
  async afterGenerate(context, contribution) {}
};
~~~

- Supported kinds: generator, database, middleware, authentication, storage.
- Hooks execute sequentially (validate, beforeGenerate, generate,
  afterGenerate) within one disposable child process for each plugin.
  Errors reject the entire generation before any managed output is written.
  The afterGenerate hook is deliberately **pre-commit**: it inspects rendered
  artifacts, not an already-written project.
- Context contains spec, plugin-specific options, apiVersion and kind.
  Hooks return plain JSON artifacts; non-serializable runtime handles,
  functions and open connections cannot cross the subprocess boundary.
- Contributions contain files keyed by relative artifact paths. The host
  writes the files through the same ownership-aware manifest as core.
  Paths under `.git/`, `node_modules/` and `.j2e/` (any letter case) are
  reserved and rejected.
- Anything a plugin writes to stdout, including `console.log`, is redirected
  to stderr so it cannot corrupt the JSON protocol. The host prints those
  lines prefixed with `[plugin <module>]`.
- A plugin can replace a core-generated artifact only when both its
  contribution.overrides and its spec declaration allowOverrides list that
  exact file path. Without both, collisions fail closed.
- Plugins are processed in the declaration order. Duplicate plugin modules
  and duplicate plugin IDs are rejected. Later plugins cannot take an
  earlier plugin's artifact without the same explicit override contract.
- The core does not hot-load plugin code into a generated app. A middleware
  plugin can supply the exact module referenced by app.middlewareModules.
  Authentication/storage/database plugins can provide replacement generated
  runtime modules at existing paths. Adapter authors are responsible for
  preserving expected runtime exports and framework semantics.
- All built-in generators remain authoritative by default. Existing spec
  behavior is unchanged when spec.plugins is omitted.

### Adding a new database backend

For a **new** database type not built into json-to-express, use a database
plugin with mode: 'project' as the **first declared plugin**. It must emit
a complete working application, including package.json, its persistence
implementation, controllers/routes, and startup code. Core provides CLI,
planning, ownership-safe regeneration, schema risk classification, hooks,
and lifecycle management; it does **not** silently reuse Mongo/Prisma code
for a foreign database.

See:

- examples/plugins/flatfile-provider.js
- examples/plugins/flatfile-spec.json

The sample uses a JSON-file-backed persistent Note API, purely as a provider
contract demonstration. It is **not** concurrency-safe production storage.

~~~bash
node bin/json-to-express.js validate examples/plugins/flatfile-spec.json
node bin/json-to-express.js plan examples/plugins/flatfile-spec.json --output generated/flatfile-notes
node bin/json-to-express.js generate examples/plugins/flatfile-spec.json --output generated/flatfile-notes
cd generated/flatfile-notes && npm start
~~~

GET /health, GET /api/notes, and POST /api/notes are provided by the demo
plugin rather than json-to-express core. Third-party provider quality,
integrity and production security remain the provider author's responsibility.

## Isolation and security model

This is **process isolation, not a security sandbox**.

- Each plugin runs in a separate bounded Node.js process, limited to
  ~96 MiB V8 heap, 7.5-second wall-clock execution, ~512 KiB request
  and ~4 MiB response. Normal environment variables are not inherited.
- Plugin code is still ordinary Node.js code. It may access filesystem,
  network, local credentials or subprocesses under the user's OS permissions.
  A hostile plugin can write files directly or escape the child-process
  resource constraints; for example, a detached grandchild process survives
  the worker timeout. Use only reviewed, trusted local packages.
- Never store or pass raw user secrets in plugin configuration or spec defaults.
  Keep credentials in runtime environment variables, secret managers, or
  generated application deployment settings. Context is not automatically
  sanitized beyond excluding inherited environment variables.
- The host validates the declared kind, API version, returned file count,
  file sizes, path traversal, collisions and override permissions. Invalid
  contributions fail before managed output commits, and the generator never
  overwrites unowned user files.
- Plugin code is executed for plan/diff/validate, as well as generate. Those
  operations do not write managed generated files, but third-party JavaScript
  may still have side effects. Do not run untrusted plugins just to preview.
- A plugin is not an npm trusted publisher, a marketplace install, or an
  authorization policy. Those workflows need separate controls.

## Compatibility and testing

For a plugin to be considered compatible, test against both Express and
Fastify (if claimed), relevant database targets, authentication/storage
contracts, regeneration conflicts, CLI and installed npm tarball flows.
Prefer explicit provider version pins. Plugins should expose apiVersion: 1,
use deterministic output, avoid persistent global process state, and keep
lifecycle hooks idempotent.

To test plugin contributions, run the repo suite:

~~~bash
npm test
npm run check
npm run test:package
~~~

The package test verifies the external flatfile sample is installable and
can generate a project using the published tarball.

## P9 pre-v1 compatibility gate

The existing Plugin API v1 is now part of the frozen public interface
described in [P9 generator contracts](GENERATOR-API.md) and checked by
`ci/p9/contracts.json` and the P9 CI workflow. Plugins targeting API v1
can rely on the documented kinds, context properties, lifecycle hooks,
contribution shape and explicit override authorization remaining available
within this contract line.

A proposed incompatible change must introduce an explicit new apiVersion
and migration documentation, plus cross-version integration tests; it must
never be silently shipped behind an unchanged API v1. The freeze is a
pre-v1 engineering guardrail, not a certification of third-party packages
or a claim of a v1.0 release.
