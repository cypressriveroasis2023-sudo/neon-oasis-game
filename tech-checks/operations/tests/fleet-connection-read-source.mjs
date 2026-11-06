import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const manifest=JSON.parse(readFileSync(new URL('./fleet-connection-read-preservation.json',import.meta.url),'utf8'));
assert.equal(manifest.contract,'COS_FLEET_CONNECTION_READ_PRESERVATION_V1');
assert.deepEqual(manifest.files.map(item=>item.path),['api.ts','useCameraHealth.ts','FleetDashboard.tsx']);
const blob=source=>{const bytes=Buffer.from(source);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};

/** Reverse only the reviewed connection-read patch before the immutable source
 * guards run. Exact candidate, replacement counts and prior source all remain checked. */
export function originalFleetConnectionReadSource(name,source){
 const item=manifest.files.find(entry=>entry.path===name);
 assert.ok(item,'No declared connection-read change for '+name);
 assert.equal(blob(source),item.candidateBlob,name+': exact reviewed runtime candidate');
 for(const edit of [...item.replacements].reverse()){
  assert.ok(edit.to.length>0,name+': exact nonempty reversal required');
  assert.equal(edit.count,1,name+': each reviewed block occurs once');
  assert.equal(source.split(edit.to).length-1,edit.count,name+': reviewed block count');
  source=source.replaceAll(edit.to,edit.from);
 }
 assert.equal(blob(source),item.baselineBlob,name+': immutable pre-patch source');
 return source;
}
