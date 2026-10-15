# P8 — External Production Validation

## What P8 can prove in CI

P8 provides a repeatable independent-*workspace* acceptance test using the actual
npm tarball built from the proposed commit, installed into a fresh consumer directory.
It does not import json-to-express directly from the repository.

Every scenario generates and installs a real API, runs against MongoDB 7 or
PostgreSQL 16, checks a create/read/invalid-write/delete lifecycle, verifies
persistence after a server restart, and executes 60 concurrent-batch reads.
CI stores a SHA-bound structured report containing only statuses, timings,
platform, spec hash and package integrity; no connection strings or data rows.

Scenarios intentionally exercise separate hypothetical consumers:
warehouse-orders (Express/MongoDB) and billing-invoices (Fastify/PostgreSQL).
They are **maintainer-designed synthetic workloads**, not actual customers.
Their reports have realExternalDeployment=false and can never qualify as
external adoption evidence.

The workflow .github/workflows/p8-consumer-validation.yml runs on PRs,
pushes to main and manual dispatch. CI must be green on the exact commit being
released. The P8 readiness artifact reports readiness separately from actual
external deployment acceptance. A green P8 smoke job alone is **not P8 complete**.

## Running a trusted pilot locally

An external adopter should create a separate case JSON with:
- version=1, id (non-sensitive slug);
- spec: a supported specVersion, app, database and entities, without plugins,
  custom package scripts or dependency overrides;
- probe: a simple /api/... CRUD route, non-sensitive sample payload, assertField
  and assertValue (the persisted value to verify after restart).

Copy the case into a fresh **trusted** workspace and run:

~~~sh
export MONGODB_URI='mongodb://localhost:27017/your_isolated_test_db'
# or export DATABASE_URL to a disposable PostgreSQL database.
node scripts/p8-consumer-smoke.js --case path/to/consumer.json \
  --report reports/consumer-smoke.json
~~~

**The test creates and deletes records, installs npm packages and may apply
Prisma migrations. Run only against an isolated disposable database.**
Do not aim this script at a production database or an untrusted spec.
The runner itself does not install third-party generator plugins.

A real production validation needs a **separate** deployment, owned/operated
by a party outside the maintainer's development effort. External operators
should:
1. Pin the exact source commit/package integrity and describe runtime versions.
2. Review generated code, authentication, permissions, migrations and secrets
   as they would any production application.
3. Stage database backup and a tested restoration/rollback drill.
4. Deploy the generated server with its actual external dependencies, TLS,
   quotas, monitoring, alerting and secret management in place.
5. Exercise persisted writes, data migrations, health/incident behavior,
   auth boundaries, error handling, concurrency and reconnect/restart behavior.
6. Observe for at least 72 hours while recording deployment and incident
   evidence, excluding personal data, credentials and customer records.
7. Submit a manually reviewable attestation with a durable *public* evidence URL.
   If evidence is confidential, keep the private materials with the reviewer
   and submit a redacted public technical summary instead.

No secret values, live customer records, private URIs or credentials belong in
ci/p8/attestations.json, GitHub Actions artifacts, issues or PR descriptions.

## External attestation schema

The checked-in ci/p8/attestations.json starts with an intentionally empty list.
Its acceptance policy asks for at least three independently operated projects,
across at least two organizations, covering both Express/Fastify and
MongoDB/PostgreSQL. Each must correspond to the exact release SHA, have 72+
hours of observation, no unresolved blocking incidents, and an attested
restoration/rollback drill.

For an actual externally deployed project, an item looks like:

~~~json
{
  "organization": "independent-organization",
  "project": "backend-service",
  "commit": "0000000000000000000000000000000000000000",
  "runtime": {"framework": "fastify", "database": "postgresql"},
  "observedHours": 96,
  "incidentCount": 0,
  "rollbackDrill": true,
  "operatorConfirmed": true,
  "publicEvidence": "https://example.org/engineering/json-to-express-pilot"
}
~~~

Replace the zero SHA with the actual 40-character commit. The attestation
index is public. All attestation claims require **independent human review**
of the evidence URL and deployer identity before being accepted as genuine
production validation. Code cannot authenticate a claim merely because it
matches JSON schema.

Generate the machine-readable assessment from the two smoke reports:

~~~sh
node scripts/p8-assess.js --sha "$GITHUB_SHA" \
  --index ci/p8/attestations.json \
  --report reports/warehouse-orders.json \
  --report reports/billing-invoices.json \
  --output reports/p8-readiness.json
~~~

Run the exact same command with --require-external to **fail closed** unless
the minimum external attestation evidence is present. The default command
lets engineers run smoke validation while explicitly reporting
awaiting-external-evidence.

## Release/no-go decision

For a P8 production-evidence acceptance, all must hold:
- Previous milestone P7 CI and full current-sha CI pass.
- Both isolated packaged-CLI smoke cases pass on the exact SHA.
- At least 3 external projects across 2 organizations complete 72+ hours
  each and collectively cover both frameworks and databases.
- Independent engineers review operator identity and published evidence,
  including rollback drills and zero unresolved blocking incidents.
- Critical security findings are closed and final release candidate is
  pinned to the same SHA and package integrity.
- A maintained go/no-go decision includes owners, known limits, incidents,
  and explicit rollback conditions.

Current repository evidence is **engineering readiness only** until independent
operators supply and reviewers verify production attestations. Never describe
a CI simulation, beta download, GitHub star, or generated local application
as an externally proven production deployment.

## Independent pilot recruitment and review (follow-up)

The [P8 pilot playbook](P8-PILOT-PLAYBOOK.md) now provides public
[application](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-application.yml)
and [evidence](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-evidence.yml)
issue forms, operator checklists, a redaction policy and an independent review
process. Applications and operator self-attestations **do not count** as
validated external deployments.

The first cohort is pinned to source commit
`9be050be812d027c72eade61a0f47b295d1efcae`
(see `ci/p8/attestations.json` `externalTargetCommit`).
This commit is the published `v0.2.0-beta.4` tag and
`json-to-express@0.2.0-beta.4` package. Prefer the exact-version
[no-database preview](P8-GET-STARTED.md) for newcomers, or check out the
exact SHA when auditing source. **Do not use the moving npm `@beta` tag**
for formal release-bound evidence.

The automated gate requires a separate `review` object with an approved
decision, distinct operator/reviewer GitHub handles, a link to an issue in
this repository, UTC review timestamp and five explicit checklist approvals:
independent operation, deployment, rollback, incidents and privacy.
Only reviewed attestations count; pending/rejected/self-reviewed submissions
do not qualify.

The tool validates review metadata, **not the external authenticity** of a
GitHub account or public report. A human maintainer must verify those
independently and request code review before incorporating evidence. A
validated historical cohort remains pinned to its own commit if newer CI
changes land on `main`; newer releases need their own release review.
