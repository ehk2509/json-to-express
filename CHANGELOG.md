# Changelog

All notable project changes are tracked here. Versions prior to this beta were developed on the main branch.

## [Unreleased]

### Added
- Release-gated Node/framework/database runtime compatibility and beta1/beta2 persisted-data upgrades.
- 36-entity performance baselines, production dependency audits and Compose/Kubernetes deployment validation.

### Changed
- Generated Fastify applications now advertise Node >=20 by default, matching Fastify 5; Express retains >=18 as its legacy default.


### Added
- Plugin API v1 for third-party generators, database providers, middleware, authentication and storage adapters with lifecycle hooks and bounded subprocess workers.
- Explicit artifact-override permissions, safe regeneration integration and independent flatfile database-provider example.


### Added
- Interactive init and doctor CLI commands, non-interactive setup, and bundled CRUD/SaaS/e-commerce templates.
- Tarball smoke coverage for installed starter generation and diagnostics.


### Changed
- Automate version-independent beta releases, immutable GitHub SHA/tag verification, concurrency fencing, changelog validation and dependency security audits.

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
