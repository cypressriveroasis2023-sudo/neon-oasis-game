import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const manifest = JSON.parse(readFileSync(new URL('./fleet-map-stage-preservation.json',import.meta.url),'utf8'));
assert.equal(manifest.contract,'COS_FLEET_MAP_STAGE_PRESERVATION_V1');
assert.equal(manifest.provenance,'James 11:48 AM CT Nov 19: map-centered single-screen layout');
const blob = source=>{const bytes = Buffer.from(source);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};

/** Peel only the stage wiring. Count-trust and older pins then see the reviewed bytes. */
export function beforeFleetMapStageSource(name,source){
  const file = manifest.files.find(item=>item.path===name);
  if(!file)return source;
  if(blob(source)!==file.candidateBlob)return source;
  for(const edit of [...file.replacements].reverse()){
    assert.equal(source.split(edit.to).length-1,1,name+': one stage block');
    source = source.replace(edit.to,edit.from);
  }
  assert.equal(blob(source),file.baselineBlob,name+': stage reversal');
  return source;
}
