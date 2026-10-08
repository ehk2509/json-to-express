'use strict';

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function prismaType(field) {
  return {string: 'String', number: 'Float', boolean: 'Boolean', date: 'DateTime', file: 'Json'}[field.type];
}

function defaultAttribute(field) {
  if (field.default === undefined) return '';
  if (field.type === 'date' && field.default === 'now') return ' @default(now())';
  if (['string','number','boolean'].includes(field.type)) return ' @default(' + JSON.stringify(field.default) + ')';
  return '';
}

function relationName(source, field) {
  return source.name + '_' + field.name;
}

function scalarField(field) {
  const optional = field.required ? '' : '?';
  const unique = field.unique ? ' @unique' : '';
  return '  ' + field.name + ' ' + prismaType(field) + optional + unique + defaultAttribute(field);
}

function referenceFields(entity, field) {
  const relation = relationName(entity, field);
  if (field.many) {
    return ['  ' + field.name + ' ' + field.ref + '[] @relation("' + relation + '")'];
  }
  const optional = field.required ? '' : '?';
  const unique = field.unique ? ' @unique' : '';
  const onDelete = {restrict: 'Restrict', nullify: 'SetNull', cascade: 'Cascade'}[field.onDelete];
  return [
    '  ' + field.name + 'Id String' + optional + unique,
    '  ' + field.name + ' ' + field.ref + optional + ' @relation("' + relation + '", fields: [' + field.name + 'Id], references: [id], onDelete: ' + onDelete + ')'
  ];
}

function inverseRelations(target, entities) {
  const lines = [];
  for (const source of entities) {
    for (const field of source.fields) {
      if (field.type !== 'reference' || field.ref !== target.name) continue;
      const relation = relationName(source, field);
      lines.push('  ' + source.name + '_' + field.name + ' ' + source.name + '[] @relation("' + relation + '")');
    }
  }
  return lines;
}

function indexField(entity, name, direction) {
  const field = entity.fields.find(item => item.name === name);
  const actual = field && field.type === 'reference' && !field.many ? name + 'Id' : name;
  return direction < 0 ? actual + '(sort: Desc)' : actual;
}

module.exports = function prismaSchemaSource(spec) {
  const lines = [
    'generator client {',
    '  provider = "prisma-client-js"',
    '}', '',
    'datasource db {',
    '  provider = "postgresql"',
    '  url      = env("' + spec.database.uriEnv + '")',
    '}', ''
  ];

  if (spec.auth.storeEnabled) {
    lines.push(
      'model J2EAuthUser {',
      '  id String @id @default(uuid())',
      '  email String @unique',
      '  passwordHash String',
      '  roles Json',
      '  createdAt DateTime @default(now())',
      '  updatedAt DateTime @updatedAt',
      '  @@map("_j2e_auth_users")',
      '}', '',
      'model J2EAuthToken {',
      '  id String @id @default(uuid())',
      '  kind String',
      '  tokenHash String @unique',
      '  userId String',
      '  roles Json',
      '  expiresAt DateTime',
      '  revokedAt DateTime?',
      '  metadata Json?',
      '  createdAt DateTime @default(now())',
      '  @@index([kind])',
      '  @@index([userId])',
      '  @@index([expiresAt])',
      '  @@index([kind, userId, revokedAt])',
      '  @@map("_j2e_auth_tokens")',
      '}', ''
    );
  }

  if (spec.outbox.enabled) {
    lines.push(
      'model J2EOutbox {',
      '  id String @id @default(uuid())',
      '  kind String',
      '  name String',
      '  queue String @default("default")',
      '  payload Json?',
      '  status String @default("pending")',
      '  attempts Int @default(0)',
      '  maxAttempts Int',
      '  backoffMs Int',
      '  availableAt DateTime @default(now())',
      '  lockedAt DateTime?',
      '  lastError String?',
      '  createdAt DateTime @default(now())',
      '  updatedAt DateTime @updatedAt',
      '  @@index([kind])',
      '  @@index([name])',
      '  @@index([queue])',
      '  @@index([status])',
      '  @@index([availableAt])',
      '  @@index([status, availableAt, queue])',
      '  @@map("_j2e_outbox")',
      '}', ''
    );
  }

  for (const entity of spec.entities) {
    lines.push('model ' + entity.name + ' {');
    lines.push('  id String @id @default(uuid())');

    for (const field of entity.fields) {
      if (field.type === 'reference') lines.push(...referenceFields(entity, field));
      else lines.push(scalarField(field));
    }

    if (entity.schemaOptions.timestamps !== false) {
      lines.push('  createdAt DateTime @default(now())');
      lines.push('  updatedAt DateTime @updatedAt');
    }
    if (entity.softDelete.enabled) lines.push('  ' + entity.softDelete.field + ' DateTime?');
    if (entity.audit.enabled) {
      lines.push('  ' + entity.audit.createdBy + ' String?');
      lines.push('  ' + entity.audit.updatedBy + ' String?');
    }

    lines.push(...inverseRelations(entity, spec.entities));

    for (const index of entity.indexes) {
      const fields = Object.entries(index.fields).map(([name, direction]) => indexField(entity, name, direction));
      lines.push('  ' + (index.options && index.options.unique ? '@@unique' : '@@index') + '([' + fields.join(', ') + '])');
    }
    if (entity.collection) lines.push('  @@map("' + entity.collection.replace(/"/g, '\"') + '")');
    lines.push('}', '');
  }

  return lines.join('\n');
};

module.exports.lowerFirst = lowerFirst;
