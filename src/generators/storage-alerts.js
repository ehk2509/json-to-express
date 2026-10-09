'use strict';

// Optional PrometheusRule-compatible rules. Operators may import them into
// Prometheus or Prometheus Operator after choosing their own routing labels.
module.exports = function storageAlertsSource(spec) {
  const prefix = spec.observability.metrics.prefix;
  return [
    'groups:',
    '  - name: json-to-express-storage',
    '    rules:',
    '      - alert: J2EStorageCleanupDeadLetters',
    '        expr: ' + prefix + 'storage_cleanup_dead > 0',
    '        for: 5m',
    '        labels:',
    '          severity: warning',
    '        annotations:',
    '          summary: "Storage cleanup has dead-letter jobs"',
    '          description: "Inspect storage:dead, retry after resolving storage issues, and reconcile orphans."',
    '      - alert: J2EStorageCleanupBacklogGrowing',
    '        expr: ' + prefix + 'storage_cleanup_pending > 100',
    '        for: 15m',
    '        labels:',
    '          severity: warning',
    '        annotations:',
    '          summary: "Persistent storage cleanup backlog"',
    '          description: "Review worker availability and object-store connectivity."',
    ''
  ].join('\n');
};
