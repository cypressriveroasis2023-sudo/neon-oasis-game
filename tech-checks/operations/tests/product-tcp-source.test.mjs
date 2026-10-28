import test from 'node:test';import assert from 'node:assert/strict';
import {productSource,positive,negative} from './fixtures/product-tcp-source.mjs';
import {buildProductGroups,consumeProductReceipt,RECEIPT_CONTRACT} from '../../supabase/functions/_shared/exact-product-producer/fullSource.ts';
import {createProtectedSourceReader} from '../../supabase/functions/_shared/exact-product-producer/sourceReader.ts';
import {createSavedTcpProbe} from '../../supabase/functions/_shared/exact-product-producer/tcpProbe.ts';
import {createProductTcpHandler} from '../../supabase/functions/cos-exact-product-tcp/index.ts';
const run=f=>buildProductGroups(f.source,['101'],f.now,f.review);
test('full validated Product/native/group proof admits four channels, not bare normalized-name matches',async()=>{
 const f=await productSource(),{groups,held}=await run(f);assert.equal(groups.length,1);assert.deepEqual(held,[]);assert.equal(groups[0].devices.length,4);assert.equal(groups[0].bindingGuard,'d'.repeat(64));assert.equal(groups[0].crosswalkRevision,'f'.repeat(64));assert.equal((await buildProductGroups(f.source,['101'],f.now)).groups.length,0);
 for(const ports of [{80:positive,443:positive},{80:negative,443:negative}]){const p={state:'accepted',payload:{contract:RECEIPT_CONTRACT,proof:groups[0],ports,checkedAt:new Date(f.now).toISOString()}};const r=consumeProductReceipt(groups[0],p,f.now);assert.equal(r.status,ports[80].online?'online':'offline');assert.doesNotMatch(JSON.stringify(r),/serial|11\.22|Synthetic group/);}
});
test('missing/stale binding, aliases, partial identity and changed native inventory remain held',async()=>{
 for(const change of [s=>s.upload.records[0].binding=null,s=>s.upload.records[0].binding.guardCurrent=false,s=>s.upload.records[0].possibleAliasUnitIds=['other'],s=>s.upload.records[0].placementHeld=true,s=>s.upload.records[0].binding.representedUnitIds=[],s=>s.identitySources.matches.pop(),s=>s.map.inventoryItems[0].unitNumber='renamed']){const f=await productSource();change(f.source);assert.equal((await run(f)).groups.length,0,String(change));}
});
test('conflicting/foreign/disabled/incomplete/replaced groups and second Product-IP claims remain held',async()=>{
 for(const change of [s=>s.identitySources.ownerEpochs=[],s=>s.identitySources.units[0].status='retired',s=>s.identitySources.devices.pop(),s=>s.identitySources.devices.push({...s.identitySources.devices[0],id:99}),s=>s.identitySources.devices[0].monitoring_enabled=false,s=>s.identitySources.devices[0].source='foreign',s=>s.identitySources.devices[0].device_serial='replaced',s=>s.identitySources.devices[0].activation_state='retired',s=>s.identitySources.devices[0].organization='DNU',s=>s.identitySources.devices[0].expected_ports=[80],s=>s.identitySources.devices[0].public_ip='10.0.0.1',s=>s.tracker.records[1].publicIp=s.tracker.records[0].publicIp,s=>s.tracker.records[0].reviewReasons=['identity_mismatch']]){const f=await productSource();change(f.source);assert.equal((await run(f)).groups.length,0,String(change));}
});
test('accepted receipt cannot survive remote authority drift; pending is never displayable',async()=>{
 const f=await productSource(),g=(await run(f)).groups[0],receipt={state:'accepted',payload:{contract:RECEIPT_CONTRACT,proof:g,ports:{80:positive,443:positive},checkedAt:new Date(f.now).toISOString()}};
 f.source.upload.records[0].binding.expectedGuard='1'.repeat(64);const current=(await run(f)).groups[0];assert.notEqual(current.authorityGuard,g.authorityGuard);assert.equal(consumeProductReceipt(current,receipt,f.now),null);receipt.state='pending';assert.equal(consumeProductReceipt(g,receipt,f.now),null);
});
function readerIO(f,drift=false){let reads=0;const calls=[],s=f.source;return {calls,io:{platformRpc:async name=>{calls.push(name);if(name==='cos_mhelp_placement_snapshot'){const upload=structuredClone(s.upload);if(++reads>1&&drift)upload.payloadSha256='9'.repeat(64);return {upload};}return name==='cos_owner_identity_snapshot'?s.identitySources.ownerCrosswalk:s.map;},platformRead:async path=>{calls.push(path);return path.startsWith('equipment_units?')?s.identitySources.units:path.startsWith('vision_vigilant_unit_matches?')?s.identitySources.matches:s.identitySources.providers;},legacyRead:async path=>{calls.push(path);return s.identitySources.devices;},legacyEpochs:async()=>s.identitySources.ownerEpochs,placementAudits:async()=>[],tracker:async(candidate,sha)=>{assert.equal(candidate.length,2);assert.equal(sha,s.upload.sourceSha256);return s.tracker;}}};}
test('protected reader brackets source and crosswalk, paginates complete unfiltered endpoints, rejects drift/truncation',async()=>{
 const f=await productSource(),h=readerIO(f),read=io=>createProtectedSourceReader(io,()=>f.now)(new AbortController().signal),source=await read(h.io);
 assert.equal(source.identitySources.devices.length,4);assert.equal(h.calls.filter(p=>p==='cos_mhelp_placement_snapshot').length,2);assert.ok(h.calls.some(p=>p.startsWith('camera_devices?')&&p.includes('monitoring_enabled,monitoring_profile')&&!p.includes('eq.')));
 await assert.rejects(()=>read(readerIO(f,true).io),/changed/);const bad=readerIO(f);bad.io.legacyRead=async()=>Array.from({length:1000},()=>f.source.identitySources.devices[0]);await assert.rejects(()=>read(bad.io),/Truncated/);
});
test('TCP adapter handles success/refusal, rejects technical errors, closes late sockets and aborts pending work',async()=>{
 let closed=0;const signal=()=>new AbortController().signal,success=createSavedTcpProbe(async()=>({close:()=>closed++}));assert.equal((await success('11.22.33.44',80,100,signal())).online,true);assert.equal(closed,1);
 const refused=createSavedTcpProbe(async()=>{throw {name:'ConnectionRefused'};});assert.equal((await refused('11.22.33.44',80,100,signal())).online,false);
 await assert.rejects(()=>createSavedTcpProbe(async()=>{throw {name:'NetworkUnreachable'};})('11.22.33.44',80,100,signal()),/Incomplete/);
 let deliver;const late=createSavedTcpProbe(()=>new Promise(r=>deliver=r));assert.equal((await late('11.22.33.44',80,5,signal())).error,'timeout');deliver({close:()=>closed++});await new Promise(r=>setTimeout(r,1));assert.equal(closed,2);
 const c=new AbortController(),p=createSavedTcpProbe(()=>new Promise(()=>{}))('11.22.33.44',80,100,c.signal);c.abort();await assert.rejects(()=>p,/cancelled/);await assert.rejects(()=>success('localhost',80,100,signal()));
});
test('entrypoint is disabled without any IO; enabled requests still need existing authorization',async()=>{
 let calls=0;const req=()=>new Request('https://fixture.test',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});
 assert.equal((await createProductTcpHandler({bindExistingContext:async()=>{calls++;throw Error();}})(req())).status,503);assert.equal(calls,0);assert.equal((await createProductTcpHandler({enabled:true,bindExistingContext:async()=>null})(req())).status,403);
});

test('two-project source transport pins origin, forwards only existing bearer, validates complete exact groups',async()=>{
 const {createRemoteGroupReader,validateRemoteGroups,createProductProofHandler}=await import('../../supabase/functions/_shared/exact-product-producer/attestationTransport.ts');
 const f=await productSource(),plan=await run(f),envelope={contract:'COS_PRODUCT_TCP_SOURCE_V2',productIds:['101'],...plan};
 let calls=0;const reader=createRemoteGroupReader({proofUrl:'https://native.example.test/product-proof',expectedOrigin:'https://native.example.test',authorization:'Bearer synthetic-user-token',now:()=>f.now,fetch:async(url,init)=>{
  calls++;assert.equal(new URL(url).origin,'https://native.example.test');assert.equal(init.headers.Authorization,'Bearer synthetic-user-token');assert.equal(init.redirect,'error');assert.deepEqual(JSON.parse(init.body),{productIds:['101']});return Response.json(envelope);
 }});
 assert.equal((await reader(['101'],new AbortController().signal)).groups.length,1);assert.equal(calls,1);
 assert.throws(()=>createRemoteGroupReader({proofUrl:'https://foreign.example.test/proof',expectedOrigin:'https://native.example.test',authorization:'Bearer synthetic'}));
 for(const mutate of [v=>v.productIds=['102'],v=>v.groups=[],v=>v.groups[0].devices[0].ip='127.0.0.1',v=>v.groups[0].verifiedAt='2020-01-01Z',v=>v.groups[0].devices.push(v.groups[0].devices[0])]){const v=structuredClone(envelope);mutate(v);assert.throws(()=>validateRemoteGroups(v,['101'],f.now));}
 assert.equal((await createProductProofHandler()(new Request('https://fixture.test'))).status,503);
});
