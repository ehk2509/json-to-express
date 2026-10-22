# Changelog

All notable project changes are tracked here. Versions prior to this beta were developed on the main branch.

## [Unreleased]

Changes after beta.7 will be listed here.

## [0.2.0-beta.7] - 2026-10-21

### Changed
- Database-unavailable errors return `503 Service unavailable` with `Retry-After` instead of 500.
- On MongoDB, soft-deleted dependents no longer block a `restrict` on native Fastify either, matching Express.
- PostgreSQL create and update return `400` with `details: ["<field> references a missing record"]` for missing or soft-deleted reference targets, matching MongoDB, instead of `404` or silently accepting a soft-deleted target.

### Fixed
- Requests no longer hang while the database is down or unresponsive: MongoDB connections default to `serverSelectionTimeoutMS: 5000` and `timeoutMS: 10000` (overridable through `database.options`), the Prisma client adds `connect_timeout`, `pool_timeout` and `socket_timeout` URL defaults, and readiness checks give up after 2 s.
- Plugins that log with `console.log` no longer fail with "returned invalid JSON": plugin stdout is redirected to stderr and shown with a `[plugin <module>]` prefix.
- Express local auth no longer rejects email addresses containing the letter "s" (the generated email pattern had lost its escapes).
- Delete policies now apply through the whole relation graph on Express, as they already did on native Fastify: a cascade runs the cascaded records' own policies, so a `restrict` two levels down refuses the delete and grandchildren are no longer orphaned. Express PostgreSQL soft deletes now honour `restrict` on single references.
- A delete refused by `restrict` no longer leaves earlier cascades and nullifies applied on MongoDB servers without transactions (standalone): a read-only pass checks the whole graph before anything is written. Express MongoDB deletes now use a transaction whenever the server supports one.

### Security
- Plugin contributions under `.git/`, `node_modules/` or `.j2e/` are rejected, so a plugin cannot plant git hooks or packages through the managed writer.

## [0.2.0-beta.6] - 2026-10-21

### Changed
- Workflows now fail with 404 when a referenced record is missing or soft-deleted instead of continuing, and `deleteById` soft-deletes soft-delete entities.
- Uploads whose content does not match the declared type are rejected with 400; non-image/PDF/text local downloads are served as attachments.

### Fixed
- An unresponsive Redis no longer hangs requests: every cache call is bounded by `cache.redis.commandTimeoutMs` (new, default 500 ms), Redis is skipped for 5 s after a failure, and invalidations missed during an outage are flushed before cached data is served again.
- Workflow `create`/`updateById` data is validated like REST bodies; PostgreSQL previously persisted values that violated `min`, `required`, enums and other field rules.
- Workflow `findById`/`updateById`/`deleteById` ignore soft-deleted records and return 404 for missing ones on every target (MongoDB previously continued with `null`, still emitting events and enqueueing jobs); `deleteById` soft-deletes soft-delete entities.
- Native Fastify maps Mongoose validation and cast errors to 400 and includes error `details`.

### Security
- Uploads whose content does not match the declared PNG, JPEG, GIF, WebP, PDF or text type are rejected.
- Local file downloads send `nosniff` and a sandbox CSP, and only serve images, PDF and plain text inline.

## [0.2.0-beta.5] - 2026-10-21

### Security
- Generated create/update handlers keep only declared fields, so clients can no longer set ids, timestamps, soft-delete or audit columns (e.g. soft-delete through `PATCH {"deletedAt": ...}` past an admin-only delete).
- The generated environment guard refuses to start while a variable still holds the `.env.example` placeholder `change-me`.
- Express list filters reject object and array values, blocking `field[$op]=` MongoDB and `field[contains]=` Prisma operator injection.
- Sort/select parameters are allowlisted to declared, non-hidden fields; `?select=+field` can no longer expose Mongoose `select: false` fields.
- Native Fastify applies `app.bodyLimit`.
- Mongoose ValidationError responses return per-field details instead of raw database messages that echoed submitted values.

### Added
- MongoDB targets reject writes whose reference ids point at missing or soft-deleted records (PostgreSQL already enforced this with foreign keys).

### Changed
- An operation's `auth.roles` now authorizes callers holding **any** listed role; previously every listed role was required.
- Express + MongoDB validation error `details` is an array of strings instead of a single string.
- Apps with auth no longer start from an unedited `.env.example`; replace every `change-me` value first.

### Fixed
- Express and native Fastify request validation enforce `min`, `max`, `minLength` and `maxLength`; PostgreSQL targets previously persisted out-of-bounds values.
- Native Fastify: Mongo deletes of referenced entities no longer fail on standalone MongoDB; unique violations return 409 instead of 500; malformed reference ids return 400; list filters support `field__op` operators, type coercion and reference filters on Prisma; unknown sort fields return 400.
- The missing-environment error explains how to provide variables, and `j2e generate` prints an absolute next-step path for output outside the current directory.
- P7 CI installs the PostgreSQL 16 client from PGDG on newer runner images.

## [0.2.0-beta.4] - 2026-10-15

### Added
- P6 crash-recoverable regeneration: fully staged output, exclusive generator locks, journaled directory promotion, restart recovery, and SIGKILL/concurrency tests.
- P7 reviewed PostgreSQL/MongoDB database migration intelligence: live drift inspection, versioned plans, backups, explicit approvals, and guarded rollback with live E2E.
- P8 packaged-consumer validation on real database services, independent-pilot recruitment forms, and a fail-closed evidence/reviewer gate; **no independent production pilots have been verified yet**.
- P9 pre-v1 contract snapshot and Node 18/20/22/24 compatibility checks for generator entrypoints, spec version, Plugin API v1, CLI, manifest versions, and file ownership.
- Real historical persisted-data upgrade tests extended to immutable beta.3 for all Express/Fastify and MongoDB/PostgreSQL combinations.
- Six published packaged consumer scenarios and a tested external database provider, validated via the installed npm tarball in a separate workspace.
- Concise onboarding README, full archived reference, and focused API, upgrade, getting-started, and example guides.

### Fixed
- Pin the generated GraphQL schema dependency to the published @graphql-tools/schema@10.0.27, avoiding a floating minor release that currently resolves to an unavailable stable @graphql-tools/utils version.
- Corrected a PostgreSQL/MongoDB backup filename assertion and retained the project ownership/rollback guards.

### Notes
- This release is a **public beta**. P9's pre-v1 stability checks do not constitute a v1.0 release or a long-term support guarantee.
- Passing CI and simulated consumer tests do not prove external production adoption. The P8 independent-pilot evidence requirement remains open.
- npm publication is gated by successful SHA-matched push-to-main CI and GitHub Actions OIDC provenance.

## [0.2.0-beta.3] - 2026-10-15

### Added
- Intelligent regeneration via `j2e diff`, `j2e plan`, and guarded `j2e upgrade`, including file-ownership conflict detection and schema change classification.
- Interactive `j2e init` and `j2e doctor` with CRUD, SaaS, and e-commerce starter templates, guided configuration, JSON reports, and non-interactive CI support.
- Plugin API v1 for independent database providers, custom generators, middleware, authentication, and storage adapters, with lifecycle hooks, manifest-aware output safety, and bounded subprocess execution.
- Plugin registry CLI (`catalog`, `search`, `info`, `add`, `list`, `verify`), curated examples, an npm publisher starter, and community contribution documentation.
- Release-gated production compatibility evidence: 14 supported Node/framework/database combinations, eight genuine historical beta upgrade scenarios with persisted-data checks, large generated-app benchmarks, and deployment/dependency audits.

### Changed
- Version-independent beta release automation now validates immutable tags and source SHAs, serializes publication, checks changelog metadata, and preserves npm OIDC trusted publishing.
- Generated Fastify 5 applications default to Node.js 20+; Express retains legacy Node.js 18+ compatibility.
- Generated PostgreSQL dependencies use a targeted transitive dependency override to address the audited `deepmerge-ts` advisory.

### Security
- Registry installs require explicit consent, an exact npm version, SHA-512 integrity validation, compatibility checks, disabled lifecycle scripts, and a passing high-severity production dependency audit.
- Generator-owned files remain protected by preflight validation; third-party plugins run in subprocesses for fault containment, **not** an OS-level security sandbox.

### Notes
- This prerelease bundles the previously unreleased features developed after `0.2.0-beta.2`. Plugin APIs may still evolve before v1.0.
- npm distribution uses GitHub Actions OIDC with provenance and the `beta` dist-tag.

## [0.2.0-beta.2] - 2026-10-14

### Changed
- Use npm Trusted Publishing (GitHub Actions OIDC) for token-free beta distribution.
- Release workflow verifies the new prerelease tag, uses a GitHub-hosted runner and requests scoped OIDC credentials.
- Safe package publication remains gated behind a successful CI run, an npm trusted publisher, and the repository's `NPM_TRUSTED_PUBLISHING_ENABLED` variable.

### Notes
- No generator runtime changes compared with beta.1.
- This release verifies OIDC registry publication and provenance after the successful beta.1 package bootstrap.

## [0.2.0-beta.1] - 2026-10-14

### Added
- Public beta metadata, installation guidance, packaging smoke test, and CI-gated GitHub release automation.
- Native Fastify generation and extensive integration parity with Express for MongoDB and PostgreSQL.
- Writer-coordinated local/S3 file cleanup tests, conditional object-store operation verification and immutable object keys ([#39](https://github.com/ehk2509/json-to-express/issues/39)).
- Versioned, integrity-checked Prisma migrations and repeatable PostgreSQL relational fixtures ([#19](https://github.com/ehk2509/json-to-express/issues/19)).

### Notes
- This is a prerelease and may contain breaking changes before 1.0.0.
- npm publication requires registry authorization; GitHub source-tag installation is independent.
