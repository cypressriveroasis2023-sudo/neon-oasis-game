import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryComparisonHandler} from '../../supabase/functions/cos-mhelp-inventory-sync/index.ts';
import {createTrackerHandoff} from '../../supabase/functions/cos-mhelp-inventory-sync/handoff.ts';

const review={liveAccessVerified:true,verifiedPortalId:'224643',partial:false,totalRows:1,items:[{equipmentId:'1713609',portalId:'224643',name:'WA 003',active:true,customerId:'4',serviceLocationId:'7'}]};
const baseline={sourceSha256:'a'.repeat(64),records:[{productId:'1713609',unitNumber:'WA 003',customerId:'4'}]};
const source={complete:true,records:[],readAt:'2026-11-03T12:00:00.000Z'};
const request=(action='run')=>new Request('https://example.test/inventory',{method:'POST',headers:{'content-type':'application/json','x-camera-cron-secret':'synthetic-scheduler-secret'},body:JSON.stringify({action})});
function handler({writeReceipt={state:'current',sourceActivated:true},publishAfterCommit=async()=>({state:'current',published:0,recovered:0,unchanged:1,held:0})}={}){
 return createInventoryComparisonHandler({authenticate:async()=>true,readEquipment:async()=>review,readBaseline:async()=>baseline,readSource:async()=>source,writeSource:async()=>writeReceipt,publishAfterCommit});
}

test('a committed complete mHelp run immediately invokes tracker publishing with the authenticated request',async()=>{
 let calls=0;
 const h=handler({publishAfterCommit:async(req,receipt)=>{calls++;assert.equal(req.headers.get('x-camera-cron-secret'),'synthetic-scheduler-secret');assert.equal(receipt.state,'current');return {state:'current',published:2,recovered:0,unchanged:3,held:1};}});
 const response=await h(request()),body=await response.json();
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(body.state,'current');assert.deepEqual(body.trackerPublish,{state:'current',published:2,recovered:0,unchanged:3,held:1});
 assert.doesNotMatch(JSON.stringify(body),/synthetic-scheduler-secret/);
});

test('staged or non-activated imports never invoke the tracker publisher',async()=>{
 let calls=0;
 const publishAfterCommit=async()=>{calls++;return {state:'current'};};
 const staged=handler({writeReceipt:{state:'staged',sourceActivated:false},publishAfterCommit});
 assert.equal((await (await staged(request('stage'))).json()).state,'staged');
 const notActivated=handler({writeReceipt:{state:'current',sourceActivated:false},publishAfterCommit});
 assert.equal((await (await notActivated(request())).json()).state,'current');
 assert.equal(calls,0);
});

test('publisher failure is reported without undoing a committed mHelp import',async()=>{
 const h=handler({publishAfterCommit:async()=>{throw Error('private downstream detail');}});
 const response=await h(request()),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.state,'current');assert.equal(body.sourceActivated,true);assert.deepEqual(body.trackerPublish,{state:'failed'});
 assert.doesNotMatch(JSON.stringify(body),/private downstream detail|synthetic-scheduler-secret/);
});

test('tracker handoff refreshes placement for the same source before publishing',async()=>{
 const order=[];const receipt={state:'current',sourceActivated:true,sourceSha256:'a'.repeat(64)};
 const handoff=createTrackerHandoff({
  refreshPlacement:async(req,source)=>{order.push('placement');assert.equal(req.headers.get('x-camera-cron-secret'),'synthetic-scheduler-secret');assert.equal(source.sourceSha256,receipt.sourceSha256);return {state:'current',committed:true,sourceSha256:receipt.sourceSha256,confirmed:432,held:2};},
  publish:async(_req,source)=>{order.push('publisher');assert.equal(source.sourceSha256,receipt.sourceSha256);return {state:'current',published:1,unchanged:415,held:19};}
 });
 const result=await handoff(request(),receipt);
 assert.deepEqual(order,['placement','publisher']);
 assert.deepEqual(result,{state:'current',published:1,unchanged:415,held:19,placement:{state:'current',confirmed:432,held:2}});
});

test('tracker handoff skips publishing when placement has not committed the imported source',async()=>{
 let publishes=0;
 const handoff=createTrackerHandoff({
  refreshPlacement:async()=>({state:'current',committed:true,sourceSha256:'b'.repeat(64),confirmed:0,held:0}),
  publish:async()=>{publishes++;return {state:'current'};}
 });
 const result=await handoff(request(),{sourceSha256:'a'.repeat(64)});
 assert.equal(publishes,0);
 assert.deepEqual(result,{state:'not_started',placement:{state:'current',confirmed:0,held:0}});
});
