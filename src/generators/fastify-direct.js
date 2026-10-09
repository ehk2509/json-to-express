'use strict';

const nativeCrudSource = require('./fastify-crud');

// Fastify middleware uses native lifecycle exports only. The compatibility
// adapter is never selected merely because custom middleware is configured.
// Unsupported CRUD + middleware combinations are rejected during generation.
function isDirectFastify(spec) {
  return spec.app.framework === 'fastify' &&
    (!spec.api.rest || spec.entities.every(entity => nativeCrudSource.eligible(entity, spec)));
}

module.exports = isDirectFastify;
