import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const manifest=JSON.parse(readFileSync(new URL('./it-saved-readings-preservation.json',import.meta.url),'utf8'));
assert.equal(manifest.contract,'COS_IT_SAVED_READINGS_PRESERVATION_V1');
assert.deepEqual(manifest.files.map(item=>item.path),['App.tsx','FleetDashboard.tsx','it-daily-mode.browser.spec.mjs']);
const blob=source=>{const bytes=Buffer.from(source);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};

/** Reverse only the declared IT cache/control follow-up before existing immutable
 * source guards run. Candidate bytes, exact replacement counts and old bytes are checked. */
export function originalItSavedReadingSource(name,source){
 const item=manifest.files.find(entry=>entry.path===name);
 assert.ok(item,'No declared IT saved-reading change for '+name);
 assert.equal(blob(source),item.candidateBlob,name+': exact reviewed IT follow-up');
 for(const edit of [...item.replacements].reverse()){
  assert.ok(edit.to.length>0&&edit.to!==edit.from,name+': explicit nonempty change required');
  assert.equal(edit.count,1,name+': each reviewed block occurs once');
  assert.equal(source.split(edit.to).length-1,edit.count,name+': reviewed block count');
  source=source.replace(edit.to,edit.from);
 }
 assert.equal(blob(source),item.baselineBlob,name+': unchanged pre-follow-up source');
 return source;
}
