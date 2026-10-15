'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {validateCohort,readInputs,DOCS}=require('../scripts/p8-cohort-check');
const ROOT=path.join(__dirname,'..');
const original=readInputs(ROOT);
function clone(x){return JSON.parse(JSON.stringify(x));}

test('P8 first pilot cohort is bound to published beta.4 without fake operators',()=>{
  const state=validateCohort(original.cohort,original.index,original.docs);
  assert.equal(state.release,'0.2.0-beta.4');
  assert.equal(state.pinnedCommit,'9be050be812d027c72eade61a0f47b295d1efcae');
  assert.equal(state.submittedAttestations,0);
  assert.equal(state.externalValidationCertified,false);
  assert.equal(original.index.attestations.length,0);
  assert.ok(original.docs['docs/P8-GET-STARTED.md'].includes(
    'npx --yes --package=json-to-express@0.2.0-beta.4'));
  assert.ok(original.docs['docs/P8-GET-STARTED.md'].includes('--dry-run'));
  assert.ok(DOCS.every(doc=>fs.existsSync(path.join(ROOT,doc))));
});

test('P8 rejects stale cohort SHA and moving npm release tags',()=>{
  const mutated=clone(original.index);
  mutated.externalTargetCommit='dc964d701dc7236bf9dc7a586b6c1e7e78e066f2';
  assert.throws(()=>validateCohort(original.cohort,mutated,original.docs),
    /must stay pinned/);
  const bad=clone(original.cohort);
  bad.tag='v0.2.0-beta.3';
  assert.throws(()=>validateCohort(bad,original.index,original.docs),
    /tag\/version mismatch/);
  bad.tag='v0.2.0-beta.4';bad.npmUrl='https://npmjs.org/@beta';
  assert.throws(()=>validateCohort(bad,original.index,original.docs),
    /npm package\/version mismatch/);
});

test('P8 cannot weaken independent acceptance thresholds',()=>{
  const less=clone(original.index);
  less.policy.minProjects=2;
  assert.throws(()=>validateCohort(original.cohort,less,original.docs),
    /weaker than independent/);
  const cohort=clone(original.cohort);
  cohort.minimumObservationHours=24;
  assert.throws(()=>validateCohort(cohort,original.index,original.docs),
    /Cannot lower production evidence thresholds/);
});

test('P8 rejects stale docs and silent evidence migration',()=>{
  const docs={...original.docs};
  docs[DOCS[0]]=docs[DOCS[0]].replaceAll(original.cohort.commit,'f'.repeat(40));
  assert.throws(()=>validateCohort(original.cohort,original.index,docs),
    /obsolete cohort SHA/);
  const index=clone(original.index);
  index.attestations.push({organization:'someone',project:'sample',commit:'a'.repeat(40)});
  assert.throws(()=>validateCohort(original.cohort,index,original.docs),
    /Do not silently migrate/);
});

test('P8 review must remain human-verified, not inferred from GitHub CI',()=>{
  const {isApprovedReview}=require('../scripts/p8-validation-core');
  assert.equal(isApprovedReview({operatorGithub:'operator',review:{decision:'approved',
    reviewer:'operator'}}),false);
  const state=validateCohort(original.cohort,original.index,original.docs);
  assert.equal(state.externalValidationCertified,false);
  assert.match(state.note,/does not authenticate external deployments/);
});
