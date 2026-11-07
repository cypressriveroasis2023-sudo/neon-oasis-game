import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync(new URL('./vision-briefing-preservation.json',import.meta.url),'utf8'));
const blob=source=>{const bytes=Buffer.from(source);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};
export function originalVisionBriefingSource(name,source){
 if(name!==manifest.path)return source;
 assert.equal(manifest.contract,'COS_VISION_BRIEFING_PRESERVATION_V1');
 assert.equal(blob(source),manifest.candidateBlob,'exact VISION presentation candidate');
 for(const edit of [...manifest.replacements].reverse()){
  assert.ok(edit.to&&edit.to!==edit.from);
  assert.equal(source.split(edit.to).length-1,1,'one declared VISION presentation block');
  source=source.replace(edit.to,edit.from);
 }
 assert.equal(blob(source),manifest.baselineBlob,'original reliability implementation preserved');
 return source;
}
