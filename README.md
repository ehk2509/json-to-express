# json-to-express

Describe an Express backend in JSON and generate a runnable REST API.

The first prototype turns one declarative JSON file into an Express + MongoDB application with Mongoose models, CRUD controllers, routes, error handling, environment configuration and a generated health-check test.

## Status

This repository is an early v0.1 prototype. The supported target is intentionally narrow:

- Node.js 18+
- Express
- MongoDB + Mongoose
- JSON-defined entities and fields
- Generated CRUD endpoints
- Field constraints: required, unique, enum, min/max, minLength/maxLength and default
- Generated environment template and smoke test

Authentication, relationships, OpenAPI, PostgreSQL and custom-code extension points are future work.

## Quick start

Clone the repository, then run:

~~~bash
node bin/json-to-express.js validate examples/shop.json
node bin/json-to-express.js generate examples/shop.json
~~~

The application is generated under generated/shop-api by default.

Run the generated application:

~~~bash
cd generated/shop-api
npm install
cp .env.example .env
npm start
~~~

By default the sample expects MongoDB at mongodb://127.0.0.1:27017/shop-api and listens on port 3000.

## CLI

~~~text
j2e validate <spec.json>
j2e generate <spec.json> [--output <dir>] [--force]
~~~

Use --output to choose a target directory. json-to-express refuses to overwrite a non-empty directory unless --force is provided.

When installed as an npm package, both json-to-express and j2e are exposed as commands.

## Application specification

Example:

~~~json
{
  "app": {
    "name": "shop-api",
    "port": 3000
  },
  "database": {
    "type": "mongodb",
    "uriEnv": "MONGODB_URI"
  },
  "entities": {
    "Product": {
      "fields": {
        "name": {
          "type": "string",
          "required": true,
          "minLength": 2
        },
        "price": {
          "type": "number",
          "required": true,
          "min": 0
        },
        "status": {
          "type": "string",
          "enum": ["draft", "active", "archived"],
          "default": "draft"
        }
      }
    }
  }
}
~~~

Supported field types in v0.1 are string, number, boolean and date.

Entity names must use PascalCase. Routes are generated automatically, so Product becomes /api/products and Category becomes /api/categories. A custom lowercase route can also be supplied with the entity route property.

## Generated structure

~~~text
generated/shop-api/
├── .env.example
├── package.json
├── README.md
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   └── database.js
│   ├── middleware/
│   │   └── error-handler.js
│   ├── models/
│   ├── controllers/
│   └── routes/
└── test/
    └── health.test.js
~~~

For each entity, json-to-express generates:

~~~text
GET    /api/<entities>
GET    /api/<entities>/:id
POST   /api/<entities>
PATCH  /api/<entities>/:id
DELETE /api/<entities>/:id
~~~

## Architecture

The generator deliberately separates validation and normalization from code generation:

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

That normalized application model is the seam for future output targets and features without coupling the input format directly to templates.

## Development

The generator has no runtime dependencies.

~~~bash
npm test
npm run check
~~~

CI exercises the project on Node.js 18, 20 and 22.

## Roadmap

The next useful layers are entity relationships, request validation independent of Mongoose, JWT authentication/RBAC, generated OpenAPI documentation, PostgreSQL support, and protected custom-code extension points so regeneration never destroys developer-owned code.

## License

MIT
