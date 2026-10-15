# Changelog

All notable project changes are tracked here. Versions prior to this beta were developed on the main branch.

## [Unreleased]

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
