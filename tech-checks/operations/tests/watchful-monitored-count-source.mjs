import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync(new URL('./watchful-monitored-count-preservation.json',import.meta.url),'utf8'));
assert.equal(manifest.contract,'COS_WATCHFUL_MONITORED_COUNT_PRESERVATION_V1');
assert.deepEqual(manifest.files.map(file=>file.path),['FleetDashboard.tsx']);
const blob=source=>{const bytes=Buffer.from(source);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};
/** Restore the reviewed monitored-count edit to the count-trust candidate.
 * Unlisted files pass through. The count-trust baselines are not changed. */
export function beforeWatchfulMonitoredCountSource(name,source){
 const file=manifest.files.find(item=>item.path===name);
 if(!file)return source;
 assert.equal(blob(source),file.candidateBlob,name+': exact monitored-count candidate');
 for(const edit of [...file.replacements].reverse()){
  assert.ok(edit.from&&edit.to&&edit.from!==edit.to,name+': explicit reviewed reversal');
  assert.equal(edit.count,1,name+': one reviewed block');
  assert.equal(source.split(edit.to).length-1,edit.count,name+': reviewed block count');
  source=source.replace(edit.to,edit.from);
 }
 assert.equal(blob(source),file.baselineBlob,name+': unchanged count-trust candidate');
 return source;
}
