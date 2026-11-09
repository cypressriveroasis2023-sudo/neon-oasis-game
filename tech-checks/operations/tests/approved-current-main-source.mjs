import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// This guard recognizes only the already merged main source, reverses its
// exact reviewed deltas, and then hands prior bytes to the original guards.
// A changed runtime file still fails closed; baseline hashes never change.
const manifest=JSON.parse(readFileSync(new URL('./approved-current-main-source-preservation.json',import.meta.url),'utf8'));
assert.equal(manifest.contract,'COS_APPROVED_CURRENT_MAIN_SOURCE_PRESERVATION_V1');
assert.deepEqual(manifest.files.map(file=>file.path),['FleetDashboard.tsx','useCameraHealth.ts']);
const blob=source=>{const b=Buffer.from(source);return createHash('sha1').update('blob '+b.length+'\\0'.replace('\\0','\u0000')).update(b).digest('hex');};

export function previousReviewedMainSource(name,source){
 const item=manifest.files.find(file=>file.path===name);
 if(!item)return source;
 assert.equal(blob(source),item.candidateBlob,name+': exact reviewed current-main source');
 for(const edit of [...item.replacements].reverse()){
  assert.ok(edit.from.length>0&&edit.to.length>0&&edit.from!==edit.to,name+': explicit reversible patch required');
  assert.equal(edit.count,1,name+': exactly one reviewed block');
  assert.equal(source.split(edit.to).length-1,edit.count,name+': source patch no longer matches reviewed bytes');
  source=source.replace(edit.to,edit.from);
 }
 assert.equal(blob(source),item.baselineBlob,name+': earlier approved source preserved');
 return source;
}
