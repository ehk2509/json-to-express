# json-to-express

Generate a runnable Express application from a declarative JSON specification.

The project is JSON-first: runtime behavior, project layout, routes, persistence target, query behavior, middleware, hooks, package metadata, and server settings are described in JSON.

Two persistence targets now share the same normalized application model:

- MongoDB + Mongoose — full v1 target, including workflows/outbox/jobs
- PostgreSQL + Prisma — CRUD/relations/query/auth/OpenAPI target with a dedicated real-Postgres E2E

## What is generated

- Express app and server bootstrap
- MongoDB/Mongoose or PostgreSQL/Prisma connection
- Mongoose models or Prisma schema/client
- CRUD controllers and routers
- configurable query semantics
- configurable error handling and health endpoint
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

### Current PostgreSQL boundary

The PostgreSQL target intentionally rejects features whose runtime is still Mongo-specific instead of emitting partially valid code:

- declarative workflows/custom workflow endpoints
- events and durable outbox
- background jobs
- many-reference relations
- Mongoose schemaOptions and field options

These are target-expansion gaps, not silent fallbacks. The validator reports them before generation.

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

Set "many": true for arrays of references. Supported delete policies are restrict, nullify, and cascade. Operations can declare populate fields so generated Mongoose queries resolve references automatically.

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

JWT authentication is generated from JSON:

~~~json
{
  "auth": {
    "enabled": true,
    "strategy": "jwt",
    "secretEnv": "JWT_SECRET",
    "algorithms": ["HS256"],
    "userClaim": "sub",
    "rolesClaim": "roles"
  }
}
~~~

Each operation can be public, authenticated, or role protected:

~~~json
{
  "operations": {
    "delete": {
      "auth": {
        "required": true,
        "roles": ["admin"]
      }
    }
  }
}
~~~

The generated router wires authentication and authorization before controller execution.

### Request validation

Generated request middleware validates create/update payload types, required fields, reference ObjectIds, and resource identifiers before database access.

This gives the generated API an HTTP validation boundary in addition to Mongoose persistence validation.

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

Entity schemas, paths, request bodies, path/query parameters, status codes, and JWT security requirements therefore derive from the same IR as the runtime application.

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

The controller generator wraps the operation in a transaction while keeping transactions disabled by default for deployments that do not use a Mongo replica set.

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

Database and JWT-secret variables are automatically included in the generated environment guard.

### Production middleware

The production block can enable request IDs, security headers, CORS, rate limiting, and compression. Optional package dependencies are added only when required.

Generated servers also handle SIGTERM and SIGINT with graceful HTTP shutdown and MongoDB disconnect.

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

Set transaction to true to execute database steps inside a MongoDB transaction. Event delivery is deferred until the workflow has completed successfully and, when applicable, the transaction has committed.

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

Custom endpoint auth uses the same JWT/RBAC rules as CRUD operations. Custom endpoints are also included in generated OpenAPI and the generated project README.

## Durable outbox and background jobs

Events and jobs use a generated MongoDB outbox so asynchronous work is persisted before a worker attempts delivery.

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

emit no longer delivers webhooks inline. It writes an event record to the outbox. In a transactional workflow, that outbox record is inserted inside the same MongoDB transaction as the business mutations.

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

ConfigMap contains non-secret defaults. Database URLs, JWT secrets, webhook URLs, and required environment variables are represented only in secret.example.yaml with <set-me> placeholders.

The generated Deployment includes readiness/liveness probes when the health endpoint is enabled, non-root security settings, resource requests/limits, configurable replicas, and the configured container image.

The generator intentionally does not create a production MongoDB or PostgreSQL StatefulSet. Kubernetes deployments reference an external database URL through the Secret template so managed databases can be used without modifying generated application code.

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
- JWT authentication and role authorization generation
- generated request validation and OpenAPI
- soft delete, auditing, and transaction generation
- custom endpoints, declarative workflows, events, and webhooks
- durable outbox, retries, dead-letter recovery, and background jobs
- Docker, Docker Compose, Kubernetes manifests, probes, secrets/config separation
- production middleware and environment guards
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

PostgreSQL/Prisma is now a real second target for CRUD-oriented services and proves that the normalized application model is not tied to Mongoose. Its remaining parity work is the SQL implementation of workflows/outbox/jobs and many-to-many references.

Both persistence targets can now emit container and Kubernetes deployment artifacts from the same JSON contract.

The next product-expansion layers are generated SDK clients and an optional admin UI, followed by additional API/server targets such as GraphQL, Fastify, and NestJS.

## License

MIT
