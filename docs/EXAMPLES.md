# Independently packaged consumer examples (P9)

These scenarios demonstrate that third-party developers can use the
**installed tarball** from a clean external workspace, without importing
the checkout's source tree. They are **maintainer-designed examples**,
not independently operated production deployments or user testimonials.

## Four reproducible API starter variations

The harness uses the public `crud` starter from the installed tarball.

| Consumer ID | HTTP framework | Database | Observed artifact |
| --- | --- | --- | --- |
| `crud-express-mongodb` | Express | MongoDB | `src/config/database.js` |
| `crud-express-postgresql` | Express | PostgreSQL | `prisma/schema.prisma` |
| `crud-fastify-mongodb` | Native Fastify | MongoDB | `src/fastify-native.js` |
| `crud-fastify-postgresql` | Native Fastify | PostgreSQL | `prisma/schema.prisma` |

Two additional specifications are distributed in the npm package:
[helpdesk-mongo](../examples/consumers/helpdesk-mongo.json), an Express/MongoDB
issue tracker, and [ledger-postgres](../examples/consumers/ledger-postgres.json),
a Fastify/PostgreSQL invoice service. Both are validated from the installed
npm tarball rather than the local repository checkout.

A seventh case loads the actual installed `flatfile` external database provider
from `examples/plugins` to verify the plugin entrypoint and the custom
project generator remain functional.

All seven perform generation, artifact verification, manifest v2 checks
and safe repeat generation; each checks planned changes are empty after a
successful write. The planner must never write files; operator-owned files
must survive. The examples **do not connect to a database** or attempt to
pass as live or independent adoption.

## Run the packaged-consumer matrix

Requires Node.js 20+ and npm with access to install the current tarball.
Run from this repository:

~~~sh
node scripts/p9-contract-check.js
node scripts/p9-consumer-contract.js
~~~

The second command:

1. Runs `npm pack` and records the integrity from its JSON manifest.
2. Installs the tarball, scripts disabled, into a fresh **separate** temporary
   consumer directory.
3. Uses `require('json-to-express')` from that installed directory and its
   shipped `bin/json-to-express.js`, not the source checkout.
4. Imports `templates/crud.json` for four framework/database combinations,
   the two published domain-specific specifications, and the installed
   custom database provider example.
5. Verifies public plans, CLI validation, generated files and stable
   regeneration.
6. Deletes the disposable consumer directories.

The GitHub Actions [P9 stability workflow](../.github/workflows/p9-stability.yml)
runs this matrix on PRs/main and publishes an artifact with outcomes,
source SHA and npm tarball integrity (but no database URLs or secrets).

**The file `ci/p9/consumer-matrix.json` declares the frozen examples.**
Do not add private test credentials or customer payloads.

## Real database end-to-end validation

Use [P8 packaged-consumer validation](EXTERNAL-VALIDATION.md) and the existing
[production compatibility matrix](PRODUCTION-COMPATIBILITY.md) when you need
live MongoDB/PostgreSQL CRUD and restart/persistence assertions. Independent
production operators can participate through the
[P8 pilot playbook](P8-PILOT-PLAYBOOK.md).

An example passing in CI is an engineering smoke test, not proof of
an independent customer.

The two domain-specific examples are intended as starting points, not
production-ready systems. Review security, permissions and migration plans.
