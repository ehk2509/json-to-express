#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {assess} = require('./p8-validation-core');

function parseArgs(argv) {
  const options = {reports:[], requireExternal:false};
  for (let i=0;i<argv.length;i++) {
    const flag=argv[i];
    if (flag==='--require-external') {
      if(options.requireExternal)throw new Error('Duplicate flag: '+flag);
      options.requireExternal=true;
      continue;
    }
    if (!['--report','--index','--output','--sha'].includes(flag) ||
        !argv[i+1] || argv[i+1].startsWith('--')) {
      throw new Error('Usage: node scripts/p8-assess.js --sha <40-character-commit> ' +
        '--index ci/p8/attestations.json --report <report.json> [--report ...] ' +
        '--output <assessment.json> [--require-external]');
    }
    const value=argv[++i];
    if (flag==='--report') options.reports.push(path.resolve(value));
    else if (options[flag]!==undefined) throw new Error('Duplicate flag: '+flag);
    else options[flag]=flag==='--sha'?value:path.resolve(value);
  }
  if (!options['--sha'] || !options['--index'] || !options['--output'] ||
      !options.reports.length)throw new Error('Missing required P8 assessment arguments');
  return options;
}
function run(options) {
  const index=JSON.parse(fs.readFileSync(options['--index'],'utf8'));
  if (index.version!==1 || !Array.isArray(index.attestations)) {
    throw new Error('P8 attestation index is invalid');
  }
  const reports=options.reports.map(file=>JSON.parse(fs.readFileSync(file,'utf8')));
  const result=assess({reports,attestations:index.attestations,
    requiredSha:options['--sha'],
    externalTargetCommit:index.externalTargetCommit || options['--sha'],
    policy:index.policy});
  fs.mkdirSync(path.dirname(options['--output']),{recursive:true});
  fs.writeFileSync(options['--output'],JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if (options.requireExternal && !result.externalEvidenceReady) {
    process.stderr.write('P8 is NOT externally validated: independent production evidence is missing.\n');
    process.exitCode=1;
  }
  return result;
}
if(require.main===module) {
  try {run(parseArgs(process.argv.slice(2)));}
  catch(error) {
    // Avoid dumping untrusted JSON, service URLs and environment values.
    console.error('P8 assessment could not verify inputs:',error.name);
    process.exitCode=1;
  }
}
module.exports={parseArgs,run};
