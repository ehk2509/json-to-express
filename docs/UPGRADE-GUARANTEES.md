# Migration and compatibility guarantees (P9)

P9 protects the existing **pre-v1** public interfaces and verifies real
cross-release upgrade behavior. This is not a claim that the software is now
v1.0 production certified. Actual database migrations remain operator-reviewed.

## Tested predecessor releases

The GitHub CI cross-release matrix installs **immutable historical npm
packages**, creates real persistent data, regenerates with current code and
verifies data continuity after restart for four framework/database pairings.

| Historical npm release | Existing manifest | Matrix pairings |
| --- | --- | --- |
| `0.2.0-beta.1` | v1, no schema history | Express/Fastify × MongoDB/PostgreSQL |
| `0.2.0-beta.2` | v1, no schema history | Express/Fastify × MongoDB/PostgreSQL |
| `0.2.0-beta.3` | v2, schema history | Express/Fastify × MongoDB/PostgreSQL |

Each predecessor is fetched by its exact registry version, not a moving
dist-tag. CI must pass all **12** real database upgrade combinations.
The existing generated application is started, a record is created, an
operator-owned file is placed in the tree, and a generated file is edited.
Regeneration must refuse unsafe overwrite before approval, preserve
operator-owned files, then regenerate and recover the original record.

## Migration safety contract

1. Commit application spec and check generator/target versions. Do not
   regenerate production files blindly.
2. Run `j2e plan <spec> --output <dir> --json` and inspect every file and
   schema change. By default the planner is read-only.
3. If migrating from a manifest v1 predecessor, `--allow-unknown-schema`
   acknowledges that old schema history is missing; it is **not** evidence
   that the live database is safe.
4. `--force` permits replacement of *modified generator-owned files*.
   It cannot overwrite unowned developer files. Risky schema mutations
   require separate flags after human approval.
5. Use `j2e db inspect` / `db plan` to compare against the **live target**.
   Database plan approval is SHA- and connection-bound; acquire a genuine
   backup and recovery plan before making any data changes.
6. PostgreSQL uses reviewed Prisma migrations and native backup/restore
   procedures. MongoDB uses reviewed operations with explicit rollback
   restrictions; never assume every migration can be safely undone.
7. Deploy in stages, verify the generated app starts with existing data,
   retain restore artifacts and stop on incompatibility.

## What remains out of scope

- No silent automatic downgrade of databases or destruction of historical
  records is guaranteed. Every destructive migration requires manual planning.
- Plugin authors must maintain their own external APIs and metadata
  compatibility; plugin API v1 compatibility does not certify third-party
  plugin security.
- Target-specific Prisma/Mongoose dependency upgrades can cause behavior
  changes unrelated to the generator and require their own validation.
- Running successful synthetic CI tests does **not** prove independent
  production adoption.
- Pre-v1 beta package availability does not amount to a permanent support
  promise. A formal v1.0 lifecycle policy is gated on stability evidence,
  independent P8 pilots, and maintainer release review.

## How to reproduce

~~~sh
node scripts/p9-contract-check.js
node --test test/p9-contracts.test.js
# Requires disposable MongoDB 7 / PostgreSQL 16 to run live upgrade tests:
node scripts/cross-release-upgrade.js 0.2.0-beta.3 fastify postgresql
~~~

For the full CI evidence, see the `cross-release-upgrade` matrix in
[CI workflow](../.github/workflows/ci.yml), and the independently packaged
[consumer examples](EXAMPLES.md).
