# Try json-to-express as an independent P8 pilot

**It takes one command to preview the generator without a database.**
This open-source project is seeking developers who can independently evaluate
Express/Fastify APIs generated for MongoDB or PostgreSQL.

**Interested?** [Reply in issue #57](https://github.com/ehk2509/json-to-express/issues/57)
with your preferred stack. You do **not** need to commit to 72 hours of
operation, share your organization, or reveal any private infrastructure.

## 1. Five-minute preview — no database or repo clone

You need Node.js 20+ and npm. The exact public beta version for the current
pilot cohort is **`json-to-express@0.2.0-beta.4`**. Its signed GitHub
[release](https://github.com/ehk2509/json-to-express/releases/tag/v0.2.0-beta.4)
points to immutable source commit:

~~~text
9be050be812d027c72eade61a0f47b295d1efcae
~~~

Preview the CRUD application in a temporary npm CLI installation:

~~~sh
npx --yes --package=json-to-express@0.2.0-beta.4 j2e init demo-api \
  --template crud --framework fastify --database postgresql \
  --deployment none --yes --dry-run
~~~

The `--dry-run` flag validates and previews the generated structure.
It **does not write a project, connect to a database or deploy a server.**
npm/npx does download and install the generator package and its normal
dependencies into the npm cache. Review the package first if necessary.

## 2. Optional code review without deploying

If you want to inspect actual generated files, run the following in a
**new, empty workspace**:

~~~sh
mkdir j2e-pilot-preview
cd j2e-pilot-preview
npx --yes --package=json-to-express@0.2.0-beta.4 j2e init demo-api \
  --template crud --framework fastify --database postgresql \
  --deployment none --yes --output ./demo-api
~~~

This writes `demo-api/app.j2e.json` and `demo-api/server/`. Inspect the
generated source, dependencies, authorization and migration scripts before
running any installation, server or database command. None are necessary to
give us useful first impressions.

You can also inspect the exact release source and compare its Git tag:

~~~sh
git clone https://github.com/ehk2509/json-to-express.git
cd json-to-express
git rev-parse v0.2.0-beta.4
# Expected: 9be050be812d027c72eade61a0f47b295d1efcae
~~~

For reproducible npm evidence, record the package's actual integrity using:

~~~sh
npm view json-to-express@0.2.0-beta.4 dist.integrity
~~~

**Do not substitute the moving `@beta` dist-tag** for the exact release during
a formal pilot, and do not assume later `main` commits are the same build.

## 3. Small, safe independent deployment

Only after your own review, choose a non-sensitive workload (tasks, inventory,
issue tracking or internal tooling). Start with a disposable staging database
you control. The maintainer-provided automated consumer smoke runner
**creates/deletes database records and may execute schema migrations**; do not
run it against a live production database.

If you decide to apply for **formal production validation**, use the
[P8 independent pilot playbook](P8-PILOT-PLAYBOOK.md). Qualifying evidence
requires an independently operated service, an audited restore/rollback drill,
at least 72 hours' observation, no unresolved blocking incidents, and a
different human reviewer. A preview, synthetic test, or self-report does not
qualify on its own.

## 4. Share feedback at any stage

| Your stage | What to do |
| --- | --- |
| Curious | [Reply in issue #57](https://github.com/ehk2509/json-to-express/issues/57) with your preferred framework/database |
| Code review | Share general impressions or a reproducible issue, without sensitive information |
| Ready to operate independently | [Apply for a P8 pilot](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-application.yml) |
| Completed a real pilot | [Submit a redacted evidence report](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-evidence.yml) |

Do not share passwords, tokens, customer data, database URLs, private service
addresses or internal logs. Stop a live pilot if you find an authentication
bypass, data loss, failed restore or other critical operational defect.

**Recruitment status: 0/3 independently reviewed pilot projects as of
15 October 2026.** Internal CI tests are passing, but external production
validation remains unconfirmed.
