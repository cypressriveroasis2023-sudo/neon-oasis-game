import test from 'node:test';
import assert from 'node:assert/strict';
import {compareInventoryEquipment,createInventoryComparisonHandler} from '../../supabase/functions/cos-mhelp-inventory-sync/index.ts';
import {projectInventoryCache,createInventoryCache} from '../../supabase/functions/cos-mhelp-inventory-sync/cache.ts';
const row={equipmentId:'1',portalId:'224643',name:'Ranger 029.2',model:null,active:true,equipmentTypeId:'2',customerId:'3',serviceLocationId:'4'};
const baseline={sourceSha256:'a'.repeat(64),records:[{productId:'1',unitNumber:'Ranger 029.2',customerId:'4'}]};
const review={liveAccessVerified:true,verifiedPortalId:'224643',partial:false,totalRows:1,items:[row]};
test('complete comparison preserves exact Product IDs, decimal labels and service identity',()=>{const r=compareInventoryEquipment(review,baseline);assert.equal(r.changes.renamed,0);assert.equal(r.changes.customerIdentityChanged,0);assert.equal(r.inventoryWrites,0);});
test('added, absent and changed source identities are separate',()=>{const r=compareInventoryEquipment({...review,totalRows:2,items:[{...row,name:'Ranger 029.3',customerId:'9',serviceLocationId:'8'},{...row,equipmentId:'2',active:false}]},{...baseline,records:[...baseline.records,{productId:'3',unitNumber:'Sniper 001',customerId:'4'}]});assert.deepEqual(r.changes,{added:1,missing:1,renamed:1,customerIdentityChanged:1,inactive:1});});
test('empty, wrong-portal, duplicate and partial equipment never become complete comparisons',()=>{for(const value of [{...review,partial:true},{...review,verifiedPortalId:'9'},{...review,totalRows:0,items:[]},{...review,totalRows:2,items:[row,row]},{...review,items:[{...row,portalId:'9'}]}])assert.throws(()=>compareInventoryEquipment(value,baseline));});
test('unknown fields are excluded from the response',()=>{const r=compareInventoryEquipment({...review,accessToken:'synthetic-private',items:[{...row,secret:'synthetic-private'}]},baseline);assert(!JSON.stringify(r).includes('synthetic-private'));});
test('authentication and request shape reject before reading inventory',async()=>{let reads=0;const handler=createInventoryComparisonHandler({authenticate:async()=>false,readEquipment:async()=>{reads++;return review;},readBaseline:async()=>baseline});const r=await handler(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"compare"}'}));assert.equal(r.status,403);assert.equal(reads,0);});
test('source errors never echo vendor errors or credentials',async()=>{const handler=createInventoryComparisonHandler({authenticate:async()=>true,readEquipment:async()=>{throw Error('synthetic-private-token');},readBaseline:async()=>baseline});const r=await handler(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"compare"}'}));assert.equal(r.status,503);assert(!JSON.stringify(await r.json()).includes('synthetic-private-token'));});
test('status reads no vendor data and caller-supplied equipment cannot reach the writer',async()=>{let reads=0,writes=0;const handler=createInventoryComparisonHandler({authenticate:async()=>true,readEquipment:async()=>{reads++;return review;},readBaseline:async()=>baseline,status:async()=>({enabled:false}),writeSource:async()=>{writes++;}});const request=body=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body});assert.equal((await handler(request('{"action":"status"}'))).status,200);assert.equal(reads,0);assert.equal((await handler(request('{"action":"run","records":[]}'))).status,400);assert.equal(writes,0);});
test('scheduled rate-limit failure records retry status without exposing vendor content',async()=>{let code;const handler=createInventoryComparisonHandler({authenticate:async()=>true,readEquipment:async()=>{throw Object.assign(Error('synthetic-private-token'),{status:429});},readBaseline:async()=>baseline,recordFailure:async value=>{code=value;}});const r=await handler(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"run"}'}));assert.equal(code,'source_rate_limited');assert.equal(r.status,503);assert(!(await r.text()).includes('synthetic-private-token'));});

const runRequest=()=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"run"}'});
test('scheduled failures identify a fixed stage without exposing arbitrary causes or making a write',async()=>{
 for(const stage of ['read_authority','equipment','baseline','comparison','resources']){
  let writes=0,released=0,recorded;
  const fail=async()=>{throw Error('synthetic-private-token; customer address');};
  const handler=createInventoryComparisonHandler({authenticate:async()=>true,
   acquireRead:stage==='read_authority'?fail:async()=>({allowed:true,leaseId:'00000000-0000-4000-8000-000000000001'}),
   releaseRead:async()=>{released++;},readEquipment:stage==='equipment'?fail:async()=>stage==='comparison'?{...review,partial:true}:review,
   readBaseline:stage==='baseline'?fail:async()=>baseline,readSource:fail,
   writeSource:async()=>{writes++;},recordFailure:async code=>{recorded=code;}});
  const response=await handler(runRequest()),body=await response.json();
  assert.equal(response.status,503);assert.equal(body.failureStage,stage);assert.equal(body.inventoryWrites,0);
  assert.equal(body.reason,undefined);assert(!JSON.stringify(body).includes('synthetic-private'));
  assert.equal(writes,0);assert.equal(recorded,'inventory_source_unavailable');assert.equal(released,stage==='read_authority'?0:1);
 }
});
test('real cache validation failures expose only their exact static reason and retain the prior inventory',async()=>{
 const path='/customers/3/servicelocations?pageSize=200&rowIndex=0&Fields=serviceLocationId,customerId,portalId,name,isActive,address1,city,state,zip,countryId';
 const cases=[
  ['Incomplete cached service page',()=>projectInventoryCache(path,{totalRows:2,results:[]})],
  ['Invalid cached service membership',()=>projectInventoryCache(path,{totalRows:1,results:[{serviceLocationId:4,customerId:9,portalId:224643,name:'synthetic-private-customer'}]})],
  ['Invalid inventory cache response',()=>projectInventoryCache(path,{totalRows:1,results:[{serviceLocationId:4,customerId:3,portalId:224643,name:'token: synthetic-private'}]})],
  ['Inventory cache save is unconfirmed',async()=>createInventoryCache({read:async()=>({totalRows:0,results:[]}),cache:async action=>action==='read'?{hit:false}:{saved:false}}).read(path)],
 ];
 for(const [reason,reject] of cases){let writes=0;const handler=createInventoryComparisonHandler({authenticate:async()=>true,readEquipment:async()=>review,readBaseline:async()=>baseline,readSource:async()=>reject(),writeSource:async()=>{writes++;}});
  const response=await handler(runRequest()),body=await response.json();assert.equal(response.status,503);assert.equal(body.failureStage,'resources');assert.equal(body.reason,reason);assert.equal(writes,0);assert.equal(body.inventoryWrites,0);assert(!JSON.stringify(body).includes('synthetic-private'));
 }
});
test('cache-looking errors with appended vendor details stay private',async()=>{
 for(const message of ['Invalid cached service membership: synthetic-private','Inventory cache save is unconfirmed synthetic-private','source_http_403_customers?token=synthetic-private']){
  const handler=createInventoryComparisonHandler({authenticate:async()=>true,readEquipment:async()=>review,readBaseline:async()=>baseline,readSource:async()=>{throw Error(message);}});
  const body=await (await handler(runRequest())).json();assert.equal(body.reason,undefined);assert.equal(body.failureStage,'resources');assert(!JSON.stringify(body).includes('synthetic-private'));
 }
});
test('scheduled membership rejection returns structural counts without IDs or source content',async()=>{
 let writes=0;
 const path='/customers/3/servicelocations?pageSize=200&rowIndex=0&Fields=serviceLocationId,customerId,portalId,name,isActive,address1,city,state,zip,countryId';
 const handler=createInventoryComparisonHandler({authenticate:async()=>true,readEquipment:async()=>review,readBaseline:async()=>baseline,readSource:async()=>projectInventoryCache(path,{totalRows:1,results:[{serviceLocationId:987654,customerId:987654,portalId:224643,name:'synthetic-private-customer',address1:'synthetic-private-address'}]}),writeSource:async()=>{writes++;}});
 const response=await handler(runRequest()),body=await response.json();assert.equal(response.status,503);assert.equal(body.failureStage,'resources');assert.equal(body.reason,'Invalid cached service membership');assert.equal(body.inventoryWrites,0);assert.equal(writes,0);
 assert.deepEqual(body.cacheMembership,{version:1,rows:1,missingChildIdentities:0,explicitServiceIds:1,parentMismatches:1,duplicateChildIdentities:0,serviceIdEqualsCustomerId:1,serviceIdEqualsRequestedParent:0,customerIdEqualsRequestedParent:0});
 assert(!JSON.stringify(body).includes('synthetic-private'));assert(!JSON.stringify(body).includes('987654'));
 const forged=createInventoryComparisonHandler({authenticate:async()=>true,readEquipment:async()=>review,readBaseline:async()=>baseline,readSource:async()=>{throw Object.assign(Error('Invalid cached service membership'),{diagnostic:{token:'synthetic-private'}});}});
 const rejected=await (await forged(runRequest())).json();assert.equal(rejected.cacheMembership,undefined);assert(!JSON.stringify(rejected).includes('synthetic-private'));
});
