# Try json-to-express for an independent P8 pilot

**No commitment needed to express interest.** The project is inviting external
Node.js developers and small teams to evaluate a JSON-first generator for
Express or native Fastify APIs with MongoDB or PostgreSQL.

**You can simply [reply to the recruitment issue](https://github.com/ehk2509/json-to-express/issues/57)
with the framework/database you might try.** Don't commit to a 72-hour
observation window until you've reviewed the tooling and agreed on a safe scope.

## What you can evaluate

From one JSON specification, the generator can produce CRUD APIs, server code,
Mongoose or Prisma models, health checks, SDK/admin assets and optional
authentication, storage and deployment templates.

This is an **experimental public beta**, not a production security
certification. Generated applications must receive the same application,
dependency, migration and security review as hand-written code.

## Step 1: inspect the exact pilot candidate without a database

Requirements: Git, Node.js 20+ and npm. The initial preview doesn't need an
account, secrets, database connection or running service.

~~~sh
git clone https://github.com/ehk2509/json-to-express.git
cd json-to-express
git checkout --detach dc964d701dc7236bf9dc7a586b6c1e7e78e066f2
npm install --ignore-scripts --no-audit --no-fund
node bin/json-to-express.js init demo-api --template crud \
  --framework fastify --database postgresql --deployment none \
  --yes --dry-run
~~~

The dry run shows what the generator would create. For a real generated
workspace **on your own machine**, omit `--dry-run` and select a dedicated
output directory:

~~~sh
node bin/json-to-express.js init demo-api --template crud \
  --framework fastify --database postgresql --deployment none \
  --yes --output .tmp/pilot-preview
node bin/json-to-express.js validate .tmp/pilot-preview/app.j2e.json
~~~

Examine the generated source, deployment settings and dependencies before
running or exposing it. A generated application is not automatically deployed
or connected to a database by these commands.

> The pilot cohort is pinned to **source commit
> `dc964d701dc7236bf9dc7a586b6c1e7e78e066f2`**. The published
> `v0.2.0-beta.3` package points to an earlier source revision; trying that
> beta can help you explore the CLI, but its results are not evidence for the
> pinned P8 cohort.

## Step 2: choose a safe, small pilot

Use a **disposable database** and a non-sensitive workload. Examples are
an inventory list, task tracker, internal admin tool or prototype service.

| You want to... | Suggested next action |
| --- | --- |
| Only explore | Run the dry-run command above, open an issue with questions |
| Try a generated API | Inspect it and deploy it to your own isolated staging database |
| Help validate production suitability | Agree on a reviewed operational plan and observe an independently operated service |
| Report a blocker | Open a bug issue with minimal reproduction and no credentials |

The pilot acceptance criteria are intentionally demanding: at least **72 hours
of independent operation**, reviewed recovery drills, no unresolved blocking
incidents and an independent reviewer. These criteria apply to **certification
of evidence**, not to initial interest or feedback.

## Step 3: join or report findings

- **[Raise your hand — Issue #57](https://github.com/ehk2509/json-to-express/issues/57):**
  comment with `Interested — Fastify + PostgreSQL — disposable staging`.
  You can use a pseudonym and do not need to share your company name.
- **[Formal application](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-application.yml):**
  once you are able to operate a pilot independently.
- **[Evidence submission](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-evidence.yml):**
  after a real deployment and redacted evidence are available.
- **[Full independent pilot playbook](P8-PILOT-PLAYBOOK.md):**
  security, rollback, reviewer and observation guidelines.

**Never post** production database URLs, API keys, passwords, private server
addresses, internal logs or customer records in issues or reports. Stop the
pilot if you discover data loss, a major authentication bypass, failed restore
or other serious reliability/security issue.

## What success means

We're looking for **three real pilot projects from two independent
organizations**, collectively covering both frameworks and both database
engines. Reproducible internal CI tests are already passing, but they do not
count as independent production use.

**External pilot status: 0 verified as of 15 October 2026.** This number only
changes after an independent review and an approved attestation.
