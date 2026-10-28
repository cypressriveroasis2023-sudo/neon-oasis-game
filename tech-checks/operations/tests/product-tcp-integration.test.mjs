import test from 'node:test';import assert from 'node:assert/strict';
import {productSource,positive,negative} from './fixtures/product-tcp-source.mjs';
import {buildProductGroups,consumeProductReceipt,RECEIPT_CONTRACT} from '../../supabase/functions/_shared/exact-product-producer/fullSource.ts';
import {integrateScopedConnections} from '../../supabase/functions/_shared/exact-product-producer/statusIntegration.ts';
import {currentMhelpProductConnectionCensus} from '../../supabase/functions/cos-operations-pages/mhelpProductConnectionSource.ts';
import {buildExactProductConnections,readExactProductConnections} from '../src/exactProductConnection.ts';
import {readProductGroupStatuses} from '../../supabase/functions/_shared/exact-product-producer/groupCollector.ts';
import {createLegacyProductTcpHost} from '../../supabase/functions/cos-exact-product-tcp/host.ts';
async function fixture(online=true){
 const f=await productSource(),proof=(await buildProductGroups(f.source,['101'],f.now,f.review)).groups[0];
 const base=buildExactProductConnections(currentMhelpProductConnectionCensus(f.source.upload,f.now).census,f.source.tracker,
 f.source.identitySources.devices.map(d=>({deviceId:d.id,publicIp:d.public_ip,expectedPorts:d.expected_ports,connectionRevision:d.connection_revision,monitoringEnabled:d.monitoring_enabled,portStatus:null})),f.now);
 const result=consumeProductReceipt(proof,{state:'accepted',payload:{contract:RECEIPT_CONTRACT,proof,ports:{80:online?positive:negative,443:negative},checkedAt:new Date(f.now).toISOString()}},f.now);
 return {...f,base,result};
}
test('successful exact-source group receipts enter the CURRENT envelope and existing browser verifier',async()=>{
 for(const online of [true,false]){
 const f=await fixture(online),before=structuredClone(f.base);let reads=0;
 const out=await integrateScopedConnections(f.base,{readSource:async()=>{reads++;return structuredClone(f.source);},readStatuses:async ids=>{assert.deepEqual(ids,['101']);return [f.result];},now:()=>f.now},f.review);
 assert.equal(reads,2);assert.equal(out.items[0].status,online?'online':'offline');assert.equal(out.items[0].resourceId,'1');
 assert.ok(readExactProductConnections(out,out.sourceSha256,['101'],f.now));assert.deepEqual(f.base,before);assert.doesNotMatch(JSON.stringify(out),/authorityGuard|device_serial|11\.22/);
 }
});
test('foreign, incomplete, stale, forged revision/guard and technical statuses cannot replace Unknown',async()=>{
 for(const mutate of [r=>r.productId='102',r=>r.resourceId='99',r=>r.authorityGuard='f'.repeat(64),r=>r.trackerSha256='f'.repeat(64),r=>r.sourceSha256='f'.repeat(64),r=>r.checkedAt='2020-01-01T00:00:00Z',r=>r.status='unknown']){
 const f=await fixture();mutate(f.result);const out=await integrateScopedConnections(f.base,{readSource:async()=>structuredClone(f.source),readStatuses:async()=>[f.result],now:()=>f.now},f.review);assert.deepEqual(out,f.base,String(mutate));
 }
});
test('post-receipt source/config/epoch/lifecycle/disabled drift fails closed',async()=>{
 for(const mutate of [s=>s.upload.records[0].binding.expectedGuard='f'.repeat(64),s=>s.identitySources.ownerEpochs[0].epoch='f'.repeat(64),s=>s.identitySources.devices[0].monitoring_enabled=false,s=>s.identitySources.devices[0].connection_revision++,s=>s.identitySources.devices[0].source='foreign',s=>s.identitySources.units[0].status='retired',s=>s.tracker.records[1].publicIp=s.tracker.records[0].publicIp]){
 const f=await fixture();let reads=0;const out=await integrateScopedConnections(f.base,{readSource:async()=>{const s=structuredClone(f.source);if(++reads>1)mutate(s);return s;},readStatuses:async()=>[f.result],now:()=>f.now},f.review);assert.deepEqual(out,f.base,String(mutate));
 }
});
test('conclusive baseline and all other source holds cannot be overridden; outages retain baseline',async()=>{
 const f=await fixture();for(const reason of ['Another Product ID claims this tracker IP; verify endpoint ownership.','Inactive, Missing or Do Not Use source; no operational connection is claimed.']){
 const b=structuredClone(f.base);b.items[0].reason=reason;assert.deepEqual(await integrateScopedConnections(b,{readSource:async()=>{throw Error('must not read');},readStatuses:async()=>{throw Error('must not read');}},f.review),b);
 }
 const b=structuredClone(f.base);b.items[0].status='online';assert.deepEqual(await integrateScopedConnections(b,{readSource:async()=>{throw Error();},readStatuses:async()=>[]},f.review),b);
 assert.deepEqual(await integrateScopedConnections(f.base,{readSource:async()=>{throw Error('offline source');},readStatuses:async()=>[]},f.review),f.base);
});
test('mounted legacy host defaults disabled; inactive/foreign/unapproved users never reach source or RPC',async()=>{
 for(const profile of [null,{role:'service',active:true,archived_at:null},{role:'it',active:true,archived_at:null},{role:'owner',active:false,archived_at:null},{role:'owner',active:true,archived_at:'2020-01-01'}]){
 const calls=[],id='00000000-0000-4000-8000-000000000001';const options={legacyUrl:'https://legacy.test',serviceKey:'synthetic-service',nativeProofUrl:'https://native.test/proof',nativeOrigin:'https://native.test',connect:async()=>{throw Error('must not probe');},fetch:async(url,init)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id});if(url.includes('/profiles?'))return Response.json(profile?[{...profile,user_id:id}]:[]);throw Error('must not call source/RPC');}};
 const req=()=>new Request('https://legacy.test/functions/v1/cos-exact-product-tcp',{method:'POST',headers:{Authorization:'Bearer synthetic-user','Content-Type':'application/json'},body:JSON.stringify({action:'read',productIds:['101']})});
 assert.equal((await createLegacyProductTcpHost(options)(req())).status,503);assert.equal(calls.length,0);
 assert.equal((await createLegacyProductTcpHost({...options,enabled:true})(req())).status,403);assert.equal(calls.length,2);
 }
});

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
test('optional deadline releases baseline even when slow census ignores cancellation; no late reads',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture();let time=f.now,resolve,signal,calls=0;
 const pending=integrateScopedConnections(f.base,{now:()=>time,readSource:s=>{signal=s;return new Promise(r=>resolve=r);},readStatuses:async()=>{calls++;return [f.result];}},f.review);
 time+=6500;t.mock.timers.tick(6500);assert.equal(await pending,f.base);assert.equal(signal.aborted,true);
 resolve(f.source);await flush();assert.equal(calls,0);
});
test('request cancellation returns baseline and rejects late receipts without rereading authority',async()=>{
 const f=await fixture(),controller=new AbortController();let release,reads=0,entered;const waiting=new Promise(r=>entered=r);
 const pending=integrateScopedConnections(f.base,{now:()=>f.now,signal:controller.signal,readSource:async()=>{reads++;return f.source;},readStatuses:async()=>{entered();return new Promise(r=>release=r);}},f.review);
 await waiting;controller.abort();assert.equal(await pending,f.base);release([f.result]);await flush();assert.equal(reads,1);
});
test('late proof after presentation boundary succeeds within remaining request budget',async()=>{
 const f=await fixture();let time=f.now+7000,reads=0;
 const result=await integrateScopedConnections(f.base,{requestStartedAt:f.now,now:()=>time,readSource:async()=>{reads++;return f.source;},readStatuses:async()=>{time+=2000;return [f.result];}},f.review);
 assert.equal(reads,2);assert.equal(result.items[0].status,'online');assert.equal(time-f.now,9000);
});
test('slow baseline leaves no enrichment budget; absolute cutoff wins over a new window',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture();let time=f.now+24000,calls=0;
 const options={requestStartedAt:f.now,now:()=>time,readSource:async()=>{calls++;return f.source;},readStatuses:async()=>[f.result]};
 assert.equal(await integrateScopedConnections(f.base,options,f.review),f.base);assert.equal(calls,0);
 time=f.now+23000;options.readSource=()=>{calls++;return new Promise(()=>{});};const pending=integrateScopedConnections(f.base,options,f.review);
 time+=500;t.mock.timers.tick(500);assert.equal(await pending,f.base);assert.equal(calls,1);
});

import {identityDigest,nativeIdentityKey,nativeIdentityTuple,healthResourceKey,healthSourceUnitKey} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
async function fleetFixture(count){
 const f=await productSource({channels:1}),source=structuredClone(f.source),review={native:{},nativeResources:{},owner:new Set(),ownerResources:{},ownerPhysical:{}};
 source.upload.records=[];source.map.items=[];source.map.inventoryItems=[];source.tracker.records=[];
 for(const key of ['units','devices','matches','providers','ownerEpochs'])source.identitySources[key]=[];
 for(let i=0;i<count;i++){
  const unitId=`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,id=String(1000+i),ip=`11.22.${Math.floor(i/250)}.${1+i%250}`,key='group-'+i;
  const unit={...f.source.identitySources.units[0],id:unitId,unit_number:key},device={...f.source.identitySources.devices[0],id:i+1,unit_key:key,public_ip:ip,device_serial:'serial-'+i,external_device_id:'external-'+i,device_name:key},provider={...f.source.identitySources.providers[0],id:unitId,external_device_id:device.external_device_id,device_name:key},match={...f.source.identitySources.matches[0],id:unitId,equipment_unit_id:unitId,vigilant_device_id:unitId};
  const record=structuredClone(f.source.upload.records[0]);Object.assign(record,{productId:id,unitNumber:key,sourceRow:i+2});Object.assign(record.binding,{productId:id,nativeUnitId:unitId,nativeLabel:key,fullLabel:key});source.upload.records.push(record);
  const map={...f.source.map.inventoryItems[0],id:unitId,unitNumber:key};source.map.items.push(map);source.map.inventoryItems.push(map);
  source.tracker.records.push({...f.source.tracker.records[0],productId:id,recordId:'mhelp_product:'+id,sourceRow:i+2,publicIp:ip});
  for(const [k,v] of [['units',unit],['devices',device],['providers',provider],['matches',match],['ownerEpochs',{unitKey:key,epoch:'6'.repeat(64),deviceIds:[String(device.id)]}]])source.identitySources[k].push(v);
  const native=await nativeIdentityKey(unitId);review.native[native]=await identityDigest(nativeIdentityTuple(unit,[{provider,match,device}]));review.nativeResources[native]={deviceIds:[await healthResourceKey(String(device.id))],unitKeys:[await healthSourceUnitKey(key)]};
 }
 source.upload.recordCount=count;
 const base=buildExactProductConnections(currentMhelpProductConnectionCensus(source.upload,f.now).census,source.tracker,source.identitySources.devices.map(d=>({deviceId:d.id,publicIp:d.public_ip,expectedPorts:d.expected_ports,connectionRevision:0,monitoringEnabled:true,portStatus:null})),f.now);
 return {...f,source,review,base};
}
test('100 eligible fleet candidates: 13 bounded receipt batches, 2 outer authority reads; budget stops further calls',async()=>{
 const f=await fleetFixture(100),ids=f.base.items.map(i=>i.productId),groups=[];
 for(let i=0;i<ids.length;i+=64)groups.push(...(await buildProductGroups(f.source,ids.slice(i,i+64),f.now,f.review)).groups);
 assert.equal(groups.length,100);
 for(const slow of [false,true]){
  let time=f.now,reads=0,batches=0,innerAuthority=0,receiptCalls=0;
  const out=await integrateScopedConnections(f.base,{now:()=>time,readSource:async()=>{reads++;time+=100;return f.source;},readStatuses:async selected=>{assert.ok(selected.length<=8);batches++;time+=slow?2000:100;return readProductGroupStatuses({read:async()=>{innerAuthority++;return f.source;},rpc:async(name,args)=>{receiptCalls++;assert.equal(name,'cos_product_tcp_read_v2');const proof=groups.find(g=>g.productId===args.p_product_id);return {state:'accepted',payload:{contract:RECEIPT_CONTRACT,proof,ports:{80:positive,443:negative},checkedAt:new Date(f.now).toISOString()}};}},selected,()=>time,f.review);}},f.review);
  if(slow){assert.equal(out,f.base);assert.equal(batches,4);assert.equal(reads,1);assert.equal(innerAuthority,8);}
  else{assert.equal(out.items.filter(i=>i.status==='online').length,100);assert.equal(batches,13);assert.equal(reads,2);assert.equal(innerAuthority,26);assert.equal(receiptCalls,100);assert.equal(time-f.now,1500);}
 }
});
test('final census timeout retains mixed baseline including valid existing positive proof',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=await fixture();f.base.items.push({...f.base.items[0],productId:'999',status:'online',checkedAt:new Date(f.now).toISOString()});let time=f.now,reads=0,entered;const waiting=new Promise(r=>entered=r);
 const pending=integrateScopedConnections(f.base,{now:()=>time,readSource:async()=>{if(++reads===1)return f.source;entered();return new Promise(()=>{});},readStatuses:async()=>[f.result]},f.review);
 await waiting;time+=6500;t.mock.timers.tick(6500);const out=await pending;assert.equal(out,f.base);assert.equal(out.items[1].status,'online');assert.equal(reads,2);
});
test('legacy receipt consumer cancels a hung authority read and never starts RPC or second census',async()=>{
 const f=await fixture(),controller=new AbortController();let calls=0,signal;
 const pending=readProductGroupStatuses({read:s=>{calls++;signal=s;return new Promise(()=>{});},rpc:async()=>{throw Error('must not read receipts');}},['101'],()=>f.now,f.review,controller.signal);
 controller.abort();await assert.rejects(pending,/canceled/);assert.equal(calls,1);assert.equal(signal.aborted,true);
});
