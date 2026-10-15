#!/usr/bin/env node
'use strict';

// Read-only static guard: an external pilot cohort is pinned to an immutable
// published release. This does NOT verify operator identity or certify pilots.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const DOCS=[
  'docs/P8-GET-STARTED.md',
  'docs/P8-PILOT-PLAYBOOK.md',
  'docs/P8-OUTREACH-KIT.md',
  'docs/EXTERNAL-VALIDATION.md'
];
const SHA=/^[a-f0-9]{40}$/;
const VERSION=/^0\.[0-9]+\.[0-9]+-beta\.[1-9][0-9]*$/;

function validateCohort(cohort, index, docs) {
  assert.ok(cohort && cohort.schemaVersion===1 && VERSION.test(cohort.release),
    'Invalid P8 published beta cohort');
  assert.equal(cohort.tag,'v'+cohort.release,'Release tag/version mismatch');
  assert.ok(SHA.test(cohort.commit),'Cohort must pin exact 40-character SHA');
  assert.equal(cohort.releaseUrl,
    'https://github.com/ehk2509/json-to-express/releases/tag/'+cohort.tag,
    'Release must link to the exact GitHub tag');
  assert.equal(cohort.npmUrl,
    'https://www.npmjs.com/package/json-to-express/v/'+cohort.release,
    'npm package/version mismatch');
  assert.equal(cohort.evidenceType,'independent-operator-review',
    'Only external operator reviews can certify P8');
  assert.ok(cohort.requiredProjects>=3&&cohort.requiredOrganizations>=2&&
    cohort.minimumObservationHours>=72,'Cannot lower production evidence thresholds');
  assert.equal(index.version,1);
  assert.equal(index.externalTargetCommit,cohort.commit,
    'P8 attestations must stay pinned to the public cohort source SHA');
  assert.ok(index.policy && index.policy.minProjects>=cohort.requiredProjects &&
    index.policy.minOrganizations>=cohort.requiredOrganizations &&
    index.policy.minObservationHours>=cohort.minimumObservationHours,
    'P8 attestation policy is weaker than independent cohort acceptance');
  assert.ok(Array.isArray(index.attestations),'Invalid P8 attestation array');
  for(const item of index.attestations) {
    assert.equal(item.commit,cohort.commit,
      'Do not silently migrate real operator evidence across release cohorts');
  }
  for(const doc of DOCS) {
    assert.ok(typeof docs[doc]==='string','Missing P8 documentation '+doc);
    assert.ok(docs[doc].includes(cohort.commit),
      'P8 documentation references an obsolete cohort SHA: '+doc);
    assert.ok(docs[doc].includes(cohort.release),
      'P8 documentation must identify published pilot beta: '+doc);
  }
  return {
    schemaVersion:1,phase:'pilot-recruitment',release:cohort.release,
    pinnedCommit:cohort.commit,tag:cohort.tag,
    applicationUrl:'https://github.com/ehk2509/json-to-express/issues/57',
    submittedAttestations:index.attestations.length,
    externalValidationCertified:false,
    note:'This check only verifies a pinned release and documentation. It does not authenticate external deployments.'
  };
}
function readInputs(root=ROOT){
  const cohort=JSON.parse(fs.readFileSync(path.join(root,'ci/p8/cohort.json'),'utf8'));
  const index=JSON.parse(fs.readFileSync(path.join(root,'ci/p8/attestations.json'),'utf8'));
  const docs=Object.fromEntries(DOCS.map(doc=>[doc,fs.readFileSync(path.join(root,doc),'utf8')]));
  return {cohort,index,docs};
}
if(require.main===module) {
  try {process.stdout.write(JSON.stringify(validateCohort(...Object.values(readInputs())),null,2)+'\n');}
  catch(error) {
    console.error('P8 cohort integrity failed: '+error.message);
    process.exitCode=1;
  }
}
module.exports={validateCohort,readInputs,DOCS};
