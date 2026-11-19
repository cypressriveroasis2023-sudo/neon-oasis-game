import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./mhelp-wins-rule-change.json', import.meta.url), 'utf8'));
const provenance = 'James 10:15 AM CT Nov 19: mHelp wins; flag overrides that disagree';

test('the mHelp rule change is declared for the six override tests', () => {
  assert.equal(manifest.provenance, provenance);
  assert.equal(manifest.flag, 'Owner override disagrees with mHelp (ignored for counts)');
  assert.equal(manifest.tests.length, 6);
  const files = new Map();
  for (const change of manifest.tests) {
    assert.equal(typeof change.old, 'string');
    assert.equal(typeof change.new, 'string');
    assert.notEqual(change.old, change.new);
    files.set(change.file, readFileSync(new URL('./' + change.file, import.meta.url), 'utf8'));
  }
  for (const change of manifest.tests) {
    assert.match(files.get(change.file), new RegExp(change.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(files.get(change.file), /Owner override disagrees with mHelp \(ignored for counts\)/);
  }
});
