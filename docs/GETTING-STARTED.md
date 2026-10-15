# Getting started with json-to-express

**Status:** public beta `0.2.0-beta.4`; the current repository contains
additional development features. **v1.0 has not been declared.** Node.js 20+
is recommended; Express supports Node 18 only as a legacy target, and Fastify
5 requires Node 20+.

## What it builds

One JSON specification can generate an Express or native Fastify REST API with
MongoDB/Mongoose or PostgreSQL/Prisma. Optional modules include authentication,
RBAC, OpenAPI, file uploads, workflows/outbox, a JavaScript/TypeScript SDK,
admin UI, and Docker/Compose/Kubernetes scaffolding. These optional features
have separate operational prerequisites.

## Install and preview

From the published npm beta:

~~~sh
npm install --global json-to-express@beta
j2e --version
j2e init demo-api --template crud --framework express \
  --database mongodb --deployment none --yes --dry-run
~~~

The dry run checks your configuration **without writing files**. To generate a
project, omit `--dry-run`:

~~~sh
j2e init demo-api --template crud --framework express \
  --database mongodb --deployment none --yes
j2e doctor demo-api/app.j2e.json
j2e validate demo-api/app.j2e.json
~~~

The initializer writes `demo-api/app.j2e.json` and
`demo-api/server/`. You can edit the JSON spec and regenerate with:

~~~sh
j2e plan demo-api/app.j2e.json --output demo-api/server --json
j2e generate demo-api/app.j2e.json --output demo-api/server
~~~

Do **not** run a generated API against a live production database before
reviewing the generated code, permissions, dependencies, and migration plan.
For MongoDB local development, supply `MONGODB_URI` for an isolated MongoDB 7
database; then install and start the generated application.

~~~sh
cd demo-api/server
npm install
# Set MONGODB_URI in .env or your runtime environment.
npm start
~~~

The `--framework fastify --database postgresql` pairing uses a separate
PostgreSQL 16+ database and requires explicit Prisma migration initialization
and deployment (not performed by `j2e init`).

~~~sh
j2e init billing-api --template crud --framework fastify \
  --database postgresql --deployment none --yes
cd billing-api/server
npm install
# Configure DATABASE_URL for an isolated PostgreSQL instance.
npm run db:migrate:init
npm run db:migrate:deploy
npm run db:migrate:verify
npm start
~~~

All database-changing commands require a reviewed backup/restore plan on
real deployments; do not copy the quick start directly into production.

## Picking a starter

| Template | Starting point | Important limits |
| --- | --- | --- |
| `crud` | Task API with standard CRUD routes | No auth configured by default |
| `saas` | Organizations, projects and tasks | Review local auth, roles, token secrets |
| `ecommerce` | Categories, products and orders | Not a real checkout, payment or tax backend |

The [four-stack consumer examples](EXAMPLES.md) show how to generate from the
npm tarball in a clean workspace and verify idempotent output without a database.

## What to do next

- [CLI and library/API contracts](GENERATOR-API.md)
- [Version compatibility and safe upgrades](UPGRADE-GUARANTEES.md)
- [Plugin API v1](PLUGINS.md)
- [External database migration workflow](DATABASE-MIGRATIONS.md)
- [Generation and recovery semantics](TRANSACTIONAL-GENERATION.md)
- [Production compatibility matrix](PRODUCTION-COMPATIBILITY.md)
- [Full legacy feature reference](REFERENCE.md)

If you are evaluating the generator independently, see the
[P8 pilot quickstart](P8-GET-STARTED.md). Passing packaged-consumer tests is
not evidence of independently operated production deployment.
