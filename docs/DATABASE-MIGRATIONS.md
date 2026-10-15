# P7 — Live database migration intelligence

P7 is opt-in. `j2e plan` and `j2e upgrade` protect generated **files**;
neither updates a database. The separate `j2e db` commands inspect the live
database and produce a reviewable, immutable-by-recheck migration plan.

## Prerequisites

- Generate the application and install its dependencies (`npm install`).
- Provide the generated app's connection variable, e.g. `DATABASE_URL` or
  `MONGODB_URI`, in the environment; credentials are never written into plans.
- PostgreSQL: install `pg_dump` (compatible server version) and use the
  generated Prisma CLI. Initialize/deploy your initial Prisma migration and
  keep `migration-history.json` and migrations in version control.
- MongoDB: install MongoDB Database Tools (`mongodump`, for backup).
- Take the application offline / enter maintenance mode for schema changes.
  Generator locks do not stop other application processes from writing data.

## Live inspection, review, apply

```sh
j2e db inspect app.j2e.json --output server
j2e db plan app.j2e.json --output server
cat server/.j2e-db-plan.json
# Inspect the SQL, field/index differences, risk classifications and hash.
j2e db apply app.j2e.json --output server --approve <exact-hash> --allow-review
j2e db status app.j2e.json --output server
```

Options: `--plan <file>` to use a different plan artifact; `--backup <file>`
to specify an unused backup archive; `--allow-destructive` for explicitly
reviewed destructive SQL. An approval token must match the exact plan SHA-256
fingerprint. A changed specification or changed live database invalidates
that fingerprint; regenerate and re-review the plan. A plan is not a
cryptographic signature or a substitute for access controls.

Migration plans are written with owner-only permissions and never overwritten.
Delete or archive an old plan manually before creating a new one.

### PostgreSQL

Live catalog reads include column types/nullability, constraints, and indexes.
Prisma's migration engine produces the complete SQL diff from the live schema
to the generated Prisma datamodel, and owns migration versioning and locking.
P7 classifies its SQL statements. Supported additive operations include
CREATE TABLE, CREATE INDEX and ADD COLUMN; required or unique changes require
review. **Unknown SQL statements always fail closed**; unsupported alterations
must be migrated manually through the normal reviewed Prisma workflow.

On apply, P7 first verifies existing migration history, takes a custom-format
`pg_dump` archive, writes a new versioned Prisma migration, calls
`prisma migrate deploy`, then records checksums. The backup is stored in a
sibling `<output>.j2e-backups` directory to avoid copying it during
transactional regeneration. Deployment failures preserve migration files and
backups for inspection; they do not claim that DDL was automatically undone.

**PostgreSQL rollback is not a blind down-migration.** A generated
`rollback.review.sql` is available only when every statement has a known
inverse. Running it may delete post-migration writes. Restore the verified
`pg_dump` archive into a **separate isolated database**, validate integrity
and application behavior, and only then perform a reviewed cutover. Prisma
migration history must be restored together with the schema.

An archive can be verified with `pg_restore --list <backup.dump>`. Example
isolated restore:

```sh
createdb j2e_restore_drill
pg_restore --no-owner --no-acl --dbname j2e_restore_drill backup.dump
```

These commands assume you separately configured PostgreSQL authentication
and that `j2e_restore_drill` is an isolated empty database.

### MongoDB

Live inspection checks collection existence, indexes and collection
validators. The generated Mongoose models supply intended index definitions.
P7 creates missing collections and missing indexes; unique indexes require
explicit review. It **never drops unmanaged indexes**, removes document
fields, renames collections, or silently modifies existing validators.

MongoDB uses an exclusive in-database migration lock and records successful
operations in `_j2e_migration_history`. The lock must be reviewed and
recovered manually if the migration process crashes. Collection/index DDL
is not a multi-operation transaction. In case of partial failure, the
backup is retained and the operator must reconcile live state before retrying.

A reviewed rollback is supported for the indexes/empty collections created
by a recorded migration:

```sh
j2e db rollback app.j2e.json --output server --approve <exact-hash>
```

Rollback verifies the original archive receipt and refuses to drop a newly
created collection if it now contains data. It does **not** promise recovery
of arbitrary document mutations or concurrent application writes.

## Security and scope

- A verified backup archive and SHA-256 receipt are mandatory before apply.
  Archives may contain personal/sensitive data: secure and expire them.
- `mongodump` credentials are provided through a 0600 temporary config file
  rather than command-line arguments. PostgreSQL backup uses PG* environment
  variables instead of putting credentials on the command line.
- PostgreSQL SQL diffs only cover database features Prisma understands.
  Triggers, custom views, some extensions and other unmanaged schema objects
  require separate review and tooling.
- MongoDB schema enforcement is normally in Mongoose, not in database
  validators; P7 does not invent server-side validators from application code.
- File locks cover processes sharing an output directory. MongoDB holds a
  database lock, and Prisma Migrate controls PostgreSQL migration locking.
  External tools, manually executed DDL and application writes remain outside
  these locks.
- For irreversible data migrations, use a reviewed one-off script with an
  idempotence strategy, tested backup, and a production restoration drill.
- This milestone does not claim zero downtime or transactionally consistent
  backups while writes continue. Schedule maintenance where necessary.

## Validation

```sh
node --test test/db-migrations.test.js
npm test
npm run check
```

The unit tests cover deterministic drift, SQL risk classification, review
tokens, backup integrity and MongoDB index safety. The CI database integration
job exercises live PostgreSQL and MongoDB inspection as well as migration
planning. Release only after the full compatibility suite passes.
