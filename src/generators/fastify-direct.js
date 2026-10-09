'use strict';

const nativeCrudSource = require('./fastify-crud');

// Express is unnecessary when every generated HTTP route has a native target.
// Keep compatibility for external middleware, OIDC provider flows and
// production facilities that still need explicit runtime parity tests.
function isDirectFastify(spec) {
  return spec.app.framework === 'fastify' &&
    !spec.auth.oidc.enabled &&
    !spec.observability.enabled &&
    !spec.outbox.enabled &&
    !spec.app.middlewareModules.length &&
    !spec.app.production.rateLimit.enabled && !spec.app.production.compression &&
    spec.entities.every(entity => nativeCrudSource.eligible(entity, spec));
}

module.exports = isDirectFastify;
