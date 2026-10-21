# json-to-express

**Generate a Node.js API from a JSON specification.** Choose Express or
native Fastify, MongoDB/Mongoose or PostgreSQL/Prisma. Get a runnable REST API,
models, validation, health checks and optional auth, workflows, SDK, admin UI
and deployment scaffolding.

**Current status:** public beta `0.2.0-beta.5`. The `main` branch has newer
in-development capabilities. **This project has not yet released v1.0 or
completed independent external-production validation.**

> **Looking for independent pilot users.** [Try it without a database](docs/P8-GET-STARTED.md)
> or [join the P8 pilot discussion](https://github.com/ehk2509/json-to-express/issues/57).
> No 72-hour commitment is needed to express interest. For formal P8 evidence,
> pin the [specified source SHA](docs/P8-PILOT-PLAYBOOK.md) instead of assuming
> the npm beta tag contains subsequent changes.

## Try it

Use Node.js 20+ for new projects (Express also has legacy Node 18 tests;
Fastify 5 requires Node.js 20+).

~~~sh
npm install --global json-to-express@beta
j2e --version

# Preview only — does not create files or connect to a database
j2e init demo-api --template crud --framework express \
  --database mongodb --deployment none --yes --dry-run

# Generate when ready
j2e init demo-api --template crud --framework express \
  --database mongodb --deployment none --yes
j2e doctor demo-api/app.j2e.json
~~~

The initializer writes an editable JSON spec and a generated server. Review
the generated dependencies, authentication and migration configuration before
running it. Set `MONGODB_URI` or `DATABASE_URL` to an **isolated development
database** as appropriate. See the [full getting-started guide](docs/GETTING-STARTED.md)
for local execution and PostgreSQL migration steps.

You can also generate directly from a JSON spec:

~~~sh
j2e validate my-spec.json
j2e plan my-spec.json --output generated/my-api --json
j2e generate my-spec.json --output generated/my-api
~~~

## Features

| Area | Capability |
| --- | --- |
| Frameworks | Express and native Fastify (no Express compatibility shim for native Fastify) |
| Databases | MongoDB/Mongoose; PostgreSQL/Prisma |
| API | CRUD, configurable queries and relations, custom routes/workflows, optional GraphQL |
| Auth | JWT, API keys, local auth, OIDC and RBAC (configuration dependent) |
| Operations | Health/readiness, logging/metrics/tracing, Docker/Compose/Kubernetes manifests |
| Integrations | Optional caching, events/outbox/jobs, file uploads and S3-compatible storage |
| Consumers | Generated JavaScript/TypeScript SDK and optional React admin UI |
| Safety | Read-only regeneration plans, manifest ownership, guarded schema changes, crash recovery |
| Extensibility | Versioned plugin API, reference plugin and third-party provider support |

The reference documents explain feature prerequisites and limits. **Generated
files are a starting point**, not independently security-reviewed production
software.

## Documentation

| Goal | Guide |
| --- | --- |
| Install, initialize, configure | [Getting started](docs/GETTING-STARTED.md) |
| Browse examples by framework/database | [Packaged consumer examples](docs/EXAMPLES.md) |
| Use programmatic generator and CLI | [Public contracts & API](docs/GENERATOR-API.md) |
| Upgrade a generated project safely | [Upgrade guarantees](docs/UPGRADE-GUARANTEES.md) |
| Inspect or migrate live databases | [Database migration intelligence](docs/DATABASE-MIGRATIONS.md) |
| Recover interrupted generation | [Transactional regeneration](docs/TRANSACTIONAL-GENERATION.md) |
| Build an external provider or plugin | [Plugin API v1](docs/PLUGINS.md) |
| Install and verify plugins | [Plugin registry](docs/PLUGIN-REGISTRY.md) |
| Understand the production CI matrix | [Compatibility report](docs/PRODUCTION-COMPATIBILITY.md) |
| Release a beta with provenance | [Release process](docs/RELEASING.md) |
| Read every advanced configuration example | [Comprehensive reference](docs/REFERENCE.md) |

### P9 — stability & adoption (pre-v1)

P9 freezes the existing spec `1.0`, Plugin API v1, and public generator
entrypoint/CLI/manifest contracts with automatic compatibility checks.
It adds upgrade coverage for immutable npm beta.1, beta.2 and beta.3 across
four framework/database combinations, and independently *packaged* consumer
tests. These are reproducible engineering checks; they are **not**
independently operated external customer deployments.

~~~sh
npm test
npm run check
npm run check:p9
npm run test:p9-consumers
~~~

A formal v1.0 release and long-term support guarantees remain **gated** on
full CI, a reviewed compatibility policy and genuine independent P8 pilot
evidence. See [the contract policy](docs/GENERATOR-API.md) and
[external validation criteria](docs/EXTERNAL-VALIDATION.md).

## P8 independent pilot program

Contribute independent feedback by [commenting with your preferred stack](https://github.com/ehk2509/json-to-express/issues/57).
A disposable staging deployment is enough to begin. Formal production evidence
requires an independently operated deployment, a tested rollback plan,
72+ hours of observation and human review. No credentials, customer data or
private service addresses should be shared in public issues.

## License

MIT — see [LICENSE](LICENSE). Contributions and bug reports are welcome in
[GitHub Issues](https://github.com/ehk2509/json-to-express/issues).
