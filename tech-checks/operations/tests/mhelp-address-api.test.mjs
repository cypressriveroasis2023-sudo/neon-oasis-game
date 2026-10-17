import test from 'node:test';import assert from 'node:assert/strict';
import {withMhelpAddressMap} from '../../supabase/functions/cos-operations-pages/mhelpAddressMap.ts';
const original={items:[{id:'saved-gps',latitude:29,longitude:-95}],summary:{fieldUnits:1}};
const head={sourceSha256:'a'.repeat(64),payloadSha256:'b'.repeat(64),records:Array.from({length:1001},(_,i)=>({productId:String(i+1),placement:i<287?'FIELD':'SHOP'}))};
test('an unavailable, malformed or rejected address read preserves every existing map field',async()=>{
 for(const read of [async()=>{throw Error('provider unavailable');},async()=>null,async()=>({contract:'wrong'})]){
  const result=await withMhelpAddressMap(original,head,read);assert.deepEqual(result,{...original,mhelpAddressMapStatus:'unavailable'});assert.equal(result.items,original.items);
 }
});
test('a transport ignoring abort cannot hold up existing Fleet data',async()=>{
 let signal;const start=performance.now();const result=await withMhelpAddressMap(original,head,s=>{signal=s;return new Promise(()=>{});},undefined,20);
 assert.ok(performance.now()-start<1000);assert.equal(signal.aborted,true);assert.equal(result.items,original.items);assert.equal(result.mhelpAddressMapStatus,'unavailable');
});
test('an aborted authenticated request does not start a new address read',async()=>{
 const c=new AbortController();c.abort();let called=false;
 const result=await withMhelpAddressMap(original,head,async()=>{called=true;},c.signal);assert.equal(called,false);assert.equal(result.items,original.items);
});
