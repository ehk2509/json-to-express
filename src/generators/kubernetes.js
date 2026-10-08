'use strict';

const path = require('node:path');
const {environmentContract, slug, yamlScalar} = require('./deployment-utils');

function resourceLines(resources, indent) {
  if (!resources || (!resources.requests && !resources.limits)) return [];
  const pad = ' '.repeat(indent);
  const lines = [pad + 'resources:'];
  for (const section of ['requests', 'limits']) {
    if (!resources[section]) continue;
    lines.push(pad + '  ' + section + ':');
    for (const [key, value] of Object.entries(resources[section])) {
      lines.push(pad + '    ' + key + ': ' + yamlScalar(value));
    }
  }
  return lines;
}

function envFromLines(name, indent) {
  const pad = ' '.repeat(indent);
  return [
    pad + 'envFrom:',
    pad + '  - configMapRef:',
    pad + '      name: ' + name + '-config',
    pad + '  - secretRef:',
    pad + '      name: ' + name + '-secrets'
  ];
}

function probes(spec, indent) {
  const pad = ' '.repeat(indent);
  const readinessPath = spec.observability.health.readiness.enabled
    ? spec.observability.health.readiness.path
    : (spec.app.health.enabled ? spec.app.health.path : null);
  const livenessPath = spec.observability.health.liveness.enabled
    ? spec.observability.health.liveness.path
    : (spec.app.health.enabled ? spec.app.health.path : null);
  const lines = [];
  if (readinessPath) {
    lines.push(
      pad + 'readinessProbe:',
      pad + '  httpGet:',
      pad + '    path: ' + readinessPath,
      pad + '    port: http',
      pad + '  initialDelaySeconds: 3',
      pad + '  periodSeconds: 10'
    );
  }
  if (livenessPath) {
    lines.push(
      pad + 'livenessProbe:',
      pad + '  httpGet:',
      pad + '    path: ' + livenessPath,
      pad + '    port: http',
      pad + '  initialDelaySeconds: 10',
      pad + '  periodSeconds: 20'
    );
  }
  return lines;
}

function deploymentSource(spec, worker) {
  const name = slug(spec.app.package.name);
  const resourceName = worker ? name + '-worker' : name;
  const labels = worker ? name + '-worker' : name;
  const lines = [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: ' + resourceName,
    'spec:',
    '  replicas: ' + spec.deployment.kubernetes.replicas,
    '  selector:',
    '    matchLabels:',
    '      app: ' + labels,
    '  template:',
    '    metadata:',
    '      labels:',
    '        app: ' + labels,
    '    spec:',
    '      terminationGracePeriodSeconds: 30',
    '      containers:',
    '        - name: ' + (worker ? 'worker' : 'api'),
    '          image: ' + yamlScalar(spec.deployment.kubernetes.image),
    '          imagePullPolicy: IfNotPresent'
  ];

  if (worker) {
    lines.push('          command: ["npm", "run", "worker"]');
  } else {
    lines.push(
      '          ports:',
      '            - name: http',
      '              containerPort: ' + spec.app.port
    );
  }

  lines.push(
    ...envFromLines(name, 10),
    '          securityContext:',
    '            allowPrivilegeEscalation: false',
    '            runAsNonRoot: true'
  );

  if (!worker) lines.push(...probes(spec, 10));
  lines.push(...resourceLines(spec.deployment.kubernetes.resources, 10), '');
  return lines.join('\n');
}

function configMapSource(spec) {
  const name = slug(spec.app.package.name);
  const {config} = environmentContract(spec);
  return [
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    '  name: ' + name + '-config',
    'data:',
    ...Object.entries(config).map(([key, value]) => '  ' + key + ': ' + yamlScalar(value)),
    ''
  ].join('\n');
}

function secretExampleSource(spec) {
  const name = slug(spec.app.package.name);
  const {secrets} = environmentContract(spec);
  return [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: ' + name + '-secrets',
    'type: Opaque',
    'stringData:',
    ...Object.keys(secrets).map(key => '  ' + key + ': "<set-me>"'),
    ''
  ].join('\n');
}

function serviceSource(spec) {
  const name = slug(spec.app.package.name);
  return [
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    '  name: ' + name,
    'spec:',
    '  type: ' + spec.deployment.kubernetes.serviceType,
    '  selector:',
    '    app: ' + name,
    '  ports:',
    '    - name: http',
    '      port: ' + spec.deployment.kubernetes.servicePort,
    '      targetPort: http',
    ''
  ].join('\n');
}

module.exports = function kubernetesFiles(spec) {
  const dir = spec.deployment.kubernetes.directory;
  const files = new Map([
    [path.posix.join(dir, 'configmap.yaml'), configMapSource(spec)],
    [path.posix.join(dir, 'secret.example.yaml'), secretExampleSource(spec)],
    [path.posix.join(dir, 'deployment.yaml'), deploymentSource(spec, false)],
    [path.posix.join(dir, 'service.yaml'), serviceSource(spec)]
  ]);

  if (spec.outbox.enabled && spec.outbox.worker === 'separate') {
    files.set(path.posix.join(dir, 'worker-deployment.yaml'), deploymentSource(spec, true));
  }

  return files;
};
