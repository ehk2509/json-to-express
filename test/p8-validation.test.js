'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {validateCase, percentile, publicReport, assess}=require('../scripts/p8-validation-core');
const {argumentsFrom:parseArgs,recordIdentifier}=require('../scripts/p8-consumer-smoke');
const {parseArgs:parseAssessArgs}=require('../scripts/p8-assess');

const SHA='a'.repeat(40);
const pilot={
  version:1,id:'customer-billing',spec:{
    specVersion:'1.0',app:{name:'customer-billing',framework:'fastify'},
    database:{type:'postgresql'},
    entities:{Invoice:{fields:{code:{type:'string',required:true}}}}
  },
  probe:{route:'/api/invoices',payload:{code:'INV1'},assertField:'code',assertValue:'INV1'}
};
function report(id,framework,database) {
  return {schemaVersion:1,realExternalDeployment:false,
    category:'isolated-consumer-simulation',commit:SHA,caseId:id,
    outcome:'pass',framework,database,checks:{
      create:true,retrieve:true,validation:true,restartPersistence:true,
      delete:true,soak:true
    }};
}
function attestation(organization,project,framework,database) {
  return {
    organization,project,commit:SHA,
    operatorGithub:'external-contributor',
    runtime:{framework,database},observedHours:80,
    incidentCount:0,rollbackDrill:true,operatorConfirmed:true,
    publicEvidence:'https://example.org/p8/evidence/'+organization+'/'+project,
    review:{
      decision:'approved',
      reviewer:'independent-reviewer',
      issue:'https://github.com/ehk2509/json-to-express/issues/1234',
      reviewedAt:'2026-10-15T10:00:00Z',
      checks:{independentOperator:true,deploymentReviewed:true,
        rollbackReviewed:true,incidentsReviewed:true,evidenceRedacted:true}
    }
  };
}
const reports=[report('orders','express','mongodb'),
  report('billing','fastify','postgresql')];
const policy={minProjects:3,minOrganizations:2,minObservationHours:72};

test('P8 consumer spec is data-only with explicit route and persisted check',()=>{
  assert.equal(validateCase(pilot),pilot);
  assert.throws(()=>validateCase({...pilot,id:'../bad'}),/Invalid P8 pilot/);
  assert.throws(()=>validateCase({...pilot,spec:{...pilot.spec,plugins:[{name:'untrusted'}]}}),/plugins/);
  assert.throws(()=>validateCase({...pilot,probe:{...pilot.probe,route:'https://private.service'}}),/route/);
  assert.throws(()=>validateCase({...pilot,probe:{...pilot.probe,assertValue:'wrong'}}),/assertion/);
  assert.throws(()=>validateCase({...pilot,spec:{...pilot.spec,
    app:{...pilot.spec.app,package:{scripts:{postinstall:'node attack.js'}}}}}),/dependency installation/);
});

test('P8 only accepts safe identifiers and explicit consumer runner flags',()=>{
  assert.equal(recordIdentifier({_id:'1234567890abcdef12345678'}),'1234567890abcdef12345678');
  assert.equal(recordIdentifier({id:'11-22-33'}),'11-22-33');
  assert.throws(()=>recordIdentifier({id:'../../secret'}),/invalid primary key/);
  assert.throws(()=>parseArgs(['--case','a.json']),/Missing case\/report/);
  assert.throws(()=>parseArgs(['--case','a.json','--report','b.json','--unknown']),/Usage/);
  assert.throws(()=>parseAssessArgs(['--sha',SHA,'--report','a.json']),/Missing required/);
});

test('P8 latency percentiles are deterministic',()=>{
  assert.equal(percentile([10,5,30,20],.50),10);
  assert.equal(percentile([10,5,30,20],.95),30);
  assert.throws(()=>percentile([],.95));
});

test('P8 smoke reports cannot be mistaken for real external production deployment',()=>{
  const smoke=publicReport({pilot,checks:{create:true},timings:{},commit:SHA,
    tarballIntegrity:'sha512-public-hash',outcome:'pass'});
  assert.equal(smoke.realExternalDeployment,false);
  assert.equal(smoke.category,'isolated-consumer-simulation');
  assert.equal(smoke.commit,SHA);
  assert.equal(smoke.checks.create,true);
  assert.equal(JSON.stringify(smoke).includes('DATABASE_URL'),false);
  const fake={...reports[0],realExternalDeployment:true};
  assert.throws(()=>assess({reports:[fake,reports[1]],attestations:[],requiredSha:SHA,policy}),
    /Invalid or failing/);
});

test('No P8 external attestation means the milestone is not externally validated',()=>{
  const result=assess({reports,attestations:[],requiredSha:SHA,policy});
  assert.equal(result.smokeReady,true);
  assert.equal(result.externalEvidenceReady,false);
  assert.equal(result.status,'awaiting-external-evidence');
  assert.equal(result.verifiedAttestationCount,0);
});

test('Production evidence gate requires multiple independent organizations and technologies',()=>{
  const evidence=[
    attestation('org-one','billing','fastify','postgresql'),
    attestation('org-one','warehouse','express','mongodb'),
    attestation('org-two','orders','express','postgresql')
  ];
  const accepted=assess({reports,attestations:evidence,requiredSha:SHA,policy});
  assert.equal(accepted.status,'externally-validated');
  assert.equal(accepted.independentOrganizationCount,2);
  assert.equal(accepted.verifiedAttestationCount,3);
  assert.throws(()=>assess({reports,attestations:[evidence[0],evidence[0]],
    requiredSha:SHA,policy}),/Duplicate independent project/);
  assert.equal(assess({reports,attestations:evidence.slice(0,2),
    requiredSha:SHA,policy}).externalEvidenceReady,false);
  assert.throws(()=>assess({reports,attestations:[{...evidence[0],observedHours:3}],
    requiredSha:SHA,policy}),/Unacceptable/);
  assert.throws(()=>assess({reports,attestations:[{...evidence[0],commit:'b'.repeat(40)}],
    requiredSha:SHA,policy}),/Unacceptable/);
  assert.throws(()=>assess({reports:[{...reports[0],checks:{...reports[0].checks,
    restartPersistence:false}},reports[1]],attestations:evidence,
    requiredSha:SHA,policy}),/Invalid or failing/);
});

test('Unreviewed or self-reviewed pilots NEVER qualify for external acceptance',()=>{
  const reviewed=[
    attestation('org-one','billing','fastify','postgresql'),
    attestation('org-one','warehouse','express','mongodb'),
    attestation('org-two','orders','express','postgresql')
  ];
  const unreviewed=reviewed.map(({review,...rest})=>rest);
  const initial=assess({reports,attestations:unreviewed,requiredSha:SHA,policy});
  assert.equal(initial.externalEvidenceReady,false);
  assert.equal(initial.pendingReviewCount,3);
  assert.equal(initial.verifiedAttestationCount,0);
  const selfReviewed=reviewed.map(item=>({...item,review:{...item.review,reviewer:item.operatorGithub}}));
  const refused=assess({reports,attestations:selfReviewed,requiredSha:SHA,policy});
  assert.equal(refused.status,'awaiting-external-evidence');
  assert.equal(refused.pendingReviewCount,3);
  assert.equal(refused.verifiedAttestationCount,0);
  const wrongRepo=reviewed.map(item=>({...item,review:{...item.review,
    issue:'https://github.com/evil/repo/issues/1'}}));
  assert.equal(assess({reports,attestations:wrongRepo,requiredSha:SHA,policy}).verifiedAttestationCount,0);
  const incomplete=reviewed.map(item=>({...item,review:{...item.review,
    checks:{...item.review.checks,rollbackReviewed:false}}}));
  assert.equal(assess({reports,attestations:incomplete,requiredSha:SHA,policy}).verifiedAttestationCount,0);
});

test('External pilot cohort commit remains pinned when main and CI advance',()=>{
  const laterCommit='b'.repeat(40);
  const approved=[
    attestation('org-one','billing','fastify','postgresql'),
    attestation('org-one','warehouse','express','mongodb'),
    attestation('org-two','orders','express','postgresql')
  ];
  const result=assess({reports,attestations:approved,
    requiredSha:SHA,externalTargetCommit:SHA,policy});
  assert.equal(result.targetCommit,SHA);
  assert.equal(result.smokeCommit,SHA);
  const moved=assess({
    reports:reports.map(report=>({...report,commit:laterCommit})),
    attestations:approved,requiredSha:laterCommit,
    externalTargetCommit:SHA,policy
  });
  assert.equal(moved.status,'externally-validated');
  assert.equal(moved.targetCommit,SHA);
  assert.equal(moved.smokeCommit,laterCommit);
  assert.throws(()=>assess({reports:reports.map(report=>({...report,commit:laterCommit})),
    attestations:approved,requiredSha:laterCommit,policy}),/Unacceptable external P8 attestation/);
  assert.throws(()=>assess({reports,attestations:approved,requiredSha:'bad',policy}),
    /exact CI smoke SHA/);
});
