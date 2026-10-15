# Releasing json-to-express

## Preparing a new beta

The release workflow is .github/workflows/publish-beta.yml. Keep this exact
filename because npm Trusted Publishing checks the workflow identity.

1. Update the package.json version to a new semver prerelease ending in
   -beta.N, for example 0.2.0-beta.3.
2. Add a dated ## [0.2.0-beta.3] - YYYY-MM-DD entry as the newest release in
   CHANGELOG.md, below the optional Unreleased section. Include meaningful
   release bullets; do not reuse versions or edit old release entries.
3. Open a PR and wait for the complete CI suite, including release-security
   and packaged-install-e2e.
4. Merge. Successful push CI on main triggers the release workflow, which
   derives its tag and release notes from package.json and CHANGELOG.md.
   No edits to the GitHub Actions workflow are needed for the next beta.

Local checks:

~~~bash
npm test
npm run check
npm run check:release
npm run validate:examples
npm run test:package
~~~

The CI release-security job audits the generator dependencies and one
representative generated application's production dependency tree with
npm audit --audit-level=high. It generates temporary npm lockfiles and
does not alter developer-owned generated applications.

## Release integrity guarantees

Only a completed successful push CI run for this repository's main branch
is eligible to release. The release job checks out the exact CI commit SHA,
verifies that the commit remains the current main head, and verifies the
matching package version and latest changelog release entry. Superseded
CI runs are skipped.

A repository-wide concurrency group serializes GitHub tag creation,
GitHub releases and npm publication, and does not cancel active publishers.
Tags are created directly at the CI commit SHA and never moved. If a
published version is still present in package.json after main advances,
the release is skipped instead of creating a new tag. Existing tags at
the expected commit are verified before and after GitHub Release creation.
Release notes are generated automatically from the changelog.

After an accepted `npm publish`, registry processing can take several
minutes. The npm job uses a read-only, cache-bypassing verifier
(`scripts/npm-registry-visibility.js`) with a 15-minute visibility deadline
and 10-second polling interval; the overall job has a 20-minute limit.
Transient HTTP 404/429/5xx and network errors are retried, while mismatched
metadata or invalid successful responses fail closed. Reruns first check
whether the exact version already exists and never republish it. If the
visibility deadline expires, inspect the registry before attempting another
publication; an npm publish may already have been accepted.

The npm job receives the verified release version, tag and SHA, checks out
that exact commit, validates the tag's object SHA, and uses GitHub OIDC to
publish the public npm beta with provenance. It never republishes an
existing npm version, and verifies registry visibility after publication.

## npm Trusted Publisher (one-time setup)

The package is already registered on npm, and OIDC publishing was verified
in v0.2.0-beta.2. To maintain the connection:

- GitHub owner: ehk2509
- Repository: json-to-express
- Workflow filename: publish-beta.yml
- GitHub Actions environment: none
- Allowed action: npm publish
- Repository Actions variable: NPM_TRUSTED_PUBLISHING_ENABLED=true
- Node 24/npm >= 11.5.1 and permissions id-token: write
- No NPM_TOKEN or NODE_AUTH_TOKEN secret required

The workflow filename must not change without also updating npm Trusted
Publisher settings.

## Recovering from failures

- If a version is already tagged on an older SHA, bump package.json and
  CHANGELOG.md to a *new* version; never move the tag.
- If a release from the current commit is incomplete, rerun the eligible
  workflow. The release and registry version checks make it idempotent.
- If a tag mismatch occurs, stop and investigate instead of force-pushing.
- If npm OIDC fails, verify trusted publisher identity, allowed npm publish
  permission, and NPM_TRUSTED_PUBLISHING_ENABLED.
- If a dependency audit fails, review and fix the advisory and rerun CI;
  do not weaken the security gate just to publish.
- npm releases are irreversible. Publish a new version for a fix.

After a release, verify:

~~~bash
npm view json-to-express@beta version
npm install -g json-to-express@beta
j2e --version
~~~

npm Trusted Publishing documentation: https://docs.npmjs.com/trusted-publishers/

## P9 v1.0 release conditions

P9 adds a pre-v1 public contract gate, real upgrade tests for immutable
npm betas 0.2.0-beta.1 through 0.2.0-beta.3, and consumer tests that
import the **installed npm tarball** from an external workspace. CI should
execute `node scripts/p9-contract-check.js` and
`node scripts/p9-consumer-contract.js` in addition to the existing
release checks. Changes to the frozen baseline require explicit compatibility
review, not a snapshot rewrite to bypass failed tests.

The current pre-v1 beta must **not** be promoted to 1.0.0 just because the
P9 engineering checks pass. The release gate additionally requires completed
independent P8 production-pilot evidence and ratified long-term support
terms (which specs, plugin versions, runtime combinations and migration paths
the maintainers will support). See [P9 upgrade guarantees](UPGRADE-GUARANTEES.md).
