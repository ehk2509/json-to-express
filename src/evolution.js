'use strict';

const crypto = require('node:crypto');

const hashValue = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sortedKeys = value => Object.keys(value || {}).sort();

function schemaSnapshot(spec) {
  const entities = {};
  for (const entity of spec.entities) {
    const fields = {};
    for (const field of entity.fields) {
      fields[field.name] = {
        type: field.type,
        required: Boolean(field.required),
        unique: Boolean(field.unique),
        ref: field.ref || null,
        many: Boolean(field.many),
        onDelete: field.onDelete || null,
        hasDefault: field.default !== undefined,
        defaultFingerprint: field.default === undefined ? null : hashValue(field.default),
        enumFingerprint: field.enum ? hashValue(field.enum) : null,
        constraintsFingerprint: hashValue({min: field.min, max: field.max,
          minLength: field.minLength, maxLength: field.maxLength}),
        uploadFingerprint: field.type === 'file' ? hashValue(field.upload) : null
      };
    }
    entities[entity.name] = {
      route: entity.route,
      collection: entity.collection || null,
      softDelete: Boolean(entity.softDelete.enabled),
      indexesFingerprint: hashValue(entity.indexes),
      fields
    };
  }
  // Deliberately exclude auth settings, secrets, env values, and seed contents.
  return {
    version: 1,
    database: spec.database.type,
    idStrategy: spec.database.idStrategy || null,
    framework: spec.app.framework,
    storageProvider: spec.storage && spec.storage.enabled ? spec.storage.provider : null,
    entities
  };
}

function compareSnapshots(previous, next) {
  const changes = [];
  const add = (severity, code, at, message) => changes.push({severity, code, path: at, message});
  if (!previous) {
    add('unknown', 'no-history', 'schema', 'No prior schema snapshot; database changes cannot be classified automatically');
    return changes;
  }
  if (previous.version !== 1 || !previous.entities) {
    add('unknown', 'incompatible-history', 'schema', 'Schema snapshot format is not supported');
    return changes;
  }
  for (const [key, severity] of [
    ['database', 'breaking'], ['idStrategy', 'breaking'],
    ['framework', 'review'], ['storageProvider', 'review']
  ]) {
    if (previous[key] !== next[key]) add(severity, key + '-changed', key, key + ' changed');
  }
  for (const name of sortedKeys(previous.entities)) {
    if (!next.entities[name]) {
      add('breaking', 'entity-removed', 'entities.' + name, 'Removing an entity may drop stored data');
      continue;
    }
    const before = previous.entities[name];
    const after = next.entities[name];
    const prefix = 'entities.' + name;
    if (before.collection !== after.collection) {
      add('breaking', 'collection-changed', prefix + '.collection', 'Collection or table mapping changed');
    }
    if (before.route !== after.route) add('review', 'route-changed', prefix + '.route', 'HTTP route contract changed');
    if (before.softDelete !== after.softDelete) {
      add('review', 'soft-delete-changed', prefix + '.softDelete', 'Soft-delete behavior changed');
    }
    if (before.indexesFingerprint !== after.indexesFingerprint) {
      add('review', 'indexes-changed', prefix + '.indexes', 'Indexes changed; review database index migration');
    }
    for (const fieldName of sortedKeys(before.fields)) {
      const oldField = before.fields[fieldName];
      const newField = after.fields[fieldName];
      const at = prefix + '.fields.' + fieldName;
      if (!newField) {
        add('breaking', 'field-removed', at, 'Removing a field can discard stored data');
        continue;
      }
      for (const key of ['type', 'ref', 'many', 'onDelete']) {
        if (oldField[key] !== newField[key]) add('breaking', 'field-' + key + '-changed', at, 'Field ' + key + ' changed');
      }
      if (!oldField.required && newField.required) add('breaking', 'field-required', at, 'New requirement may invalidate existing rows');
      if (oldField.unique !== newField.unique) {
        add(newField.unique ? 'breaking' : 'review', 'field-unique', at, 'Uniqueness constraint changed');
      }
      if (oldField.enumFingerprint !== newField.enumFingerprint) {
        add('review', 'field-enum', at, 'Enum constraint changed; verify existing values');
      }
      if (oldField.defaultFingerprint !== newField.defaultFingerprint) {
        add('review', 'field-default', at, 'Default value or behavior changed');
      }
      if (oldField.constraintsFingerprint !== newField.constraintsFingerprint) {
        add('review', 'field-constraints', at, 'Validation constraints changed; review existing data');
      }
      if (oldField.uploadFingerprint !== newField.uploadFingerprint) {
        add('review', 'file-upload-policy', at, 'File upload policy changed');
      }
    }
    for (const fieldName of sortedKeys(after.fields)) {
      if (before.fields[fieldName]) continue;
      const field = after.fields[fieldName];
      add(field.required ? 'breaking' : 'safe',
        'field-added', prefix + '.fields.' + fieldName,
        field.required ? 'Required field added; existing records may need backfill' : 'Optional field added');
    }
  }
  for (const name of sortedKeys(next.entities)) {
    if (!previous.entities[name]) add('safe', 'entity-added', 'entities.' + name, 'New entity added');
  }
  return changes;
}

function policyErrors(changes, options = {}) {
  const errors = [];
  if (changes.some(change => change.severity === 'unknown') && !options.allowUnknownSchema) {
    errors.push('Schema history is unknown; use --allow-unknown-schema after reviewing the database');
  }
  if (changes.some(change => change.severity === 'breaking') && !options.allowDestructive) {
    errors.push('Breaking schema changes require --allow-destructive after preparing database migration/backup');
  }
  if (changes.some(change => change.severity === 'review') && !options.approveSchema) {
    errors.push('Schema changes need review; use --approve-schema after reviewing their impact');
  }
  return errors;
}

module.exports = {schemaSnapshot, compareSnapshots, policyErrors};
