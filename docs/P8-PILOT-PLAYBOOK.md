# P8 independent pilot playbook

## Recruiting the first external cohort

**Goal:** three genuinely independently operated deployments, across at least
two separate organizations, collectively covering Express, Fastify, MongoDB,
and PostgreSQL. Each should complete a minimum of **72 hours of observation**,
with a reviewed rollback drill and no unresolved blocking incidents.

**Current state:** recruitment is open; **zero external pilots are certified**.
Internal CI jobs and generated examples are not external production evidence.

- [Apply to run a pilot](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-application.yml)
- [Submit redacted pilot evidence](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-evidence.yml)
- [P8 technical acceptance framework](EXTERNAL-VALIDATION.md)

Use the GitHub issue to coordinate pilot questions publicly. No one needs to
provide their email, actual infrastructure addresses, business names or secrets.
Private company information must not be copied into public issues or artifacts.
The maintainer is not recruiting on behalf of external third parties.

## Candidate release: pin the actual source

The first cohort currently targets commit:

```text
dc964d701dc7236bf9dc7a586b6c1e7e78e066f2
```

This immutable source commit passed full CI and the packaged-consumer P8
workflow. **The npm beta dist-tag can point to a different code SHA**. In
particular `v0.2.0-beta.3` was tagged on a different earlier commit; do not
assume it is identical to this candidate.

To reproduce the exact cohort revision in an approved, isolated environment:

```sh
git clone https://github.com/ehk2509/json-to-express.git
cd json-to-express
git checkout --detach dc964d701dc7236bf9dc7a586b6c1e7e78e066f2
git rev-parse HEAD
npm test
npm pack
# Use the resulting .tgz only in an approved isolated pilot workspace.
```

Record the exact SHA and `npm pack --json` integrity value in the pilot report.
Before anyone claims validation of a newer release, create a new cohort or
explicitly retest the new release. A changing CI branch head does not reset the
72-hour observation window for a **fixed** pilot commit; its suitability for
subsequent releases still requires engineering review.

## Pilot owner checklist

1. Confirm independent control of a real target service. No maintainer-owned
   app, fabricated organization, or internal CI simulation qualifies.
2. Open the application issue, disclose only framework/database and
   non-sensitive use-case category. Choose a disposable stage for initial tests.
3. Verify the exact source SHA, generated dependency lockfile, Node version,
   database versions, framework choice, and migration plans.
4. Review generated code, RBAC/authentication, request validation, rate limits,
   log/trace redaction, dependencies, and operational security controls. Do not
   use generated defaults without production review.
5. Exercise core routes and persistence against the operator's isolated staging
   database. Perform and record a **restore/rollback drill** against an isolated
   recovery destination before production use.
6. If authorized by the operator's organization, run the independently managed
   service for at least 72 hours, observing health, latency, 5xx rate, restart
   persistence, reconnects, data consistency and incidents. Keep maintenance
   windows and incident records; synthetic traffic alone is not sufficient.
7. Stop the pilot, or flag it as blocked, for a critical vulnerability, failed
   backup/restore, unintended data loss, uncontained auth bypass or repeated
   data corruption.
8. Submit a public *redacted* technical summary using the evidence issue
   template. Keep private logs, sensitive endpoints, configuration files,
   records and credentials outside GitHub.

The initial test can be performed without production access. **Do not execute
the P8 consumer smoke runner or Prisma migration commands against live
production data**; they create/delete records and may change the schema.

## Required redacted evidence

Include in the public technical report:

| Field | Minimum evidence |
| --- | --- |
| Operator | Independent GitHub handle or pseudonym |
| Project | Public non-sensitive slug and workload category |
| Version | Exact 40-character git SHA and build artifact integrity |
| Stack | Framework, Node version, database type/version |
| Window | Observation start/end UTC and total hours (72+) |
| Core behavior | Create/read/update/delete, validation and auth outcome |
| Recovery | Backup timestamp, tested restore location type and result |
| Resilience | Restart/persistence and reconnect/incident outcomes |
| Reliability | Aggregated requests, error rate, representative p50/p95 latency |
| Outcome | Open blockers (must be zero to qualify), limitations and next steps |
| Evidence | Permanent accessible HTTPS URL with redacted supporting material |

Public evidence can be an issue, a Gist, or a markdown file in a repository.
Private evidence may support a confidential manual review, but it cannot on
its own establish the public evidence URL required by the published cohort
acceptance policy.

## Reviewer checklist and acceptance decision

Reviewers **must be a different individual from the pilot operator**. A pilot
application/evidence issue is never itself an approval.

1. Independently verify the reviewer and operator's GitHub identities and
   organizational independence. Do not rely on a JSON claim as authentication.
2. Review the operator's deployment timeline, SHA, dependency versions,
   anonymized service telemetry, and the redacted report URL.
3. Inspect the recovery drill notes for a real restore/rollback, not merely
   the presence of a backup file.
4. Confirm the 72+ hour window, no blocking incident left unresolved,
   and the relevant stack coverage.
5. Record approval or rejection in the **same GitHub issue**, with explicit
   reviewer identity, date, observations and caveats. If in doubt, do not approve.
6. Only after the above steps, open a PR updating `ci/p8/attestations.json`
   with the pilot's evidence and the review metadata. Require code review for
   that PR; do not bypass repository branch policies.

The machine gate expects an object like:

```json
{
  "organization": "independent-org",
  "project": "sample-api",
  "operatorGithub": "external-developer",
  "commit": "dc964d701dc7236bf9dc7a586b6c1e7e78e066f2",
  "runtime": {"framework": "express", "database": "mongodb"},
  "observedHours": 96,
  "incidentCount": 0,
  "rollbackDrill": true,
  "operatorConfirmed": true,
  "publicEvidence": "https://example.org/redacted-p8-results",
  "review": {
    "decision": "approved",
    "reviewer": "different-reviewer",
    "issue": "https://github.com/ehk2509/json-to-express/issues/123",
    "reviewedAt": "2026-10-25T10:00:00Z",
    "checks": {
      "independentOperator": true,
      "deploymentReviewed": true,
      "rollbackReviewed": true,
      "incidentsReviewed": true,
      "evidenceRedacted": true
    }
  }
}
```

**This example is fictional. Do not commit it to the real attestation index.**

Only reviewed entries are counted. Self-attested, pending, rejected or
self-reviewed submissions are excluded. Static checks cannot authenticate
reviewer identities or ensure remote evidence is genuine; human review is
still mandatory.

## Program status and release gate

`ci/p8/attestations.json` pins the `externalTargetCommit` for this cohort.
`scripts/p8-assess.js` compares current CI smoke reports against the current
CI SHA, while evaluating external operator attestations against that
separately pinned cohort SHA. This prevents unrelated documentation commits
from invalidating genuine historical observation windows.

Do **not** lower the acceptance thresholds to make the project look adopted.
Update the status to externally validated only after three qualifying external
pilots and documented independent review, with explicit limitations noted.
