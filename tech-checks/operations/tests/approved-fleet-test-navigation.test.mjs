import {beforeFleetCountTrustSource} from './fleet-count-trust-source.mjs';
import {originalItSavedReadingSource} from './it-saved-readings-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const manifest=JSON.parse(read('./fleet-view-navigation-preservation.json'));
for(const item of manifest)test('original source reconstructs after declared navigation/presentation changes: '+item.path,()=>{
  let source=beforeFleetCountTrustSource(item.path,read('./'+item.path));
  if(['it-daily-mode.browser.spec.mjs','mhelp-live-inventory.browser.spec.mjs'].includes(item.path))source=originalItSavedReadingSource(item.path,source);
  assert.ok(source.startsWith(item.addedImport));source=source.slice(item.addedImport.length);
  for(const replacement of item.replacements){
    assert.equal(source.split(replacement.to).length-1,replacement.count);
    source=source.replaceAll(replacement.to,replacement.from);
  }
  const bytes=Buffer.from(source);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),item.originalBlob);
});
test('shared helper uses real disclosure and clicks; never bypasses visibility or roles',()=>{
 const source=read('./fleet-view-navigation-helper.mjs');
 assert.match(source,/await expect\(button\)\.toHaveCount\(1\)/);
 assert.match(source,/await expect\(button\)\.toBeVisible\(\)/);
 assert.match(source,/await menu\.locator\(':scope > summary'\)\.click\(\)/);
 assert.doesNotMatch(source,/force:|dispatchEvent|evaluate\(|location|setAttribute|request\.|\.route\(|\.goto\(|\.skip\(/);
});
