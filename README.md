# json-to-express

Generate a runnable Express or Fastify application from a declarative JSON specification. `app.framework: "fastify"` uses native Fastify handlers when supported; configurations with fully native CRUD and routes now generate an adapter-free Fastify app without the Express runtime. Fastify configurations use native routes and hooks without an Express compatibility adapter; unsupported configurations fail generation with an explicit error.

The project is JSON-first: runtime behavior, project layout, routes, persistence target, query behavior, middleware, hooks, package metadata, and server settings are described in JSON.

Two persistence targets now share the same normalized application model:

- MongoDB + Mongoose — full v1 target, including workflows/outbox/jobs
- PostgreSQL + Prisma — full application target with CRUD, relations, workflows/outbox/jobs, auth, REST/GraphQL, SDK/admin, and a dedicated real-Postgres E2E

## What is generated

- Express app and server bootstrap
- MongoDB/Mongoose or PostgreSQL/Prisma connection
- Mongoose models or Prisma schema/client
- CRUD controllers and routers
- configurable query semantics
- configurable error handling and health endpoint
- optional structured logs, Prometheus metrics, liveness/readiness, and OpenTelemetry traces
- multipart file fields with local or S3-compatible object storage
- generated package.json and .env.example
- generated health smoke test
- .j2e-manifest.json for safe regeneration

## Quick start

~~~bash
node bin/json-to-express.js validate examples/shop.json
node bin/json-to-express.js generate examples/shop.json
~~~

Or override the destination:

~~~bash
node bin/json-to-express.js generate examples/shop.json --output generated/shop-api
~~~

Then:

~~~bash
cd generated/shop-api
npm install
cp .env.example .env
npm start
~~~

## CLI

~~~text
j2e validate <spec.json>
j2e generate <spec.json> [--output <dir>] [--force]
~~~

The output flag overrides generation.outputDir.

Force does not delete the output directory. It only allows replacement of generator-owned files that were modified since the previous generation.

## Safe deterministic regeneration

Every generated project receives .j2e-manifest.json. The manifest stores the set of generator-owned files and their hashes.

On regeneration json-to-express:

1. updates unmodified generated files
2. removes stale generator-owned files when generation changes
3. preserves files it does not own
4. detects manual changes to generated files
5. refuses conflicts unless force is explicitly used
6. even with force, never adopts a non-empty directory that has no manifest
7. rejects dangerous output targets such as filesystem root, home, or the generator working directory

Custom files therefore survive regeneration.

## One specification contract

The machine-readable source of truth is:

~~~text
schema/application.schema.json
~~~

Runtime structural validation uses that schema directly. Hand-written validation is now limited to semantic cross-field rules such as route parameter consistency and pagination constraints.

Unknown JSON keys fail validation instead of being silently ignored. Open-ended option maps remain allowed only where they are intentional, such as Mongo, Mongoose, npm scripts, and dependency configuration.

## Minimal specification

~~~json
{
  "app": {
    "name": "todo-api"
  },
  "database": {
    "type": "mongodb"
  },
  "entities": {
    "Todo": {
      "fields": {
        "title": {
          "type": "string",
          "required": true
        }
      }
    }
  }
}
~~~

Defaults include port 3000, host 0.0.0.0, API prefix /api, health path /health, MONGODB_URI, Mongoose timestamps, and conventional CRUD endpoints.

## Generation layout

~~~json
{
  "generation": {
    "outputDir": "generated/catalog",
    "paths": {
      "source": "app",
      "models": "domain",
      "controllers": "handlers",
      "routes": "http",
      "config": "settings",
      "middleware": "middleware",
      "tests": "spec"
    }
  }
}
~~~

Generated import paths and package entry points are recalculated automatically when directories change.

## Server and Express

~~~json
{
  "app": {
    "name": "catalog-api",
    "port": 8080,
    "portEnv": "HTTP_PORT",
    "host": "127.0.0.1",
    "hostEnv": "HTTP_HOST",
    "startupMessage": "catalog listening at {host}:{port}",
    "apiPrefix": "/api/v2",
    "express": {
      "trustProxy": 1,
      "json": {
        "enabled": true,
        "limit": "5mb"
      },
      "urlencoded": {
        "enabled": false,
        "extended": true,
        "limit": "1mb"
      }
    }
  }
}
~~~

## Health

~~~json
{
  "app": {
    "health": {
      "enabled": true,
      "path": "/ready",
      "status": 200,
      "response": {
        "service": "catalog",
        "ready": true
      }
    }
  }
}
~~~

Disabling health removes both the endpoint and its stale generated smoke test on the next regeneration.

## Error payloads

Global error responses can be strings or JSON values:

~~~json
{
  "app": {
    "responses": {
      "notFound": {
        "code": "ROUTE_NOT_FOUND"
      },
      "validationError": "Payload rejected",
      "invalidIdentifier": "Invalid id",
      "uniqueConstraint": "Already exists",
      "internalError": {
        "code": "INTERNAL_ERROR"
      }
    },
    "statusCodes": {
      "notFound": 404,
      "validationError": 422,
      "invalidIdentifier": 400,
      "uniqueConstraint": 409,
      "internalError": 500
    }
  }
}
~~~

Entities can also define notFoundResponse.

## MongoDB

~~~json
{
  "database": {
    "type": "mongodb",
    "uriEnv": "CATALOG_MONGO_URL",
    "defaultUri": "mongodb://127.0.0.1:27017/catalog",
    "options": {
      "maxPoolSize": 20,
      "serverSelectionTimeoutMS": 5000
    }
  }
}
~~~

database.options is forwarded to mongoose.connect.

## PostgreSQL + Prisma target

Choose PostgreSQL directly in the same application spec:

~~~json
{
  "database": {
    "type": "postgresql",
    "uriEnv": "DATABASE_URL",
    "defaultUri": "postgresql://postgres:postgres@127.0.0.1:5432/catalog",
    "idStrategy": "uuid",
    "prisma": {
      "schemaPath": "prisma/schema.prisma"
    }
  }
}
~~~

The generated project includes @prisma/client, the Prisma CLI, schema generation, and these scripts:

~~~bash
npm run prisma:generate
npm run db:push
npm start
~~~

For versioned production migrations, run `npm run db:migrate:init` to generate a reviewed, versioned initial SQL migration with Prisma `migrate diff` without a running database. The command refuses to overwrite existing migration history. For later changes, use `npm run db:migrate:dev -- --name change_name` against a disposable development database. Commit the generated `prisma/migrations` directory. Deploy only reviewed migrations with `npm run db:migrate:deploy`; inspect status using `npm run db:migrate:status`. Never use `db:push` as a production migration replacement.

Optional declarative PostgreSQL seeds use a top-level `seeds` object keyed by entity name. A `factories` map can additionally generate bounded deterministic fixtures, e.g. `"factories": {"Category": {"count": 3, "template": {"name": "Category {{index}}"}}}`. The placeholder is replaced by 1-based row numbers. For example:

~~~json
{
  "seeds": {
    "Category": [{"name": "Hardware"}, {"name": "Books"}]
  }
}
~~~

Relational PostgreSQL fixtures can be declared separately from simple seeds and factories:

~~~json
{
  "fixtures": {
    "Category": [
      {"where": {"name": "Hardware"}, "data": {"name": "Hardware"}}
    ],
    "Product": [
      {"where": {"sku": "SKU-1"}, "data": {"sku": "SKU-1", "category": {"where": {"name": "Hardware"}}}}
    ]
  }
}
~~~

The generated seed runner uses Prisma `upsert` for these fixtures, resolves references through unique-key lookups, and orders entity batches by relation dependencies. Selectors must use declared unique scalar fields; cycles, unsupported fields and missing dependency batches fail validation. These fixtures currently support single-valued relations, not many-to-many or self-referential graphs. Production seed use should still be reviewed carefully because reruns update matching records.

The generated `npm run db:seed` uses Prisma `createMany` with `skipDuplicates`. Only scalar fields are supported for now; repeated seed runs avoid duplication only when suitable database unique constraints exist. These seeds are intentionally separate from schema migrations.

PostgreSQL uses UUID primary keys while MongoDB continues to use ObjectId identifiers. Generated route validation and OpenAPI adapt automatically.

The same entity JSON generates Prisma models, relation foreign keys, inverse relations, indexes, table mappings, timestamps, soft-delete fields, audit fields, and CRUD controllers.

For example, a reference:

~~~json
{
  "category": {
    "type": "reference",
    "ref": "Category",
    "required": true,
    "onDelete": "restrict"
  }
}
~~~

becomes a named Prisma relation with a UUID foreign key and Restrict referential action. nullify maps to SetNull for optional references and cascade maps to Cascade.

The Prisma CRUD target supports:

- create/get/list/update/delete
- relation connect/disconnect
- populate through Prisma include/select
- filtering and allowlisted operators
- numeric/boolean/date query coercion
- sorting, projection, and pagination
- soft delete
- optional Prisma transactions
- hooks
- auth/RBAC
- generated request validation
- OpenAPI UUID contracts
- Prisma unique/FK/not-found error mapping

### PostgreSQL-specific boundaries

PostgreSQL/Prisma now covers the same major application features as MongoDB/Mongoose, including workflows, durable outbox/jobs, many-to-many relations, multi-strategy auth, REST, and GraphQL.

Remaining differences are ORM-specific options: Mongoose-only `schemaOptions` and raw field `options` are rejected for PostgreSQL instead of being silently ignored.

## Entities and Mongoose

~~~json
{
  "entities": {
    "Product": {
      "route": "catalog",
      "collection": "catalog_items",
      "idParam": "productId",
      "notFoundResponse": {
        "code": "PRODUCT_NOT_FOUND"
      },
      "schemaOptions": {
        "timestamps": false,
        "versionKey": "revision",
        "strict": "throw"
      },
      "fields": {
        "name": {
          "type": "string",
          "required": true,
          "minLength": 2,
          "options": {
            "trim": true,
            "index": true
          }
        },
        "price": {
          "type": "number",
          "required": true,
          "min": 0
        }
      }
    }
  }
}
~~~

First-class field properties include type, required, unique, enum, min, max, minLength, maxLength, and default.

field.options and schemaOptions are intentional JSON-serializable Mongoose extension surfaces.

## CRUD customization

~~~json
{
  "entities": {
    "Product": {
      "idParam": "productId",
      "operations": {
        "list": {
          "enabled": true,
          "method": "post",
          "path": "/search",
          "status": 200,
          "lean": true
        },
        "get": {
          "method": "get",
          "path": "/item/:productId",
          "status": 200,
          "notFoundStatus": 404,
          "selectParam": "fields"
        },
        "create": false,
        "update": {
          "method": "put",
          "path": "/item/:productId",
          "status": 200,
          "notFoundStatus": 404,
          "runValidators": true
        },
        "delete": {
          "method": "delete",
          "path": "/item/:productId",
          "status": 204,
          "notFoundStatus": 404
        }
      }
    }
  }
}
~~~

## List query semantics

List endpoints can declaratively define filtering, sorting, projection, and bounded pagination.

~~~json
{
  "entities": {
    "Product": {
      "operations": {
        "list": {
          "query": {
            "filters": ["name", "status"],
            "sortParam": "sort",
            "selectParam": "fields",
            "pagination": {
              "enabled": true,
              "pageParam": "page",
              "limitParam": "limit",
              "defaultLimit": 20,
              "maxLimit": 100
            }
          }
        }
      }
    }
  }
}
~~~

The generator emits filter construction, sort/select application, and skip/limit pagination instead of a fixed Model.find call with no request semantics.

## Custom middleware

Executable code is never embedded as raw JavaScript strings in JSON.

Developer-owned middleware modules can be referenced declaratively:

~~~json
{
  "app": {
    "middlewareModules": [
      "custom/request-context.js",
      "custom/auth.js"
    ]
  }
}
~~~

These files are not generator-owned and survive regeneration.

## Before and after hooks

Per-operation entity hooks connect business logic without modifying generated controllers:

~~~json
{
  "entities": {
    "Product": {
      "hooks": {
        "module": "custom/product-hooks.js",
        "before": {
          "create": "beforeCreate",
          "update": "beforeUpdate"
        },
        "after": {
          "create": "afterCreate",
          "update": "afterUpdate"
        }
      }
    }
  }
}
~~~

Hooks receive an object containing req, res, model, and result when applicable. If a hook sends a response, generated controller execution stops when res.headersSent becomes true.

## Generated package.json

~~~json
{
  "app": {
    "package": {
      "name": "catalog-service",
      "version": "1.2.0",
      "private": true,
      "description": "Catalog API",
      "nodeEngine": ">=20",
      "main": "app/server.js",
      "scripts": {
        "lint": "node --check app/app.js"
      },
      "dependencies": {
        "express": "^5.1.0"
      },
      "devDependencies": {}
    }
  }
}
~~~

Configured scripts and dependency versions override defaults.

## Generator architecture

~~~text
JSON
 |
 v
JSON Schema structural validation
 |
 v
semantic validation
 |
 v
normalized application model
 |
 +-- model generator
 +-- controller generator
 +-- route generator
 +-- app generator
 +-- server generator
 +-- database generator
 +-- error generator
 +-- package/docs/test generators
 |
 v
safe manifest writer
 |
 v
runnable application
~~~

The original monolithic generator has been split into focused modules under src/generators.

## v1 application capabilities

The v1 specification adds the production capabilities needed for real Express/Mongoose services.

### Specification versioning

New specifications can declare:

~~~json
{
  "specVersion": "1.0"
}
~~~

Unversioned prototype specifications are upgraded through the compatibility layer to the current 1.0 contract. Unsupported explicit versions fail fast instead of being interpreted ambiguously.

### Relationships and delete policies

Reference fields are declarative:

~~~json
{
  "category": {
    "type": "reference",
    "ref": "Category",
    "required": true,
    "onDelete": "restrict"
  }
}
~~~

Set "many": true for to-many relations:

~~~json
{
  "tags": {
    "type": "reference",
    "ref": "Tag",
    "many": true,
    "onDelete": "nullify"
  }
}
~~~

MongoDB stores many references as ObjectId arrays. PostgreSQL/Prisma emits an implicit many-to-many join relation with generated inverse fields; create uses connect[], updates replace the relation through set[], and populated operations use Prisma include/select.

Supported delete policies remain restrict, nullify, and cascade. For PostgreSQL to-many relations these policies are enforced by the generated application inside a transaction because Prisma implicit many-to-many join tables do not expose referential actions directly.

List filters can target a many-reference field by related id. PostgreSQL translates those filters to relation some/none predicates; MongoDB uses normal array membership matching.

Operations can declare the same field in populate for either target. OpenAPI exposes identifier arrays, the TypeScript SDK emits string[] inputs and Array<string | Entity> outputs, and the generated admin UI automatically renders a multi-select relation control.

### Compound indexes

Entities can define compound or advanced Mongoose indexes:

~~~json
{
  "indexes": [
    {
      "fields": {
        "name": 1,
        "createdAt": -1
      },
      "options": {
        "unique": false
      }
    }
  ]
}
~~~

### Authentication and RBAC

Authentication can use one or several strategies from the same JSON contract:

~~~json
{
  "auth": {
    "enabled": true,
    "strategies": ["jwt", "apiKey", "session", "oidc"],
    "jwt": {
      "secretEnv": "JWT_SECRET",
      "accessTtlSeconds": 900,
      "refresh": {
        "enabled": true,
        "ttlSeconds": 2592000
      }
    },
    "apiKey": {
      "header": "x-api-key",
      "keys": [
        {
          "env": "INTERNAL_API_KEY",
          "userId": "internal-service",
          "roles": ["admin"]
        }
      ]
    },
    "session": {
      "cookieName": "j2e_session",
      "ttlSeconds": 86400,
      "secure": true,
      "sameSite": "lax"
    },
    "local": {
      "enabled": true,
      "allowRegistration": true,
      "defaultRoles": ["user"],
      "passwordMinLength": 12
    },
    "oidc": {
      "enabled": true,
      "issuer": "https://id.example.com",
      "clientIdEnv": "OIDC_CLIENT_ID",
      "scopes": ["openid", "profile", "email"]
    }
  }
}
~~~

The legacy form with `"strategy": "jwt"` remains supported.

Generated authentication can include:

- JWT bearer verification and short-lived access-token issuance
- opaque refresh-token rotation with hashed durable storage
- API-key authentication with timing-safe comparison
- durable HttpOnly cookie sessions
- local email/password registration and login using scrypt password hashing
- logout and stateful token/session revocation
- forgot/reset-password with one-time hashed reset tokens
- optional password-reset webhook delivery
- OIDC discovery and remote JWKS verification
- OIDC Authorization Code + PKCE login/callback flow
- shared RBAC for REST, custom workflow endpoints, and GraphQL

MongoDB generates internal Mongoose auth-user/token models. PostgreSQL generates equivalent Prisma models. Stateful session, refresh, reset, and OIDC-state tokens are persisted only as SHA-256 hashes.

Each operation can restrict both roles and accepted strategies:

~~~json
{
  "operations": {
    "delete": {
      "auth": {
        "required": true,
        "roles": ["admin"],
        "strategies": ["jwt", "session"]
      }
    }
  }
}
~~~

When `strategies` is omitted from an operation, all globally enabled strategies are accepted. Authentication and role checks happen before controller or workflow execution.

Local auth adds configurable endpoints for register, login, logout, refresh, forgot-password, reset-password, OIDC login, and OIDC callback. OpenAPI documents these endpoints and emits JWT, API-key, session-cookie, and OpenID Connect security schemes.

### Request validation

Generated request middleware validates create/update payload types, required fields, single and array reference identifiers, and resource identifiers before database access. Required many-reference fields reject empty arrays.

This gives the generated API an HTTP validation boundary in addition to persistence-layer validation.

### OpenAPI

OpenAPI 3.1 is generated from the same normalized application model as the Express routes:

~~~json
{
  "docs": {
    "openapi": {
      "enabled": true,
      "file": "docs/openapi.json",
      "title": "Catalog API",
      "version": "1.0.0"
    }
  }
}
~~~

Entity schemas, paths, request bodies, path/query parameters, status codes, authentication endpoints, and enabled JWT/API-key/session/OIDC security requirements therefore derive from the same IR as the runtime application.

### Advanced filters

List operations can allow specific query operators:

~~~json
{
  "query": {
    "filters": ["price", "createdAt"],
    "operators": ["eq", "gte", "lte", "in"]
  }
}
~~~

Clients use allowlisted parameters such as price__gte or status__in. Supported operators are eq, ne, gt, gte, lt, lte, and in. They are translated by generated code rather than exposing arbitrary Mongo operators.

### Soft delete and audit fields

~~~json
{
  "softDelete": {
    "enabled": true,
    "field": "deletedAt"
  },
  "audit": {
    "enabled": true,
    "createdBy": "createdBy",
    "updatedBy": "updatedBy"
  }
}
~~~

Generated reads hide soft-deleted rows, generated deletes mark them deleted, and audit fields use the authenticated user id when available.

### Optional transactions

Write operations can opt into Mongoose sessions:

~~~json
{
  "operations": {
    "create": {
      "transaction": true
    }
  }
}
~~~

The controller generator wraps the operation in the target transaction primitive when requested: Mongoose sessions for MongoDB and Prisma transactions for PostgreSQL.

### Environment contract

Application-specific variables can be declared and validated at startup:

~~~json
{
  "environment": {
    "EXTERNAL_API_URL": {
      "required": true,
      "description": "Upstream service"
    }
  }
}
~~~

Database URLs plus enabled authentication secrets—JWT secrets, API-key values, OIDC client credentials, and optional reset-webhook URLs—are automatically included in the generated environment guard.

### Production middleware

The production block can enable request IDs, security headers, CORS, rate limiting, and compression. Optional package dependencies are added only when required.

Generated servers also handle SIGTERM and SIGINT with graceful HTTP shutdown and database disconnect.

## File upload and object storage

File fields are declared in the same entity model:

~~~json
{
  "storage": {
    "enabled": true,
    "provider": "local",
    "signedUrls": {
      "enabled": true,
      "expiresSeconds": 900,
      "path": "/files/:token",
      "signingSecretEnv": "FILE_SIGNING_SECRET"
    },
    "local": {
      "directory": "uploads"
    }
  },
  "entities": {
    "Product": {
      "fields": {
        "image": {
          "type": "file",
          "upload": {
            "maxBytes": 5242880,
            "mimeTypes": ["image/*"],
            "directory": "products/images",
            "preserveExtension": true
          }
        },
        "attachments": {
          "type": "file",
          "many": true,
          "upload": {
            "maxBytes": 10485760,
            "mimeTypes": ["application/pdf", "text/plain"]
          }
        }
      }
    }
  }
}
~~~

Declaring any `type: "file"` field automatically enables the storage runtime. CRUD create/update routes accept `multipart/form-data`; authentication runs before multipart parsing, and MIME/size policies are enforced independently for each file field.

Persisted file metadata contains:

~~~json
{
  "key": "products/images/5be8...png",
  "originalName": "photo.png",
  "mimeType": "image/png",
  "size": 48123,
  "checksumSha256": "...",
  "provider": "local",
  "uploadedAt": "2026-10-08T12:00:00.000Z"
}
~~~

Signed URLs are added to responses at request time and are not persisted. This keeps credentials short-lived and allows the same metadata model to work with either provider.

Supported providers:

- **local** — safe paths under a configured storage root, HMAC-signed download URLs, Docker Compose named-volume persistence, traversal protection, and streamed downloads.
- **s3** — AWS S3 or S3-compatible endpoints using the AWS SDK, configurable bucket/region/endpoint/credentials, object deletion, and native pre-signed GET URLs.

Object lifecycle is automatic for generated CRUD operations:

- failed multipart requests clean up newly written objects
- replacing a file removes the previous object after the database mutation succeeds
- setting a single file field to `null` clears it and removes the old object
- setting a many-file field to `[]` clears all objects
- deleting/soft-deleting an entity removes its stored files
- metadata cannot be forged through ordinary JSON requests
- path traversal is rejected for generated local keys/directories

Entities with signed file URLs automatically disable list/get response caching so a cached response cannot contain an expired signed URL.

OpenAPI emits `multipart/form-data` schemas with binary file fields. Generated JavaScript/TypeScript SDKs transparently convert `Blob` inputs into `FormData`, and the generated admin UI renders file inputs with `multiple`, `accept`, MIME/size validation, and links to existing files.

GraphQL exposes file metadata in reads. File writes stay on the multipart REST surface; required file fields therefore suppress the corresponding GraphQL create mutation rather than accepting forgeable metadata.

For production multi-replica deployments, S3-compatible storage is the recommended provider. Local storage is appropriate for development and single-host/container deployments where the generated Compose volume is shared with the API container.

### Durable cleanup and orphan reconciliation

Storage-enabled generated apps now provision an outbox automatically, even when no user events or jobs are declared. Post-commit file replacements and deletes record a durable **storage** job before attempting physical deletion. Failed S3/local deletion is retried by the background worker with backoff, recovery of expired claims, and dead-letter state after eight attempts. Use a separate worker for multi-replica deployments.

```bash
npm run worker                 # long-running retry processor (if separate mode)
npm run worker:once            # one batch, useful for scheduled jobs
npm run storage:stats          # pending/processing/dead for storage-only queue
npm run storage:retry-dead     # retry only dead storage-cleanup jobs
npm run storage:reconcile      # read-only inventory, default age >= 24h
npm run storage:reconcile -- --execute --older-than-hours 48 --limit 25
```

Reconciliation checks actual object references across all configured file fields in MongoDB/PostgreSQL, lists only known storage prefixes and rejects traversal. It is **dry-run by default**; deletion requires explicit `--execute`, a minimum 24-hour age, and a maximum of 100 deletions per invocation. Scans are bounded (`--max-scan 5000` by default) and the output reports whether a scan was truncated. Always inspect the dry-run report, especially in multi-replica environments, before running deletion. The CLI scans records, so schedule it during low write activity to reduce race windows.

When observability metrics are enabled, `j2e_storage_cleanup_pending` and `j2e_storage_cleanup_dead` expose the backlog (using the configured metric prefix). Alert on a nonzero dead count and a growing pending queue.

**Consistency boundary:** object storage cannot participate in the database's ACID transaction. Cleanup intents are inserted **after** a successful mutation, so an abrupt crash precisely between the database commit and intent insertion is not guaranteed to be recovered by the outbox. Scheduled reconciliation provides a safety net. Outbox retry is at-least-once and file deletion is idempotent. Neither the reconciler nor the outbox offers a globally atomic snapshot of concurrent uploads; use the age threshold and an operator-reviewed dry run before destructive reconciliation.


## Declarative caching

Caching is opt-in and generated from the same JSON contract:

~~~json
{
  "cache": {
    "enabled": true,
    "provider": "redis",
    "defaultTtlSeconds": 300,
    "prefix": "j2e:",
    "varyByAuth": true,
    "redis": {
      "urlEnv": "REDIS_URL",
      "connectTimeoutMs": 5000
    }
  },
  "entities": {
    "Product": {
      "operations": {
        "list": {
          "cache": true
        },
        "get": {
          "cache": {
            "enabled": true,
            "ttlSeconds": 60,
            "varyByAuth": true
          }
        }
      }
    }
  }
}
~~~

Supported providers:

- `memory` — bounded in-process cache for single-process deployments
- `redis` — shared cache for workers, replicas, and distributed deployments

Only `list` and `get` operations can be cached. Cache keys include normalized route params, query parameters, the entity cache generation, and—by default—the authenticated user/strategy/roles so one user's representation cannot be served to another user.

Responses expose:

~~~text
X-Cache: MISS
X-Cache: HIT
~~~

Invalidation does not scan Redis keys. Each entity has a version counter; successful create/update/delete operations increment that generation, making existing entries unreachable until their TTL expires. Declarative workflow and background-job mutations trigger the same invalidation path.

Relation-aware invalidation also bumps caches for entities that reference the mutated entity. This prevents populated responses such as a cached Product containing an updated Category from remaining stale.

Redis failures are cache fail-open for reads/writes. The database remains the source of truth, while stale Redis entries remain bounded by their configured TTL.

Docker Compose automatically generates a `redis:7-alpine` cache service and wires `REDIS_URL=redis://cache:6379`. Kubernetes keeps Redis external and emits the configured Redis URL as a secret placeholder, which is better suited to managed production Redis.

The in-memory provider is intentionally rejected for generated topologies with a separate outbox worker or multiple Kubernetes replicas because invalidation cannot be shared across processes.

## Production observability and telemetry

Observability is opt-in and generated from the same JSON specification:

~~~json
{
  "observability": {
    "enabled": true,
    "logging": {
      "enabled": true,
      "level": "info",
      "format": "json",
      "requestIds": true
    },
    "metrics": {
      "enabled": true,
      "path": "/metrics",
      "collectDefaultMetrics": true,
      "prefix": "j2e_"
    },
    "tracing": {
      "enabled": true,
      "serviceName": "catalog-api",
      "exporter": "otlp-http",
      "endpointEnv": "OTEL_EXPORTER_OTLP_ENDPOINT",
      "sampleRate": 0.25
    },
    "health": {
      "liveness": {
        "enabled": true,
        "path": "/health/live"
      },
      "readiness": {
        "enabled": true,
        "path": "/health/ready",
        "database": true,
        "outbox": true
      }
    }
  }
}
~~~

### Structured logging and correlation IDs

The generated request middleware propagates an incoming `X-Request-Id` or creates a UUID, returns it in the response, and keeps it in an AsyncLocalStorage context for downstream logs.

Request-completion logs include bounded operational fields such as method, route, status, duration, request ID, authenticated user ID, and auth strategy. Generated observability intentionally does **not** log request bodies, Authorization headers, cookies, refresh tokens, API keys, or passwords.

JSON is the default production format; a human-readable pretty format is also available.

### Prometheus metrics

When metrics are enabled, the generated application exposes the configured metrics endpoint and emits low-cardinality metrics including:

~~~text
j2e_http_requests_total
j2e_http_request_duration_seconds
j2e_http_active_requests
j2e_graphql_operations_total
j2e_workflow_executions_total
j2e_workflow_duration_seconds
j2e_workflow_steps_total
j2e_worker_records_total
j2e_outbox_pending
j2e_outbox_dead
~~~

Default Node/process metrics can also be collected through prom-client. The metric prefix is configurable.

### Liveness and readiness

The legacy `app.health` endpoint remains supported for compatibility, while observability can generate separate operational probes:

- liveness answers whether the process is alive
- readiness verifies the database before returning ready
- MongoDB readiness uses an admin ping
- PostgreSQL readiness executes `SELECT 1`
- outbox status can expose pending/processing/dead counts without putting those values into high-cardinality metric labels

Docker and Compose healthchecks prefer the generated readiness endpoint. Kubernetes manifests emit distinct readiness and liveness probes when observability health is enabled.

### OpenTelemetry tracing

Tracing can use either a console exporter for development/testing or an OTLP/HTTP exporter for a collector such as OpenTelemetry Collector, Grafana Alloy, Datadog Agent, or another OTLP-compatible backend.

Generated spans cover:

- incoming HTTP requests
- GraphQL operations
- declarative workflow executions
- individual workflow steps
- outbox event/job worker execution

The service name and sampling rate are declarative. OTLP deployments receive the configured endpoint environment variable, and both API and standalone worker processes flush tracing on shutdown.

Observability dependencies are only added when the corresponding feature is enabled, so applications that do not opt in keep the existing lightweight runtime.

## Declarative custom endpoints and workflows

Beyond generated CRUD, v1 can expose custom application actions without embedding JavaScript in the JSON.

~~~json
{
  "endpoints": {
    "publishProduct": {
      "method": "post",
      "path": "/products/:id/publish",
      "workflow": "publishProduct",
      "status": 200
    }
  },
  "workflows": {
    "publishProduct": {
      "transaction": false,
      "steps": [
        {
          "name": "load",
          "action": "findById",
          "entity": "Product",
          "id": "$params.id"
        },
        {
          "name": "update",
          "action": "updateById",
          "entity": "Product",
          "id": "$params.id",
          "data": {
            "published": true
          }
        },
        {
          "name": "notify",
          "action": "emit",
          "event": "product.published",
          "payload": {
            "id": "$steps.update._id",
            "name": "$steps.update.name"
          }
        },
        {
          "name": "done",
          "action": "respond",
          "status": 200,
          "body": {
            "id": "$steps.update._id",
            "published": "$steps.update.published"
          }
        }
      ]
    }
  }
}
~~~

Supported workflow actions are:

- findById
- create
- updateById
- deleteById
- emit
- respond

Workflow values can safely reference request and prior-step data using:

- $body
- $params
- $query
- $auth
- $steps.<stepName>

For example, $steps.create._id reads the generated id from an earlier create step. Strings beginning with a literal dollar sign can be escaped as $value.

References to unavailable future steps, unknown entities, unknown events, and missing workflows are rejected during specification validation.

Set transaction to true to execute database steps inside the persistence target's transaction primitive. Event/job outbox records are written inside that same transaction, while actual delivery/execution happens asynchronously after commit.

### Events and webhooks

Events can have declarative webhook subscribers:

~~~json
{
  "events": {
    "product.published": {
      "webhooks": [
        {
          "urlEnv": "PRODUCT_PUBLISHED_WEBHOOK_URL",
          "method": "post",
          "failure": "fail",
          "headers": {
            "x-source": "catalog"
          }
        }
      ]
    }
  }
}
~~~

Webhook URLs are read from environment variables instead of being stored in the application spec. They are automatically included in the generated environment contract and .env.example.

failure can be fail or continue. fail propagates delivery failure through the workflow request; continue logs the delivery error and lets the request complete.

Custom endpoint auth uses the same multi-strategy/RBAC rules as CRUD and GraphQL operations. Custom endpoints are also included in generated OpenAPI and the generated project README.

## Durable outbox and background jobs

Events and jobs use a generated durable outbox so asynchronous work is persisted before a worker attempts delivery. MongoDB uses a Mongoose outbox model; PostgreSQL uses a Prisma-backed J2EOutbox table.

~~~json
{
  "outbox": {
    "worker": "embedded",
    "pollIntervalMs": 500,
    "batchSize": 20,
    "lockTimeoutMs": 30000,
    "maxAttempts": 5,
    "backoffMs": 1000
  }
}
~~~

Each outbox record moves through pending, processing, done, or dead states and stores attempts, next availability, lock time, and the last delivery error.

Failed work is retried with exponential backoff. Processing records whose lock is older than lockTimeoutMs are recovered to pending so a crashed worker does not permanently lose work.

After maxAttempts the record becomes dead. Generated projects expose:

~~~bash
npm run worker
npm run worker:once
npm run outbox:retry
~~~

outbox:retry resets dead records to pending so they can be replayed without editing MongoDB manually.

worker can be embedded, where the API process starts the outbox loop, or separate, where the API and worker run as independent processes. Separate mode is preferable when workers should scale independently.

### Reliable events

emit no longer delivers webhooks inline. It writes an event record to the outbox. In a transactional workflow, that outbox record is inserted inside the same database transaction as the business mutations—Mongoose sessions for MongoDB and prisma.$transaction for PostgreSQL.

The HTTP workflow can therefore succeed once the event is durably recorded even when the webhook destination is temporarily unavailable.

Webhook failure policy still controls delivery inside one attempt: continue logs a failed subscriber and continues; fail marks the outbox attempt as failed so the whole event is retried.

### Background jobs

Jobs map a durable queue item to an existing declarative workflow:

~~~json
{
  "jobs": {
    "repriceProduct": {
      "workflow": "repriceProduct",
      "queue": "products",
      "maxAttempts": 4,
      "backoffMs": 500
    }
  }
}
~~~

A workflow can enqueue it:

~~~json
{
  "name": "queueReprice",
  "action": "enqueue",
  "job": "repriceProduct",
  "payload": {
    "id": "$params.id",
    "price": "$body.price"
  },
  "delayMs": 1000
}
~~~

The request can return immediately while the worker later executes the job workflow. Job records support named queues, delayed availability, per-job retry limits, and per-job backoff overrides.

Processing is at-least-once. If a worker crashes after business side effects but before marking the job done, the lock eventually expires and the job may run again. Workflows used as job handlers should therefore be idempotent when duplicate execution would matter.

## Docker, Compose, and Kubernetes generation

Deployment artifacts are opt-in and derive from the same application specification.

~~~json
{
  "deployment": {
    "docker": {
      "enabled": true,
      "nodeImage": "node:22-alpine",
      "file": "Dockerfile",
      "ignoreFile": ".dockerignore",
      "healthcheck": true
    },
    "compose": {
      "enabled": true,
      "database": true,
      "apiPort": 8080
    },
    "kubernetes": {
      "enabled": true,
      "directory": "deploy/k8s",
      "image": "example/catalog-api:1.0.0",
      "replicas": 2,
      "serviceType": "ClusterIP",
      "servicePort": 80,
      "resources": {
        "requests": {
          "cpu": "100m",
          "memory": "128Mi"
        },
        "limits": {
          "cpu": "500m",
          "memory": "512Mi"
        }
      }
    }
  }
}
~~~

### Docker

The generated Dockerfile uses a multi-stage build, prunes development dependencies, runs as the non-root node user, exposes the configured application port, and emits a container HEALTHCHECK when the application health route is enabled.

For PostgreSQL/Prisma targets, the build stage also runs prisma generate before pruning the Prisma CLI.

The generated .dockerignore excludes local environment files, node_modules, Git metadata, logs, coverage, and generator temporary output while preserving .env.example.

### Docker Compose

Compose can include a local database service automatically:

- MongoDB target -> mongo:7
- PostgreSQL target -> postgres:16-alpine

The API receives an internal container-network database URL, waits for the database healthcheck, exposes the configured host port, and gets its runtime defaults from the normalized environment contract.

If Mongo outbox mode is separate, Compose also generates a worker service using the same image and npm run worker command.

~~~bash
docker compose up --build
~~~

Set compose.database to false when the generated application should connect to an externally managed database through its normal database environment variable.

### Kubernetes

Kubernetes generation emits:

~~~text
deploy/k8s/
  configmap.yaml
  secret.example.yaml
  deployment.yaml
  service.yaml
  worker-deployment.yaml   # only when a separate worker exists
~~~

ConfigMap contains non-secret defaults. Database URLs, JWT/API-key/OIDC secrets, webhook URLs, and required environment variables are represented only in secret.example.yaml with <set-me> placeholders.

The generated Deployment includes readiness/liveness probes when the health endpoint is enabled, non-root security settings, resource requests/limits, configurable replicas, and the configured container image.

The generator intentionally does not create a production MongoDB or PostgreSQL StatefulSet. Kubernetes deployments reference an external database URL through the Secret template so managed databases can be used without modifying generated application code.

## GraphQL API generation

REST and GraphQL can now be generated from the same normalized application model.

~~~json
{
  "api": {
    "rest": true,
    "graphql": {
      "enabled": true,
      "path": "/graphql"
    }
  }
}
~~~

REST remains enabled by default. Set rest to false for a GraphQL-only application.

The generated GraphQL schema includes:

- a backend-agnostic id: ID! for every entity
- get<Entity> queries
- list<Entities> queries
- typed filter inputs derived from each list operation's allowlist/operators
- sort and pagination arguments
- create<Entity>, update<Entity>, and delete<Entity> mutations
- scalar and reference fields
- many-to-many relation arrays
- custom workflow endpoints exposed as action<Name> GraphQL fields
- a JSON scalar for generic workflow params/query/body/results
- standard GraphQL introspection

GraphQL is not generated as a second persistence layer. Its CRUD resolvers invoke the same generated controllers used by REST and reuse the same validation/auth primitives. That keeps soft delete, hooks, transactions, relation delete policies, database errors, multi-strategy auth/RBAC, workflows, outbox events, and background jobs aligned.

Relations are resolved through DataLoader-backed entity caches. PostgreSQL many-to-many fields also get relation loaders so a GraphQL relation can resolve even when the corresponding REST operation did not request a Prisma include.

The GraphQL API intentionally exposes id instead of leaking MongoDB _id, while REST keeps its existing target-specific response shape.

## Generated JavaScript and TypeScript SDKs

The same normalized model that generates routes and OpenAPI can also generate a standalone client package.

~~~json
{
  "sdk": {
    "enabled": true,
    "outputDir": "sdk",
    "languages": ["javascript", "typescript"],
    "packageName": "@acme/catalog-client",
    "private": true,
    "baseUrl": "https://api.example.com",
    "includeCustomEndpoints": true
  }
}
~~~

Generated structure:

~~~text
sdk/
  package.json
  README.md
  javascript/
    index.js
  typescript/
    index.ts
  tsconfig.json
~~~

The JavaScript client has zero runtime dependencies and uses native fetch by default. A custom fetch implementation can be injected for tests or non-standard runtimes.

~~~js
const {createClient, ApiError} = require("./sdk/javascript");

const client = createClient({
  baseUrl: "https://api.example.com",
  getToken: async () => accessToken
});

const products = await client.products.list({
  price__gte: 100,
  sort: "-price",
  page: 1,
  limit: 20
});

const product = await client.products.create({
  name: "Keyboard",
  price: 149,
  category: categoryId
});
~~~

Authentication supports bearer token/getToken, API key/getApiKey, and browser cookie sessions through the fetch credentials option. Per-request headers and AbortSignal are supported on every generated method.

HTTP failures throw ApiError with:

- status
- parsed response body
- original Response

### TypeScript SDK

The TypeScript client includes:

- entity response interfaces
- create/update input types
- relation types
- Mongo _id or PostgreSQL id identifiers
- typed filter/operator query objects
- sorting, projection, and pagination parameters
- CRUD client interfaces
- typed custom action input objects
- strict declaration generation

~~~bash
cd sdk
npm install
npm run build
~~~

The resulting dist directory contains compiled CommonJS JavaScript and .d.ts declarations.

### Custom endpoint clients

Declarative workflow endpoints are generated under client.actions using their exact configured HTTP method and path.

For example:

~~~js
await client.actions.publishProduct({
  params: {id: productId},
  body: {notify: true}
});
~~~

Path parameters are encoded automatically. TypeScript requires the params object when the endpoint path contains parameters.

The SDK does not regenerate behavior independently from OpenAPI or routes: all three are emitted from the same normalized specification so custom CRUD paths, methods, API prefixes, filters, and entity relationships remain aligned.

## Generated admin UI

A complete standalone React/Vite admin application can be generated from the same entity and operation metadata.

~~~json
{
  "admin": {
    "enabled": true,
    "outputDir": "admin",
    "title": "Catalog Console",
    "baseUrl": "http://127.0.0.1:3000",
    "devPort": 5173,
    "includeCustomActions": true,
    "auth": {
      "tokenStorage": "sessionStorage",
      "tokenKey": "catalog-admin-token"
    },
    "theme": {
      "brandColor": "#2563eb",
      "mode": "system"
    },
    "entities": {
      "Product": {
        "label": "Product",
        "pluralLabel": "Products",
        "titleField": "name",
        "listFields": ["name", "price", "category", "published"],
        "filterFields": ["name", "price"],
        "pageSize": 20,
        "readonlyFields": ["published"],
        "fields": {
          "name": {
            "label": "Product name",
            "placeholder": "Mechanical keyboard"
          },
          "category": {
            "label": "Category",
            "widget": "reference"
          }
        }
      }
    }
  }
}
~~~

When per-entity configuration is omitted, the admin derives sensible defaults from the normalized entity definition, CRUD capabilities, list query contract, field constraints, references, and database target.

Generated structure:

~~~text
admin/
  package.json
  vite.config.js
  index.html
  README.md
  src/
    App.jsx
    api.js
    config.js
    main.jsx
    styles.css
~~~

The generated UI includes:

- responsive dashboard and resource navigation
- CRUD tables and forms
- configurable columns and labels
- allowlisted filters
- sorting and bounded pagination
- required/min/max/minLength/maxLength/enum client validation
- text, textarea, number, boolean, date/datetime, enum and relation controls
- relation selectors populated from referenced resources
- populated-reference display labels
- create/edit/delete capability awareness
- delete confirmation
- structured API errors and notifications
- local email/password login when generated local auth is enabled
- API-key login when enabled
- bearer JWT/OIDC token entry
- cookie-session requests with credentials included
- OIDC SSO redirect when enabled
- localStorage or sessionStorage credential persistence
- row-bound custom workflow actions
- global custom workflow actions
- JSON body/query editor for generic actions
- light, dark, or system theme with configurable brand color

### Development

~~~bash
cd admin
npm install
npm run dev
~~~

The generated Vite development server automatically proxies the application's API prefix to admin.baseUrl. This means the default development workflow does not require enabling CORS just because the admin runs on another local port.

### Production

~~~bash
npm run build
~~~

dist is a static SPA. Set VITE_API_BASE_URL at build time when the deployed API URL differs from admin.baseUrl. If the admin and API are served from different origins, configure the generated backend CORS policy accordingly.

The admin does not depend on sdk.enabled. Its small ESM API runtime is generated independently from the same normalized routes, methods, identifiers, query semantics, and custom endpoints.

## Verification

Unit/integration tests cover:

- default normalization
- strict unknown-key rejection
- semantic cross-field validation
- configurable project layout and imports
- runtime/server/middleware customization
- CRUD method/path/status customization
- filtering, sorting, projection, pagination, and allowlisted operators
- reference relationships, populate behavior, delete policies, and indexes
- JWT, API-key, durable session, local login/refresh/reset, OIDC, and RBAC generation
- generated request validation and OpenAPI
- soft delete, auditing, and transaction generation
- custom endpoints, declarative workflows, events, and webhooks
- durable outbox, retries, dead-letter recovery, and background jobs
- Docker, Docker Compose, Kubernetes manifests, probes, secrets/config separation
- generated JavaScript and TypeScript SDK packages
- generated React admin UI, forms, relations, filters and custom actions
- production middleware and environment guards
- structured logging, correlation IDs, Prometheus metrics, liveness/readiness, and OpenTelemetry generation
- declarative memory/Redis caching, auth-aware cache keys, entity-version invalidation, and workflow/job cache coherence
- custom middleware and hooks
- Mongoose field/schema options
- safe regeneration
- conflict detection
- preservation of custom files
- stale generated-file removal
- syntax validation of every emitted JavaScript file

CI runs the generator suite on Node.js 18, 20, and 22.

A MongoDB generated-app-e2e job performs:

~~~text
JSON spec
  -> generate fresh application
  -> npm install in generated application
  -> start MongoDB
  -> start generated Express server
  -> create related resources
  -> POST resource with a reference
  -> verify delete restrict policy
  -> GET list with populate + advanced filters + pagination
  -> GET by id with populate
  -> PATCH
  -> soft DELETE
  -> verify 404 after soft delete
  -> delete formerly restricted parent
  -> verify generated OpenAPI
~~~

A second generated-app-postgres-e2e job independently performs:

~~~text
PostgreSQL JSON spec
  -> generate fresh Prisma application
  -> npm install
  -> prisma db push against Postgres 16
  -> generated contract tests
  -> start generated Express server
  -> create related Category/Product rows
  -> verify FK Restrict
  -> GET list with relation include + filters + pagination
  -> GET by UUID
  -> PATCH through Prisma transaction
  -> soft DELETE
  -> reject invalid UUID
  -> verify UUID OpenAPI contract
~~~

Together these holdouts prove that both persistence targets produce runnable applications, not only syntactically valid output.

## Safety boundary

The JSON is declarative. It does not execute arbitrary source embedded in the specification.

Executable customization goes through explicit references to developer-owned modules. Destructive directory adoption is not exposed through JSON or force.

## Development

~~~bash
npm test
npm run check
node bin/json-to-express.js validate examples/shop.json
node bin/json-to-express.js validate examples/e2e.json
node bin/json-to-express.js validate examples/e2e-postgres.json
~~~

## Scope after v1

The Express/Mongoose target remains the complete v1 target, including workflows, durable outbox, and background jobs.

PostgreSQL/Prisma is now a full application target for CRUD, declarative workflows, custom endpoints, durable events/outbox, background jobs, SDKs, admin UI, and deployment generation. Its main remaining persistence work is deeper ORM-specific tuning rather than a missing core relation capability.

Both persistence targets can now emit container/Kubernetes deployment artifacts, standalone JavaScript/TypeScript SDK packages, and a complete generated admin UI from the same JSON contract.

File uploads and object storage are implemented. PostgreSQL projects now generate a declarative scalar seed runner and Prisma migration commands. The Prisma CLI creates versioned SQL migrations against a development database; the generator does not commit or invent migration snapshots. Deterministic scalar factories are supported; relational factories and production-grade migration snapshots remain future work. Fastify-native generation now includes qualifying PostgreSQL and MongoDB CRUD, transaction-aware PostgreSQL and MongoDB recursive `restrict`/`nullify`/`cascade` deletion (including many-to-many and multilevel cascades), Mongo replica-set transactions, audit/soft-delete hooks, JWT/API-key/local/OIDC authentication, GraphQL/workflows, Redis caching, local/S3 multipart uploads, signed URLs, observability, embedded outbox workers, rate limiting and compression. The OIDC integration suite runs a local provider with JWKS signing, PKCE validation, token exchange and replay checks. Advanced Fastify integration tests cover real PostgreSQL, MongoDB, S3-compatible storage, and Redis.

Fastify custom middleware **must** use native lifecycle hooks. List developer-owned modules under `app.middlewareModules`; no additional opt-in is required. Each module must export at least one of `fastifyOnRequest(request, reply)`, `fastifyPreValidation(request, reply)`, `fastifyPreHandler(request, reply)`, `fastifyPreSerialization(request, reply, payload)`, `fastifyOnSend(request, reply, payload)`, `fastifyOnError(request, reply, error)`, or `fastifyOnResponse(request, reply)`. Both synchronous and asynchronous hooks are supported.

**Migration from Express:** Replace `module.exports = (req, res, next) => { ...; next(); }` with `module.exports = {fastifyOnRequest(request, reply) { /* use request.headers, reply.header(...) */ }}`. Native request properties live on `request`; use `reply.code(...).send(...)` to end a response. Do not call `next()` in an async native hook. The generated app fails at startup with a descriptive error if a module exports only Express middleware. If any entity in the same Fastify specification cannot use native CRUD, generation fails rather than silently running custom middleware in an Express fallback. Express framework applications continue to support Express middleware.

Fastify never generates `@fastify/express` or an Express fallback. Invalid population paths and unsupported configurations fail generation rather than dropping behavior silently. Custom middleware must use native lifecycle exports. Storage cleanup and cyclic/concurrent relationship failure tests are part of the parity verification; see issue #18.

## License

MIT
