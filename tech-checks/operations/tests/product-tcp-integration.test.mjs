import test from 'node:test';import assert from 'node:assert/strict';
import {productSource,positive,negative} from './fixtures/product-tcp-source.mjs';
import {buildProductGroups,consumeProductReceipt,RECEIPT_CONTRACT} from '../../supabase/functions/_shared/exact-product-producer/fullSource.ts';
import {integrateScopedConnections} from '../../supabase/functions/_shared/exact-product-producer/statusIntegration.ts';
import {currentMhelpProductConnectionCensus} from '../../supabase/functions/cos-operations-pages/mhelpProductConnectionSource.ts';
import {buildExactProductConnections,readExactProductConnections} from '../src/exactProductConnection.ts';
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
