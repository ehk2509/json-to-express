'use strict';

function js(value) {
  return JSON.stringify(value);
}

function joinUrl(...parts) {
  const joined = parts
    .filter(part => part !== undefined && part !== null && part !== '')
    .map((part, index) => {
      const value = String(part);
      if (index === 0) return value.replace(/\/$/, '');
      return value.replace(/^\//, '').replace(/\/$/, '');
    })
    .filter(Boolean)
    .join('/');
  return joined.startsWith('/') ? joined : '/' + joined;
}

function payload(value, fallbackKey = 'error') {
  if (typeof value === 'string') return '{' + fallbackKey + ': ' + js(value) + '}';
  return js(value);
}

module.exports = {js, joinUrl, payload};
