# json-to-express

Generate a runnable Express application from a declarative JSON specification.

The v0.1 prototype is JSON-first: runtime behavior, project layout, routes, Mongo/Mongoose options, query behavior, middleware, hooks, package metadata, and server settings are described in JSON.

## What is generated

- Express app and server bootstrap
- MongoDB/Mongoose connection
- Mongoose models
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

## Verification

Unit/integration tests cover:

- default normalization
- strict unknown-key rejection
- semantic cross-field validation
- configurable project layout and imports
- runtime/server/middleware customization
- CRUD method/path/status customization
- filtering, sorting, projection, and pagination generation
- custom middleware and hooks
- Mongoose field/schema options
- safe regeneration
- conflict detection
- preservation of custom files
- stale generated-file removal
- syntax validation of every emitted JavaScript file

CI runs this suite on Node.js 18, 20, and 22.

A separate generated-app-e2e job performs:

~~~text
JSON spec
  -> generate fresh application
  -> npm install in generated application
  -> start MongoDB
  -> start generated Express server
  -> POST resource
  -> GET list with filters/sort/select/pagination
  -> GET by id
  -> PATCH
  -> DELETE
  -> verify 404 after delete
~~~

This proves that the generated project itself runs end to end.

## Safety boundary

The JSON is declarative. It does not execute arbitrary source embedded in the specification.

Executable customization goes through explicit references to developer-owned modules. Destructive directory adoption is not exposed through JSON or force.

## Development

~~~bash
npm test
npm run check
node bin/json-to-express.js validate examples/shop.json
node bin/json-to-express.js validate examples/e2e.json
~~~

## Next product capabilities

The first-prototype platform gaps are now addressed by schema-first validation, modular generators, safe regeneration, query semantics, extension points, and generated-app E2E testing.

The next layers are product features:

- entity relationships and references
- authentication and RBAC
- OpenAPI generation
- additional database/ORM targets
- additional server framework targets

## License

MIT
