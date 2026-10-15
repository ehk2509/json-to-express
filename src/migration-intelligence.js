'use strict';

// Conservative, pure schema drift analysis. This module never executes SQL or
// mutates a database. Callers must supply independently introspected schemas.
const crypto = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function assertSchema(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !value.tables || typeof value.tables !== 'object' || Array.isArray(value.tables)) {
    throw new TypeError(name + ' must contain a tables object');
  }
  for (const [table, columns] of Object.entries(value.tables)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) ||
        !columns || typeof columns !== 'object' || Array.isArray(columns)) {
      throw new TypeError('Invalid table: ' + table);
    }
    for (const [column, spec] of Object.entries(columns)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column) ||
          !spec || typeof spec.type !== 'string' || !spec.type.trim()) {
        throw new TypeError('Invalid column: ' + table + '.' + column);
      }
    }
  }
}
function planDrift(expected, actual) {
  assertSchema(expected, 'expected');
  assertSchema(actual, 'actual');
  const changes = [];
  const tables = [...new Set([...Object.keys(expected.tables), ...Object.keys(actual.tables)])].sort();
  for (const table of tables) {
    const want = expected.tables[table], have = actual.tables[table];
    if (!have) {changes.push({kind:'create-table',table,risk:'review'});continue;}
    if (!want) {changes.push({kind:'drop-table',table,risk:'destructive'});continue;}
    const columns = [...new Set([...Object.keys(want), ...Object.keys(have)])].sort();
    for (const column of columns) {
      const a = want[column], b = have[column];
      if (!b) changes.push({kind:'add-column',table,column,risk:a.required?'review':'low'});
      else if (!a) changes.push({kind:'drop-column',table,column,risk:'destructive'});
      else if (digest(a) !== digest(b)) changes.push({
        kind:'alter-column',table,column,risk:'review',expected:a,actual:b});
    }
  }
  return Object.freeze({version:1,expectedHash:digest(expected),actualHash:digest(actual),
    changes,requiresApproval:changes.some(c=>c.risk!=='low'),
    executable:false});
}
module.exports = {planDrift,digest};
