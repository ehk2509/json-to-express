'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const DRIVERS = new Set(['mongodb', 'postgresql']);
const FRAMEWORKS = new Set(['express', 'fastify']);
const SAFE_NAME = /^[a-z][a-z0-9-]{1,60}$/;
const HEX_SHA = /^[a-f0-9]{40}$/;

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function requireKeys(obj, keys, label) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(label + ' must be an object');
  }
  for (const key of keys) if (!Object.hasOwn(obj, key)) {
    throw new Error(label + ' missing ' + key);
  }
}
function validateCase(pilot) {
  requireKeys(pilot, ['version', 'id', 'spec', 'probe'], 'pilot');
  if (pilot.version !== 1 || typeof pilot.id !== 'string' || !SAFE_NAME.test(pilot.id)) {
    throw new Error('Invalid P8 pilot version/id');
  }
  const spec = pilot.spec;
  requireKeys(spec, ['specVersion', 'app', 'database', 'entities'], 'pilot.spec');
  if (!FRAMEWORKS.has(spec.app.framework) || !DRIVERS.has(spec.database.type)) {
    throw new Error('P8 consumer must specify a supported framework/database');
  }
  if (spec.plugins !== undefined && spec.plugins.length) {
    throw new Error('P8 untrusted pilot inputs must not run plugins');
  }
  if (spec.app.package && (spec.app.package.scripts ||
      spec.app.package.dependencies || spec.app.package.devDependencies)) {
    throw new Error('P8 pilot must not override dependency installation or scripts');
  }
  const probe = pilot.probe;
  requireKeys(probe, ['route', 'payload', 'assertField', 'assertValue'], 'pilot.probe');
  if (typeof probe.route !== 'string' || !/^\/[a-z0-9/_-]{1,160}$/.test(probe.route) ||
      probe.route.includes('//') || !probe.route.startsWith('/api/')) {
    throw new Error('P8 probe route must be a simple /api/... path');
  }
  if (!probe.payload || typeof probe.payload !== 'object' ||
      Array.isArray(probe.payload) || !Object.keys(probe.payload).length ||
      typeof probe.assertField !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(probe.assertField) ||
      !Object.hasOwn(probe.payload, probe.assertField) ||
      probe.payload[probe.assertField] !== probe.assertValue) {
    throw new Error('Invalid P8 persisted-field assertion');
  }
  return pilot;
}
function percentile(values, fraction) {
  assert.ok(Array.isArray(values) && values.length, 'Need latency samples');
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}
function publicReport({pilot, checks, timings, commit, tarballIntegrity, outcome}) {
  // No environment variables, connection strings, URLs or response bodies.
  const spec = pilot.spec;
  return {
    schemaVersion: 1,
    category: 'isolated-consumer-simulation',
    realExternalDeployment: false,
    caseId: pilot.id,
    framework: spec.app.framework,
    database: spec.database.type,
    specSha256: fingerprint(spec),
    commit: HEX_SHA.test(commit || '') ? commit : null,
    tarballIntegrity: tarballIntegrity || null,
    nodeVersion: process.version,
    platform: process.platform,
    recordedAt: new Date().toISOString(),
    outcome,
    checks: Object.fromEntries(Object.entries(checks).map(([key, value]) =>
      [key, value === true])),
    timings
  };
}
const REVIEW_CHECKS = Object.freeze([
  'independentOperator', 'deploymentReviewed', 'rollbackReviewed',
  'incidentsReviewed', 'evidenceRedacted'
]);
function isApprovedReview(item) {
  const review = item.review;
  if (!review || review.decision !== 'approved' ||
      typeof review.reviewer !== 'string' ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/.test(review.reviewer) ||
      typeof item.operatorGithub !== 'string' ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/.test(item.operatorGithub) ||
      review.reviewer.toLowerCase() === item.operatorGithub.toLowerCase() ||
      typeof review.issue !== 'string' ||
      !/^https:\/\/github\.com\/ehk2509\/json-to-express\/issues\/[1-9][0-9]*$/.test(review.issue) ||
      typeof review.reviewedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(review.reviewedAt) ||
      Number.isNaN(Date.parse(review.reviewedAt)) ||
      !review.checks || !REVIEW_CHECKS.every(check => review.checks[check] === true)) {
    return false;
  }
  return true;
}

function assess({reports, attestations, requiredSha, externalTargetCommit = requiredSha, policy}) {
  assert.ok(HEX_SHA.test(requiredSha), 'A complete exact CI smoke SHA is required');
  assert.ok(HEX_SHA.test(externalTargetCommit), 'A pinned external pilot release SHA is required');
  const requiredChecks = ['create', 'retrieve', 'validation', 'restartPersistence', 'delete', 'soak'];
  const validated = [];
  for (const report of reports) {
    if (report.schemaVersion !== 1 || report.realExternalDeployment !== false ||
        report.category !== 'isolated-consumer-simulation' ||
        report.commit !== requiredSha || report.outcome !== 'pass' ||
        !FRAMEWORKS.has(report.framework) || !DRIVERS.has(report.database) ||
        !requiredChecks.every(check => report.checks?.[check] === true)) {
      throw new Error('Invalid or failing P8 isolated-consumer report');
    }
    validated.push(report.caseId);
  }
  const minProjects = policy?.minProjects ?? 3;
  const minOrganizations = policy?.minOrganizations ?? 2;
  const minObservationHours = policy?.minObservationHours ?? 72;
  if (![minProjects, minOrganizations, minObservationHours].every(x =>
    Number.isSafeInteger(x) && x > 0)) throw new Error('Invalid P8 acceptance policy');
  const accepted = [], organizations = new Set(), projects = new Set();
  let pendingReviewCount = 0;
  for (const item of attestations) {
    requireKeys(item, ['project', 'organization', 'commit', 'runtime',
      'observedHours', 'incidentCount', 'rollbackDrill', 'operatorConfirmed',
      'publicEvidence'], 'external attestation');
    if (!SAFE_NAME.test(item.project) || !SAFE_NAME.test(item.organization) ||
        !HEX_SHA.test(item.commit) || item.commit !== externalTargetCommit ||
        !DRIVERS.has(item.runtime?.database) || !FRAMEWORKS.has(item.runtime?.framework) ||
        !Number.isSafeInteger(item.observedHours) || item.observedHours < minObservationHours ||
        item.incidentCount !== 0 || item.rollbackDrill !== true ||
        item.operatorConfirmed !== true ||
        typeof item.publicEvidence !== 'string' ||
        !/^https:\/\/[^/]+\//.test(item.publicEvidence)) {
      throw new Error('Unacceptable external P8 attestation for ' + String(item.project));
    }
    if (!isApprovedReview(item)) {
      pendingReviewCount++;
      continue; // Self-attestation alone NEVER qualifies as external validation.
    }
    const identifier = item.organization + '/' + item.project;
    if (projects.has(identifier)) throw new Error('Duplicate independent project: ' + identifier);
    projects.add(identifier);
    organizations.add(item.organization);
    accepted.push({project:identifier, framework:item.runtime.framework,
      database:item.runtime.database, observedHours:item.observedHours});
  }
  const coverage = new Set(accepted.map(x => x.framework + '/' + x.database));
  const evidenceReady = accepted.length >= minProjects &&
    organizations.size >= minOrganizations &&
    new Set(accepted.map(x => x.framework)).size === FRAMEWORKS.size &&
    new Set(accepted.map(x => x.database)).size === DRIVERS.size;
  const smokeReady = validated.length >= 2 &&
    new Set(reports.map(x => x.framework + '/' + x.database)).size >= 2;
  return {
    schemaVersion: 1, targetCommit: externalTargetCommit,
    smokeCommit: requiredSha, externalTargetCommit,
    status: evidenceReady && smokeReady ? 'externally-validated' : 'awaiting-external-evidence',
    smokeReady, externalEvidenceReady: evidenceReady,
    simulatedCases: validated,
    reviewedAttestationCount: accepted.length,
    verifiedAttestationCount: accepted.length, // Compatibility with previous reports.
    pendingReviewCount,
    independentOrganizationCount: organizations.size,
    frameworks: [...new Set(accepted.map(x => x.framework))].sort(),
    databases: [...new Set(accepted.map(x => x.database))].sort(),
    combinations: [...coverage].sort(),
    // The review object records a human assertion; this static program cannot
    // authenticate a reviewer's GitHub identity or independently audit the URL.
    caveat: 'Approval metadata is reviewed in code but reviewer identity and evidence require independent human audit.'
  };
}
module.exports = {validateCase, fingerprint, percentile, publicReport, assess, isApprovedReview};
