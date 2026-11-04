import test from 'node:test';
import assert from 'node:assert/strict';
import {runFleetVerification,verificationSummaryText} from '../src/fleetVerificationRun.ts';
const products=n=>Array.from({length:n},(_,i)=>({productId:String(i+1),unitNumber:'Test unit '+(i+1)}));
const receipt=(ids,status='online')=>({contract:'COS_VERIFY_PRODUCTS_NOW_V1',connections:{ids},items:ids.map(productId=>({productId,status,reason:'Test evidence',checkedAt:status==='unknown'?null:'2026-11-04T14:00:00Z'}))});
const base={current:()=>true,readback:async()=>{}};
test('each batch reaches saved readback before another POST starts',async()=>{
 const events=[];
 const r=await runFleetVerification(products(9),{...base,check:async ids=>{events.push(['post',...ids]);return receipt(ids);},readback:async c=>events.push(['read',...c.ids])});
 assert.deepEqual(events.map(e=>e[0]),['post','read','post','read','post','read']);
 assert.equal(r.online,9);assert.equal(r.readbackConfirmed,true);
});
test('a failed middle POST is not retried and cannot hide successful batches',async()=>{
 const posts=[],reads=[];
 const r=await runFleetVerification(products(9),{...base,check:async ids=>{posts.push(ids);if(ids[0]==='5')throw Error('connection lost');return receipt(ids);},readback:async c=>reads.push(c)});
 assert.equal(posts.length,3);assert.equal(reads.length,3);assert.equal(reads[1],undefined);
 assert.equal(r.online,5);assert.equal(r.notConfirmed,4);assert.equal(r.notAttempted,0);
 assert.equal(r.rows.find(x=>x.productId==='1').status,'online');
});
test('a failed final batch still gets a read-only recovery',async()=>{
 let calls=0,reads=0;
 const r=await runFleetVerification(products(8),{...base,check:async ids=>{if(++calls===2)throw Error('lost');return receipt(ids);},readback:async()=>{reads++;}});
 assert.equal(reads,2);assert.equal(r.online,4);assert.equal(r.notConfirmed,4);
});
test('display readback failure does not discard returned readings or retry checks',async()=>{
 let calls=0;
 const r=await runFleetVerification(products(5),{...base,check:async ids=>{calls++;return receipt(ids);},readback:async()=>{throw Error('read unavailable');}});
 assert.equal(calls,2);assert.equal(r.online,5);assert.equal(r.readbackConfirmed,false);
 assert.match(verificationSummaryText(r),/Fleet refresh could not be confirmed/);
});
test('authorization failure stops subsequent batches',async()=>{
 let calls=0;
 const r=await runFleetVerification(products(9),{...base,check:async()=>{calls++;throw {response:{status:403}};}});
 assert.equal(calls,1);assert.equal(r.notAttempted,5);assert.equal(r.notConfirmed,4);
});
test('malformed, duplicate, wrong-target, or missing-timestamp results stop safely',async()=>{
 for(const edit of [v=>{v.items[0]=null;},v=>{v.items[1]=v.items[0];},v=>{v.items[0].productId='999';},v=>{v.items[0].checkedAt=null;},v=>{v.contract='wrong';}]){
  let calls=0;
  const r=await runFleetVerification(products(8),{...base,check:async ids=>{calls++;const v=receipt(ids);edit(v);return v;}});
  assert.equal(calls,1);assert.equal(r.online,0);assert.equal(r.notConfirmed,4);assert.equal(r.notAttempted,4);
 }
});
test('session changes prevent readback and publication of late POST results',async()=>{
 let valid=true,reads=0,progress=0;
 const r=await runFleetVerification(products(8),{current:()=>valid,check:async ids=>{valid=false;return receipt(ids);},readback:async()=>{reads++;},progress:()=>{progress++;}});
 assert.equal(r,null);assert.equal(reads,0);assert.equal(progress,0);
});
test('a session change during readback prevents the next POST',async()=>{
 let valid=true,calls=0;
 const r=await runFleetVerification(products(8),{current:()=>valid,check:async ids=>{calls++;return receipt(ids);},readback:async()=>{valid=false;}});
 assert.equal(r,null);assert.equal(calls,1);
});
test('unknown is unresolved, never counted as online, offline or successful setup',async()=>{
 const r=await runFleetVerification(products(4),{...base,check:async ids=>receipt(ids,'unknown')});
 assert.equal(r.online,0);assert.equal(r.offline,0);assert.equal(r.unresolved,4);
 assert.match(verificationSummaryText(r),/4 unresolved/);
 assert.match(verificationSummaryText(r),/does not invent missing settings/);
});
test('input list changes during readback do not lose selected targets',async()=>{
 const input=products(8),posts=[];
 const r=await runFleetVerification(input,{...base,check:async ids=>{posts.push(ids);return receipt(ids);},readback:async()=>{input.splice(0);}});
 assert.equal(posts.length,2);assert.equal(r.online,8);
});
test('duplicate products are checked once and batch size remains four',async()=>{
 const list=products(5),posts=[];
 const r=await runFleetVerification([...list,...list],{...base,check:async ids=>{posts.push(ids);return receipt(ids);}});
 assert.deepEqual(posts.map(x=>x.length),[4,1]);assert.equal(r.requested,5);
});
test('offline evidence remains offline, not rewritten by the browser',async()=>{
 const r=await runFleetVerification(products(2),{...base,check:async ids=>receipt(ids,'offline')});
 assert.equal(r.offline,2);assert.equal(r.online,0);assert.equal(r.unresolved,0);
});
