'use strict';

// Adapter-free mode is intentionally narrow. Widen only with integration coverage.
function isDirectFastify(spec) {
  return spec.app.framework === 'fastify' &&
    !spec.storage.enabled && !spec.observability.enabled &&
    !spec.outbox.enabled &&
    !spec.app.middlewareModules.length &&
    !spec.app.production.rateLimit.enabled && !spec.app.production.compression &&
    spec.entities.every(entity =>
      !entity.hooks && !entity.audit.enabled && !entity.softDelete.enabled &&
      entity.fields.every(field => field.type !== 'reference' && field.type !== 'file')
    );
}

module.exports = isDirectFastify;
