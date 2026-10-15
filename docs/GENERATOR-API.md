# Pre-v1 generator and plugin compatibility contracts (P9)

This document describes the **existing** public surface currently protected by
`ci/p9/contracts.json`, `scripts/p9-contract-check.js` and
`test/p9-contracts.test.js`. P9 adds fail-closed compatibility checks but
**does not publish a v1.0.0 release or claim P8 external validation**.

## Specification contract

The JSON application specification uses `specVersion: "1.0"`. The generator
currently accepts a missing version via `upgradeSpec`, but rejects unknown
explicit versions. Supported targets are Express and native Fastify with
MongoDB/Mongoose or PostgreSQL/Prisma. See the
[full schema](../schema/application.schema.json) and
[reference guide](REFERENCE.md) for declarative fields.

Breaking changes to existing accepted configurations require an explicit
schema-version migration path; adding optional fields is permitted when
existing specs continue to validate and generate identically where relevant.

## CommonJS library entrypoint

Import `json-to-express` (package root):

~~~js
const {
  CURRENT_SPEC_VERSION,
  PLUGIN_API_VERSION,
  PLUGIN_KINDS,
  validateSpec,
  upgradeSpec,
  normalizeSpec,
  planApplication,
  generateApplication,
  recoverTransaction,
  executeDb
} = require('json-to-express');
~~~

The entrypoint also exports `SpecificationError`, `pluginRegistry` and
`planDrift`.

`planApplication(spec, outputDir, options?)` returns a read-only plan:
`{outputDir, status, actions, schemaChanges, summary,
schemaFingerprint, blocking}`. It never writes files or applies migrations.

`generateApplication(spec, outputDir, options?)` returns:
`{outputDir, files, spec, manifest}`. The generated manifest has
`{version, files, schema}`. The current format writes manifest **v2** and
reads **v1 and v2**. History-less v1 manifests require explicit risk review.

`recoverTransaction(outputDir)` recovers an interrupted transactional
generation; file updates remain governed by ownership and schema policies.

Library options such as `pluginRoot` and `force` are documented in
[Plugin API v1](PLUGINS.md) and [transactional generation](TRANSACTIONAL-GENERATION.md).
Neither method automatically performs a live database migration. Runtime
and data migration actions must be reviewed separately.

## CLI contract

The public commands are:

| Group | Commands |
| --- | --- |
| Project setup | `j2e init`, `j2e doctor` |
| Safe generation | `j2e validate`, `j2e diff`, `j2e plan`, `j2e generate`, `j2e upgrade`, `j2e recover` |
| Ecosystem | `j2e plugin ...` |
| Data migrations | `j2e db inspect`, `plan`, `status`, `apply`, `rollback` |

The contract checker protects the public command names and high-impact flags,
including `--output`, `--force`, `--approve-schema`,
`--allow-destructive`, `--allow-unknown-schema` and `--json`.
Run `j2e --help` for actual subcommand syntax.

## Plugin API v1

`apiVersion: 1` is unchanged. The plugin types are generator, database,
middleware, authentication and storage. Plugins are CommonJS modules with
`id`, `kind` and `generate(context)`. Optional lifecycle hooks run in order:
`validate`, `beforeGenerate`, `generate`, `afterGenerate`.

`context` includes `spec`, `options`, `apiVersion` and `kind`.
`generate` returns `{files, overrides}`. The file contribution model
remains versioned, path-checked and explicitly authorized for overrides.
Disabling an old hook, silently dropping a context property, changing the
meaning of overrides or redefining file ownership constitutes a breaking
change and must fail the P9 gate.

Plugin workers are **fault containment, not a security sandbox**.
External code is only executed after the user enables it explicitly.

## What “freeze” means before 1.0

- `ci/p9/contracts.json` is the versioned reference for required public
  entrypoint exports, CLI names/options, supported engines and core formats.
- The gate prevents silent removal of known public exports/properties,
  changes to the spec/plugin/manifest version numbers and loss of
  deterministic generation/ownership protections.
- New optional, additive behaviors are permitted with tests and docs; anything
  incompatible needs a new version, a migration plan, historical tests and
  explicit maintainer review. **Changing the snapshot to make a failing
  breaking change pass is not an acceptable shortcut.**
- Semantic HTTP behavior for existing generated applications is additionally
  covered by the live database matrix and
  [independent-workspace packaged consumer tests](EXAMPLES.md).
- Complete field-by-field semantic version guarantees are a **release target**
  to be formally ratified at v1.0.0 after P8 external evidence.

Run the local check using `node scripts/p9-contract-check.js` and
`node --test test/p9-contracts.test.js`.

See [upgrade policy](UPGRADE-GUARANTEES.md), [P8 evidence status](EXTERNAL-VALIDATION.md)
and the [release process](RELEASING.md).
