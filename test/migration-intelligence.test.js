'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {planDrift} = require('../src/migration-intelligence');
test('detects drift without generating executable migrations', () => {
 const result=planDrift({tables:{users:{id:{type:'integer'},name:{type:'text'}}}},
 {tables:{users:{id:{type:'integer'},legacy:{type:'text'}}}});
 assert.deepEqual(result.changes.map(c=>c.kind),['drop-column','add-column']);
 assert.equal(result.requiresApproval,true);
 assert.equal(result.executable,false);
});
test('same schema yields no changes despite key ordering',()=>{
 const result=planDrift({tables:{users:{id:{type:'integer',required:true}}}},
 {tables:{users:{id:{required:true,type:'integer'}}}});
 assert.equal(result.changes.length,0);
 assert.equal(result.expectedHash,result.actualHash);
});
test('rejects malformed input',()=>assert.throws(()=>planDrift({tables:{'bad;name':{}}},{tables:{}}),/Invalid table/));
