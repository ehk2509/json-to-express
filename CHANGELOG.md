# Changelog

All notable project changes are tracked here. Versions prior to this beta were developed on the main branch.

## [0.2.0-beta.1] - 2026-10-14

### Added
- Public beta metadata, installation guidance, packaging smoke test, and CI-gated GitHub release automation.
- Native Fastify generation and extensive integration parity with Express for MongoDB and PostgreSQL.
- Writer-coordinated local/S3 file cleanup tests, conditional object-store operation verification and immutable object keys ([#39](https://github.com/ehk2509/json-to-express/issues/39)).
- Versioned, integrity-checked Prisma migrations and repeatable PostgreSQL relational fixtures ([#19](https://github.com/ehk2509/json-to-express/issues/19)).

### Notes
- This is a prerelease and may contain breaking changes before 1.0.0.
- npm publication requires registry authorization; GitHub source-tag installation is independent.
