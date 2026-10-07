# json-to-express

Describe an Express backend in JSON and generate a runnable REST API.

The v0.1 prototype is built around one rule: **application behavior belongs in the JSON specification, not in generator source code**. Defaults make small specs convenient, while explicit configuration can override every behavior currently exposed by the prototype.

## What is generated

From one JSON file, json-to-express generates:

- Express application and server bootstrap
- MongoDB/Mongoose connection
- Mongoose schemas/models
- CRUD controllers
- per-entity routers
- configurable health endpoint
- centralized error handling
- .env.example
- package.json
- generated endpoint documentation
- health smoke test when health checks are enabled

## Quick start

~~~bash
node bin/json-to-express.js validate examples/shop.json
node bin/json-to-express.js generate examples/shop.json
~~~

The sample uses its own generation.outputDir. A CLI --output value overrides the JSON destination:

~~~bash
node bin/json-to-express.js generate examples/shop.json --output /tmp/shop-api
~~~

Then:

~~~bash
cd generated/shop-api
npm install
cp .env.example .env
npm start
~~~

## JSON is the source of truth

The application can be customized at each layer.

### Generation

~~~json
{
  "generation": {
    "outputDir": "generated/my-service"
  }
}
~~~

--output can override this at invocation time. --force intentionally remains a CLI-only safety switch so a checked-in JSON file cannot silently authorize destructive overwrites.

### Application and API

~~~json
{
  "app": {
    "name": "catalog-service",
    "port": 8080,
    "portEnv": "HTTP_PORT",
    "apiPrefix": "/api/v2",
    "bodyLimit": "5mb"
  }
}
~~~

### Health endpoint

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

Set enabled to false and neither the route nor its generated smoke test is emitted.

### Error responses and status codes

~~~json
{
  "app": {
    "responses": {
      "notFound": "No route matched",
      "validationError": "Payload rejected",
      "invalidIdentifier": "Invalid resource id",
      "uniqueConstraint": "Already exists",
      "internalError": "Service unavailable"
    },
    "statusCodes": {
      "notFound": 404,
      "validationError": 422,
      "invalidIdentifier": 400,
      "uniqueConstraint": 409,
      "internalError": 503
    }
  }
}
~~~

### Generated package.json

~~~json
{
  "app": {
    "package": {
      "name": "catalog-service",
      "version": "1.2.0",
      "private": true,
      "description": "Catalog API",
      "nodeEngine": ">=20",
      "scripts": {
        "lint": "node --check src/app.js"
      },
      "dependencies": {
        "express": "^5.1.0"
      },
      "devDependencies": {}
    }
  }
}
~~~

Custom scripts and dependencies are merged with the defaults required by the generated application. Explicit dependency versions override the defaults.

### MongoDB

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

database.options is passed directly to mongoose.connect, which keeps Mongo/Mongoose connection tuning extensible without generator changes.

### Entities and Mongoose schema options

~~~json
{
  "entities": {
    "Product": {
      "route": "catalog",
      "collection": "catalog_items",
      "idParam": "productId",
      "schemaOptions": {
        "timestamps": false,
        "versionKey": "revision",
        "strict": "throw"
      }
    }
  }
}
~~~

schemaOptions is forwarded to mongoose.Schema. collection is a convenience override for the backing collection.

### CRUD endpoints

Every CRUD operation can be enabled/disabled independently and can override its HTTP method, relative path and status codes.

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
          "lean": true
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

Defaults remain conventional GET/POST/PATCH/DELETE CRUD routes, so these blocks can be omitted when no override is needed.

### Fields

First-class field properties currently include:

- type: string, number, boolean, date
- required
- unique
- enum
- min / max
- minLength / maxLength
- default

The options object is an extensibility escape hatch for additional JSON-serializable Mongoose schema-type options:

~~~json
{
  "name": {
    "type": "string",
    "required": true,
    "options": {
      "trim": true,
      "lowercase": true,
      "index": true,
      "select": false
    }
  }
}
~~~

First-class properties override the same option supplied inside options.

## Defaults

A minimal entity still works:

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

It defaults to port 3000, PORT, /api, /health, MONGODB_URI, timestamps enabled, versionKey disabled, and standard CRUD methods/routes.

## CLI

~~~text
j2e validate <spec.json>
j2e generate <spec.json> [--output <dir>] [--force]
~~~

The generator refuses to overwrite a non-empty directory unless --force is explicitly passed.

## Architecture

~~~text
JSON specification
       |
       v
validation
       |
       v
normalized application model
       |
       v
file generators
       |
       v
runnable Express application
~~~

The normalization layer is deliberate: defaults and compatibility live there, while templates only consume a complete application model.

## Customization boundary

"Everything customizable" in v0.1 means **everything the v0.1 generator knows how to generate is controlled by JSON**. It does not mean embedding arbitrary JavaScript strings inside JSON.

Business-specific logic, arbitrary middleware code, custom validators implemented as functions, authentication flows and cross-entity relationships require explicit declarative features. Those are safer future extensions than executing raw code from a specification.

## Development

The generator itself has no runtime dependencies.

~~~bash
npm test
npm run check
~~~

CI runs on Node.js 18, 20 and 22.

## Roadmap

Next layers:

1. entity relationships and references
2. declarative request/query validation
3. authentication and RBAC
4. generated OpenAPI
5. hooks/custom extension modules that survive regeneration
6. PostgreSQL/Prisma target

## License

MIT
