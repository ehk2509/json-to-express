# Production compatibility and release validation

All new beta releases are gated by the same required CI workflow.
The Publish beta workflow only runs after successful same-repository
push-to-main CI; its release SHA has passed the full matrix.

## Supported generator/runtime combinations

The generator CLI tests run under Node.js 18, 20 and 22.
The generated runtime compatibility matrix adds:

| Runtime | Express + MongoDB | Express + PostgreSQL | Fastify 5 + MongoDB | Fastify 5 + PostgreSQL |
| --- | --- | --- | --- | --- |
| Node 18 | Tested (legacy) | Tested (legacy) | Unsupported | Unsupported |
| Node 20 | Tested | Tested | Tested | Tested |
| Node 22 | Tested | Tested | Tested | Tested |
| Node 24 | Tested | Tested | Tested | Tested |

This is a test plan; inspect the associated CI run for the actual passing status.

Fastify 5 requires Node.js 20+. Generated Fastify packages default to
engines.node >=20; Express defaults to >=18 for backward compatibility.
Node 18 is an end-of-life legacy test target, not a production recommendation.

Each matrix entry generates a CRUD project, installs npm dependencies,
deploys a reviewed-style initial Prisma migration for PostgreSQL, starts
the API against MongoDB 7 or PostgreSQL 16 and exercises create/get/list
operations. The original 17-job matrix retains full-featured auth/storage,
transaction, workflows, SDK/admin and production-style Docker/Compose tests.

## Genuine cross-release upgrades

The upgrade matrix uses the immutable npm packages
json-to-express@0.2.0-beta.1, json-to-express@0.2.0-beta.2 and json-to-express@0.2.0-beta.3, NOT synthetic
manifests. For each predecessor and all four framework/database pairs (12 live upgrade jobs):

1. Obtain and verify the historical npm package version.
2. Generate, install and start the historical app with live storage.
3. Create a persisted record, and append an unowned and edited generated file.
4. Check that unsafe regeneration refuses overwrite without approvals.
5. Upgrade with a deliberate legacy schema acknowledgement and generator-owned
   file override; verify v2 manifest and idempotent clean repeat regeneration.
6. Reinstall, restart and read the original record from the unchanged DB.

Acknowledging unknown schema history is not a substitute for live database
drift verification or reviewed data migrations.

## Performance baselines and larger generated apps

Generate 36-entity applications for all four framework/database pairs.
Compare the immutable npm beta.2 generator to the current generator on
the SAME Node 22 runner, measuring repeated fresh generations. The output
includes npm tarball integrity, Node version, output file and byte counts,
individual timings, medians and ratios.

ci/performance-budgets.json defines conservative CI guardrails, NOT
historical measured values. The actual results are uploaded as the
generator-performance-baseline artifact and retained for 30 days.
Treat large percentage changes on shared CI runners cautiously.

## Dependency and deployment verification

For each framework/database pair, the production-artifacts matrix:

- Generates Docker, Compose and Kubernetes deployment manifests.
- Resolves the generated runtime dependency graph and blocks on high/critical
  npm audit findings using npm audit --omit=dev --audit-level=high.
- Runs docker compose config --quiet to validate Compose.
- Parses Kubernetes YAML with pinned PyYAML, rejects duplicate keys,
  and verifies selectors, container ports, probes, ConfigMaps and Secrets.

These checks validate generated deployment CONFIGURATION, not a real K8s
cluster. Existing E2E jobs run Docker builds and Compose startup checks
across MongoDB/PostgreSQL and S3/Fastify scenarios. Cluster rollouts,
HA failure recovery and provider security are deployment-specific.

## Acceptance rules

Every CI job must pass before the release can be published. The historical
upgrade jobs must prove data continuity; failed security audits block
distribution; baseline measurements and performance budgets must be reported.
The published npm tarball remains independently tested and signed via OIDC.
Do not claim compatibility for a failing matrix combination.


## P8 — Independent consumer acceptance

P8 adds an isolated consumer CI workflow that installs the packed CLI into
a fresh workspace, generates real apps, and verifies persistence, restart,
invalid-input handling and CRUD under a short read workload with MongoDB 7
and PostgreSQL 16. Reports are bound to the exact commit and uploaded as
artifacts. This differs from the internal runtime compatibility matrix but
remains a **maintainer-authored simulation**, not genuine external production
evidence.

See [External validation](EXTERNAL-VALIDATION.md). The production gate
requires independent operator attestations and human review of evidence for
three external projects spanning two organizations and both persistence
engines/frameworks. CI may pass before those conditions are fulfilled.

## P9 frozen public compatibility contracts

P9 extends these tests to every published beta predecessor through
0.2.0-beta.3, including both manifest v1 and manifest v2 histories. The
versioned [generator/plugin contract baseline](GENERATOR-API.md), [safe upgrade
policy](UPGRADE-GUARANTEES.md), and [packaged consumer matrix](EXAMPLES.md)
are evaluated on every PR and push to main.

The P9 consumer suite installs the actual npm tarball into a separate
directory and generates all four framework/database combinations plus a
bundled external provider. These are **synthetic consumer scenarios**, not
independent external production validation.

Formal v1.0 support and adoption guarantees remain gated on the external
P8 pilot evidence and release review.
