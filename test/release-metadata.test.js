'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {loadRelease, releaseNotes} = require('../scripts/release-metadata');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'j2e-release-'));
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({name: 'json-to-express', version: '1.2.3-beta.4'}));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n- Future work\n\n' +
    '## [1.2.3-beta.4] - 2026-10-14\n\n### Changed\n- Feature A\n\n' +
    '## [1.2.3-beta.3] - 2026-10-13\n\n- Older release\n');
  return root;
}
function withFixture(fn) {
  const root = fixture();
  try {fn(root);} finally {fs.rmSync(root, {force: true, recursive: true});}
}
test('matches package version, derives tag, and creates release notes', () => withFixture(root => {
  const result = loadRelease(root);
  assert.equal(result.tag, 'v1.2.3-beta.4');
  assert.match(releaseNotes(result), /Feature A/);
  assert.doesNotMatch(releaseNotes(result), /Older release/);
  assert.doesNotMatch(releaseNotes(result), /Future work/);
}));
test('rejects stale or missing changelog entries', () => withFixture(root => {
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({name: 'json-to-express', version: '1.2.3-beta.5'}));
  assert.throws(() => loadRelease(root), /does not match/);
}));
test('rejects duplicate versions', () => withFixture(root => {
  fs.appendFileSync(path.join(root, 'CHANGELOG.md'),
    '\n## [1.2.3-beta.4] - 2026-10-11\n\n- Duplicate\n');
  assert.throws(() => loadRelease(root), /Duplicate changelog/);
}));
test('rejects empty changelog entries', () => withFixture(root => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog.replace('- Feature A', 'Nothing noteworthy'));
  assert.throws(() => loadRelease(root), /substantive bullet/);
}));
test('rejects invalid dates and non-beta versions', () => withFixture(root => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog.replace('2026-10-14', '2026-02-31'));
  assert.throws(() => loadRelease(root), /Invalid changelog release date/);
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({name: 'json-to-express', version: '1.2.3'}));
  assert.throws(() => loadRelease(root), /valid beta/);
}));
test('fails when package name changes unexpectedly', () => withFixture(root => {
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({name: 'different-package', version: '1.2.3-beta.4'}));
  assert.throws(() => loadRelease(root), /Unexpected npm package name/);
}));
