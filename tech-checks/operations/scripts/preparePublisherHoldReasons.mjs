import {createHash} from 'node:crypto';
export const before='return reply({ state: "current", ...done });';
export const after='return reply({ state: "current", ...done, heldReasons: plan.results.reduce((counts, r) => { if (r.state === "held") counts[r.reason] = (counts[r.reason] || 0) + 1; return counts; }, Object.create(null)) });';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function preparePublisherHoldReasons(native){
 if(native.slug!=='cos-sheets-placement-publish'||native.version!==10||native.status!=='ACTIVE'
  ||native.verify_jwt!==false||native.ezbr_sha256!=='bbf95082f8675ab321d502bf8ab580a9a000c03b3f4a23f3f180fe7263ed962f'
  ||!Array.isArray(native.files)||native.files.length!==3)throw Error('Fresh publisher configuration changed');
 const files=native.files.map(f=>({...f})),entry=files.find(f=>f.name==='deployed-cos-sheets-placement-publish-v7/source/index.ts');
 if(!entry||sha256(entry.content)!=='aba9ad6ac58a26f8027656f0fb6c46480c792551661923ad15f2e351b9dd5b41'
  ||entry.content.split(before).length!==2)throw Error('Publisher source drift');
 const original=entry.content;entry.content=original.replace(before,after);
 if(entry.content.replace(after,before)!==original)throw Error('Exact response reversal failed');
 return {...native,files};
}
