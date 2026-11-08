import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync(new URL('./fleet-count-trust-preservation.json',import.meta.url),'utf8'));
assert.equal(manifest.contract,'COS_FLEET_COUNT_TRUST_PRESERVATION_V1');
assert.deepEqual(manifest.files.map(file=>file.path),['FleetDashboard.tsx','fleetBoardLayout.css','fleet-dashboard.browser.spec.mjs','it-daily-mode.browser.spec.mjs','fleet-recorded-roster.browser.spec.mjs','operations.browser.spec.mjs','field-health-flow.browser.spec.mjs','field-map-clean-layout.browser.spec.mjs','fleet-camera-tools.browser.spec.mjs']);
const blob=source=>{const bytes=Buffer.from(source);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};
/** Restore only the exact count-trust/UI candidate to reviewed main, then run
 * every pre-existing source guard unchanged. Unlisted or modified bytes fail. */
export function beforeFleetCountTrustSource(name,source){
 const file=manifest.files.find(item=>item.path===name);
 if(!file)return source;
 assert.equal(blob(source),file.candidateBlob,name+': exact count-trust candidate');
 for(const edit of [...file.replacements].reverse()){
  assert.ok(edit.from&&edit.to&&edit.from!==edit.to,name+': explicit reviewed reversal');
  assert.equal(edit.count,1,name+': one reviewed block');
  assert.equal(source.split(edit.to).length-1,edit.count,name+': reviewed block count');
  source=source.replace(edit.to,edit.from);
 }
 assert.equal(blob(source),file.baselineBlob,name+': unchanged reviewed main source');
 return source;
}
