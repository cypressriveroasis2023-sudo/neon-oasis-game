import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {compareInventoryEquipment} from '../../supabase/functions/cos-mhelp-inventory-sync/index.ts';
const source=await readFile(new URL('../../supabase/functions/cos-mhelp-inventory-sync/serve.ts',import.meta.url),'utf8');
const compiled=(await transform(source.replace(/^import .*;\r?\n/gm,''),{loader:'ts',target:'es2022'})).code;
function baselineReader(fetch){
 let options;
 const Deno={env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'synthetic-service':undefined},serve:()=>{}};
 new Function('createInventoryComparisonHandler','createMhelpPartnerHandler','nativeMhelpTokens','readInventorySource','createInventoryCache','Deno','fetch',compiled)(value=>{options=value;return ()=>{};},()=>()=>{},()=>({}),()=>{},()=>{},Deno,fetch);
 return options.readBaseline;
}
const records=Array.from({length:1001},(_,i)=>({productId:String(i+1),unitNumber:'Ranger '+(i+1),customerId:'3',apiAssignment:{placementProof:{version:1}},syntheticSavedEvidence:'x'.repeat(2070)}));
const saved={sourceSha256:'a'.repeat(64),records};
const body=JSON.stringify(saved);
test('actual saved baseline reader accepts a complete 1001-record response above the old 2 MiB limit',async()=>{
 assert(Buffer.byteLength(body)>2097152);assert(Buffer.byteLength(body)<4194304);
 let calls=0;
 const read=baselineReader(async(url,options)=>{calls++;assert(url.endsWith('/rpc/cos_mhelp_inventory_baseline'));assert.equal(options.body,'{}');assert.equal(options.redirect,'error');return new Response(body);});
 const result=await read();assert.equal(calls,1);assert.deepEqual(result,saved);
 const review={liveAccessVerified:true,verifiedPortalId:'224643',partial:false,totalRows:1001,items:records.map(r=>({equipmentId:r.productId,name:r.unitNumber,portalId:'224643',customerId:'3',serviceLocationId:'4',active:true}))};
 assert.equal(compareInventoryEquipment(review,result).baselineRecords,1001);
 assert.throws(()=>compareInventoryEquipment({...review,items:[...review.items.slice(0,-1),review.items[0]]},result),/Invalid source/);
});
test('baseline transport retains a hard 4 MiB header and streamed-byte boundary and cancels oversized streams',async()=>{
 let reads=0;
 await assert.rejects(baselineReader(async()=>new Response(new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(1));}},{highWaterMark:0}),{headers:{'content-length':'4194305'}}))(),/Read unavailable/);assert.equal(reads,0);
 let canceled=false;
 await assert.rejects(baselineReader(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2097152));c.enqueue(new Uint8Array(2097152));c.enqueue(new Uint8Array(1));},cancel(){canceled=true;}})))(),/Read unavailable/);assert.equal(canceled,true);
 const exact='{"padding":"'+'x'.repeat(4194304-14)+'"}';assert.equal(Buffer.byteLength(exact),4194304);
 assert.equal((await baselineReader(async()=>new Response(exact))()).padding.length,4194304-14);
});
test('baseline reader still rejects HTTP errors, malformed JSON and invalid UTF-8',async()=>{
 for(const response of [new Response('{}',{status:503}),new Response('{'),new Response(new Uint8Array([255]))])await assert.rejects(baselineReader(async()=>response)());
});
