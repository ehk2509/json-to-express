# Plugin registry and community contributions

json-to-express Plugin API v1 supports npm-hosted extensions and bundled
examples. There is **no centrally hosted marketplace** or third-party
security certification. The bundled curated catalog starts with a documented
sample database provider and the three shipped starter templates.

## Discover, inspect, and install

~~~bash
j2e plugin catalog
j2e plugin search authentication --json
j2e plugin info example-j2e-plugin@1.2.3 --json
j2e plugin add example-j2e-plugin@1.2.3 --spec app.j2e.json
j2e plugin list --spec app.j2e.json
j2e plugin verify --spec app.j2e.json --json
~~~

Replace example-j2e-plugin with a **real npm package** advertising the
json-to-express-plugin keyword and valid j2ePlugin metadata.

- Search uses npm's public package registry and returns **unverified**
  entries. A matching keyword is **not** an endorsement or proof of
  compatibility. Use info on a particular package/version to check its
  self-declared contract; check its maintainer identity and source yourself.
- Installation requires an **exact semver version**, including
  prereleases where applicable. Mutable tags such as latest and arbitrary
  tarball or Git URLs are disallowed.
- The installer shows the package, declared plugin kind and registry
  SHA-512 integrity before requesting confirmation. A human must type
  install, or pass --yes explicitly in automation.
- It installs to a managed per-project directory at
  .j2e/plugins/<package-sha256-prefix>, separate from generated output and
  any application package.json. The npm lockfile pins dependencies and
  their integrity hashes.
- npm lifecycle scripts are disabled using --ignore-scripts and
  npm_config_ignore_scripts, and a production dependency
  npm audit --audit-level=high must pass before activation.
  Plugins that require install scripts are deliberately unsupported
  by this install path.
- The downloaded package name, version, integrity and Plugin API v1
  compatibility contract are validated *again* from installed bytes.
  Only after success is the npm package declared in spec.plugins.
  Installation rolls back newly staged bytes on validation failure.
- The installed plugin participates in existing generation and schema
  safety contracts; the worker resolves installed modules in the managed
  project directory, and verifies the plugin kind before execution.
- Plugin verify checks metadata compatibility without executing plugin code.
  Local file plugins are shown as local/unverified; no package manifest
  trust is inferred for them.

**Security boundary:** package metadata, npm checksums and npm audit do not
prove a package is safe. The module runs with the invoking user's filesystem
and network permissions when you later call generate or plan. The child
process in Plugin API v1 is *not* an operating-system sandbox.
Review source, maintainer history, transitive dependencies, signatures
where available and requested generated-file overrides. --yes only
skips interactive consent; it never skips validation or auditing.

For Node 18+, the installer supports the current host package versions that
advertise Plugin API v1. Node/framework/database checks are based on
metadata, not full runtime simulation. The CI matrix tests the example
plugin's lifecycle; production adapters must supply their own compatible E2E.

## Publishing community npm plugins

Use the bundled example at examples/plugin-starter as a starting point.
An npm community plugin should include the keywords
json-to-express-plugin and j2e-plugin, and expose a CommonJS entry point:

~~~json
{
  "name": "j2e-plugin-your-provider",
  "version": "1.0.0",
  "main": "index.js",
  "keywords": ["json-to-express-plugin", "j2e-plugin"],
  "j2ePlugin": {
    "apiVersion": 1,
    "kind": "generator",
    "id": "community.your-provider",
    "hostMinVersion": "0.2.0-beta.2",
    "hostMaxExclusive": "1.0.0",
    "frameworks": ["express", "fastify"],
    "databases": ["mongodb", "postgresql"],
    "nodeMajors": [18, 20, 22, 24]
  }
}
~~~

Only list combinations **actually tested**. For a new database provider,
the custom database name must be listed in databases, mode must be project,
and the output must contain a complete runnable application and package.json.
See docs/PLUGINS.md for lifecycle hooks and override restrictions.
Build from files in the plugin's own package rather than accessing host
internals, and avoid requiring npm postinstall hooks.

Before proposing a listing, run:

~~~bash
npm test
npm run test:package
node bin/json-to-express.js plugin catalog
~~~

Maintain your own tests for every framework/database combination claimed,
especially cross-release regeneration and security. The host's CI jobs
exercise the bundled example, but **do not validate arbitrary npm plugins**.

## Contributing catalog entries or templates

Open a pull request against this repository and change
registry/catalog.json. For a new bundled template, add a valid JSON spec
under templates/ and tests that initialize and generate it. For reference
plugins, add a self-contained fixture under examples/ plus lifecycle,
regeneration, and package-install smoke tests.

Every catalog entry must declare its true review status. The built-in
example has review: reference-only. Community contributions cannot claim
approved/trusted/reviewed security status simply by being listed.
Maintainers should review license, provenance, supported versions,
sandbox limitations, generated file ownership and CI evidence before
curating a new example. User-submitted packages should remain external
npm results until an explicit catalog review and merge.

To keep this ecosystem open, the catalog is versioned JSON checked by tests,
not an external paid service or an auto-install endpoint. Discovery and
source browsing are distinct from installation or activation.
