'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function relativeLinks(file) {
  const markdown=read(file);
  for(const found of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const href=found[1].split('#')[0].trim();
    if(!href || /^(?:https?:\/\/|mailto:|data:)/.test(href) ||
        href.startsWith('#'))continue;
    if(href.includes('<')||href.includes('>'))continue;
    const target=path.resolve(path.dirname(path.join(root,file)),href);
    assert.ok(target.startsWith(root+path.sep)||target===root,
      file+' link escaped repository: '+href);
    assert.ok(fs.existsSync(target),file+' contains broken local link: '+href);
  }
}

test('P9 homepage is concise and routes users to focused feature documentation',()=>{
  const file=read('README.md');
  assert.ok(Buffer.byteLength(file)<12000,'The 74 KB README must not grow back');
  for(const section of ['docs/GETTING-STARTED.md','docs/EXAMPLES.md',
    'docs/GENERATOR-API.md','docs/UPGRADE-GUARANTEES.md',
    'docs/REFERENCE.md','docs/EXTERNAL-VALIDATION.md']) {
    assert.ok(file.includes(section),'Missing task-focused route '+section);
    assert.ok(fs.existsSync(path.join(root,section)));
  }
  relativeLinks('README.md');
});

test('P9 full historical reference preserves advanced documentation and valid links',()=>{
  const history=read('docs/REFERENCE.md');
  assert.ok(history.length>60000,'Full reference was truncated');
  for(const section of ['## GraphQL API generation',
    '## Durable outbox and background jobs',
    '## Generated admin UI','## PostgreSQL + Prisma target']) {
    assert.ok(history.includes(section),'Lost archived feature section '+section);
  }
  relativeLinks('docs/REFERENCE.md');
});

test('P9 focused user guides link only to existing documents',()=>{
  for(const file of ['docs/GETTING-STARTED.md','docs/GENERATOR-API.md',
    'docs/UPGRADE-GUARANTEES.md','docs/EXAMPLES.md'])relativeLinks(file);
});
