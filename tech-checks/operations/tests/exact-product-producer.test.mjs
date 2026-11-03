import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT,planExactProductChecks} from '../../supabase/functions/_shared/exact-product-producer/model.ts';
import {collectExactProductChecks,LIMITS} from '../../supabase/functions/_shared/exact-product-producer/collector.ts';
import {TRACKER_CONNECTION_CENSUS_V2,TRACKER_IP_WORKBOOK} from '../src/exactProductConnection.ts';
const now=Date.parse('2026-10-28T18:30:00Z'),at=new Date(now).toISOString(),sha='a'.repeat(64);
// Synthetic literals only reach mocks. No network adapter exists.
const ip=n=>[11,22,33,n].join('.');
function fixture(){
 const records=['1','2','3'].map((productId,index)=>({productId,recordId:'mhelp_product:'+productId,placement:index===2?'SHOP':'FIELD',uploadLifecycle:'UNFLAGGED',binding:{state:'unlinked',placementHeld:false,candidateUnitIds:[]}}));
 return {contract:CONTRACT,complete:true,authorityEpoch:'e'.repeat(64),mhelp:{contract:'COS_MHELP_UPLOAD_INVENTORY_V1',source:'mhelpdesk_api',lastApiReadAt:at,countBasis:'mhelp_product_records_not_unique_physical_units',sourceSha256:sha,receivedAt:at,
 summary:{totalRecords:3,fieldRecords:2,shopRecords:1,unflaggedFieldRecords:2,doNotUseRecords:0,missingRecords:0},records},
 tracker:{contract:TRACKER_CONNECTION_CENSUS_V2,workbookId:TRACKER_IP_WORKBOOK,expectedMhelpSourceSha256:sha,trackerSourceSha256:'b'.repeat(64),sourceExport:'ServiceItem_List_20261028183000.csv',verifiedAt:at,
 records:records.map((r,i)=>({...r,publicIp:ip(i+1),sourceRow:i+2,reviewReasons:[]}))},
 endpoints:[1,2,3].map(n=>({deviceId:n,publicIp:ip(n),connectionRevision:4,expectedPorts:[80,443],monitoringEnabled:true,portStatus:null,source:'synthetic_owned_source',monitoringProfile:'synthetic_saved_service',activationState:'active',unitKey:'Synthetic '+n,deviceName:'Synthetic',organization:'Synthetic'})),
 identities:[1,2].map(n=>({contract:'COS_COMMITTED_PRODUCT_DEVICE_V1',productId:String(n),nativeUnitId:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,deviceIds:[String(n)],family:n===1?'Spotter':'Ranger',protocol:'saved_tcp',source:'synthetic_owned_source',monitoringProfile:'synthetic_saved_service',state:'active',admissionRevision:'1',nativeEpoch:'c'.repeat(64),resourceEpoch:'d'.repeat(64),physicalDigest:'f'.repeat(64)}))};
}
const positive={online:true,attempted:true,latency_ms:1},negative={online:false,attempted:true,latency_ms:null,error:'timeout'};
function harness({snapshot=fixture(),mutateFresh,probe=async()=>positive,publish,clock=()=>now}={}){
 let reads=0;const writes=[],probes=[],receipts=new Map();
 const adapters={read:async()=>{const s=structuredClone(snapshot);if(++reads>1)mutateFresh?.(s);return s;},
 probe:async(host,port,timeout,signal)=>{probes.push({host,port,timeout});return probe(host,port,timeout,signal);},
 publishAtomic:async(req,signal)=>{if(publish)return publish(req,signal);const old=receipts.get(req.receiptKey);if(old){assert.equal(old.payloadSha256,req.payloadSha256);return old;}
 const r={ok:true,receiptKey:req.receiptKey,payloadSha256:req.payloadSha256};receipts.set(req.receiptKey,r);writes.push(req);return r;}};
 return {writes,probes,run:(ids=['1'],runId='synthetic_run_0001')=>collectExactProductChecks(adapters,{productIds:ids,runId,now:clock})};
}
test('exact target only; replay receipt is idempotent; each family uses saved TCP ports',async()=>{
 const h=harness();assert.equal((await h.run()).complete,true);assert.equal((await h.run()).complete,true);assert.equal(h.writes.length,1);
 assert.equal(h.writes[0].deviceId,'1');assert.equal(h.writes[0].productId,'1');assert.ok(h.probes.every(p=>p.host===ip(1)));assert.equal(h.writes[0].observation.status,'online');
 for(const family of ['Spotter','Solar Spotter','Ranger']){const s=fixture();s.identities[0].family=family;s.endpoints[0].expectedPorts=[12345];const x=harness({snapshot:s});assert.equal((await x.run()).complete,true);assert.deepEqual(x.probes.map(p=>p.port),[12345]);}
});
test('complete TCP timeout/refusal is Offline; technical/malformed/partial probes never write',async()=>{
 for(const error of ['timeout','Connection refused (os error 111)','Connection timed out (os error 110)']){const h=harness({probe:async()=>({...negative,error})});assert.equal((await h.run()).complete,true);assert.equal(h.writes[0].observation.status,'offline');}
 for(const result of [{...negative,error:'Network unreachable'},{...negative,error:'permission denied'},{...negative,error:'DNS lookup failed'},{...negative,technicalError:true},{...negative,errorCode:'ETIMEDOUT'},{...negative,attempted:false},{...positive,latency_ms:-1},{online:false},{...positive,error:'transport'}]){const h=harness({probe:async()=>result});assert.equal((await h.run()).outcomes[0].reason,'probe_incomplete');assert.equal(h.writes.length,0);}
 const h=harness({probe:async(_,port)=>{if(port===443)throw Error();return positive;}});await h.run();assert.equal(h.writes.length,0);
});
test('complete fresh source, lifecycle, holds and committed identity are mandatory before probing',async()=>{
 const mutations=[s=>s.complete=false,s=>s.authorityEpoch='bad',s=>s.mhelp.source='upload',s=>s.mhelp.lastApiReadAt='2026-10-27T00:00:00Z',s=>s.tracker.verifiedAt='2026-10-27T00:00:00Z',s=>s.tracker.expectedMhelpSourceSha256='f'.repeat(64),s=>s.tracker.records.pop(),s=>s.mhelp.records[0].binding.state='held',s=>s.mhelp.records[0].binding.candidateUnitIds=['foreign'],s=>{s.mhelp.records[0].uploadLifecycle='DO_NOT_USE';s.mhelp.summary.doNotUseRecords=1;s.mhelp.summary.unflaggedFieldRecords=1;},s=>s.tracker.records[0].reviewReasons=['tracker_restriction'],s=>{s.tracker.records[0].placement='SHOP';s.tracker.records[0].reviewReasons=['placement_mismatch'];},s=>s.identities=[],s=>s.identities[0].state='revoked',s=>s.identities[0].contract='PR306_REVIEW_ONLY',s=>s.identities[0].deviceIds=['2'],s=>s.identities[0].family='Sniper',s=>s.identities[0].nativeEpoch='bad',s=>s.identities.push({...s.identities[0],state:'held',productId:'99'})];
 for(const mutate of mutations){const s=fixture();mutate(s);const h=harness({snapshot:s});assert.equal((await h.run()).complete,false,String(mutate));assert.equal(h.probes.length,0,String(mutate));assert.equal(h.writes.length,0);}
});
test('duplicate IP/endpoints and same-unit channels remain held, including disabled/foreign reservations',async()=>{
 for(const mutate of [s=>s.tracker.records[2].publicIp=ip(1),s=>s.endpoints.push({...s.endpoints[0],deviceId:4}),s=>s.endpoints.push({...s.endpoints[0],deviceId:4,monitoringEnabled:false,source:'foreign'}),s=>s.endpoints[1].deviceId=1,s=>s.identities[0].deviceIds=['1','4']]){const s=fixture();mutate(s);const h=harness({snapshot:s});await h.run();assert.equal(h.probes.length,0);assert.equal(h.writes.length,0);}
 const s=fixture();s.endpoints.push(...[4,5,6].map(deviceId=>({...s.endpoints[0],deviceId})));s.identities[0].deviceIds=['1','4','5','6'];const h=harness({snapshot:s});await h.run();assert.equal(h.probes.length,0);
});
test('disabled, terminal, foreign, private/DNS and malformed saved configuration never probes',async()=>{
 for(const mutate of [d=>d.monitoringEnabled=false,d=>d.activationState='retired',d=>d.unitKey='Synthetic DNU',d=>d.organization='DO NOT USE',d=>d.source='foreign',d=>d.monitoringProfile='foreign',d=>d.connectionRevision=-1,d=>d.expectedPorts=[],d=>d.expectedPorts=[80,80],d=>d.expectedPorts=[65536],d=>d.publicIp='10.0.0.1',d=>d.publicIp='localhost',d=>d.publicIp='11.22.33.1/32']){const s=fixture();mutate(s.endpoints[0]);const h=harness({snapshot:s});await h.run();assert.equal(h.probes.length,0,String(mutate));assert.equal(h.writes.length,0);}
});
test('full post-probe reread rejects source/identity/config/revision/port drift and new collisions',async()=>{
 for(const mutateFresh of [s=>s.authorityEpoch='f'.repeat(64),s=>s.tracker.trackerSourceSha256='c'.repeat(64),s=>s.mhelp.sourceSha256='b'.repeat(64),s=>s.endpoints[0].connectionRevision++,s=>s.endpoints[0].expectedPorts=[80],s=>s.endpoints[0].monitoringEnabled=false,s=>s.endpoints[0].activationState='retired',s=>s.identities[0].admissionRevision='2',s=>s.identities[0].resourceEpoch='a'.repeat(64),s=>s.endpoints.push({...s.endpoints[0],deviceId:4}),s=>s.tracker.records[2].publicIp=ip(1)]){const h=harness({mutateFresh});assert.equal((await h.run()).outcomes[0].reason,'source_identity_or_config_changed');assert.equal(h.probes.length,2);assert.equal(h.writes.length,0);}
});
test('atomic CAS rejection holds; lost or invalid receipt stays uncertain without retry',async()=>{
 for(const [publish,state] of [[async req=>({ok:false,receiptKey:req.receiptKey,payloadSha256:req.payloadSha256}),'held'],[async()=>{throw Error('lost');},'publication_uncertain'],[async()=>({ok:true,receiptKey:'wrong'}),'publication_uncertain']]){let calls=0;const h=harness({publish:async(...args)=>{calls++;return publish(...args);}});assert.equal((await h.run()).outcomes[0].state,state);assert.equal(calls,1);}
});
test('deadline prevents incomplete and later-target writes',async()=>{
 let clock=now;const h=harness({clock:()=>clock,probe:async()=>{clock+=LIMITS.runMs;return negative;}});const r=await h.run(['1','2']);assert.equal(r.complete,false);assert.equal(h.writes.length,0);assert.equal(r.outcomes[1].reason,'deadline');
});
test('hung probe aborts and never creates Offline',async()=>{
 let signal;const h=harness({probe:async(_h,_p,_t,s)=>{signal=s;return new Promise(()=>{});}});assert.equal((await h.run()).outcomes[0].reason,'probe_incomplete');assert.equal(h.writes.length,0);assert.equal(signal.aborted,true);
});
test('port concurrency is bounded; publication waits for complete configured set',async()=>{
 const s=fixture();s.endpoints[0].expectedPorts=Array.from({length:16},(_,i)=>10000+i);let active=0,max=0,done=0;
 const h=harness({snapshot:s,probe:async()=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,2));active--;done++;return positive;},publish:async req=>{assert.equal(active,0);assert.equal(done,16);return {ok:true,receiptKey:req.receiptKey,payloadSha256:req.payloadSha256};}});assert.equal((await h.run()).complete,true);assert.equal(max,LIMITS.portWorkers);
});
test('invalid selectors do no IO; Shop is held and non-targets cannot be published',async()=>{
 const h=harness();for(const ids of [[],['01'],['1','1'],Array.from({length:65},(_,i)=>String(i+1))])await assert.rejects(()=>h.run(ids));assert.equal(h.probes.length,0);assert.equal((await h.run(['3'])).complete,false);assert.equal(h.writes.length,0);assert.equal((await planExactProductChecks(fixture(),['1','2'],now)).selected.length,2);
});
