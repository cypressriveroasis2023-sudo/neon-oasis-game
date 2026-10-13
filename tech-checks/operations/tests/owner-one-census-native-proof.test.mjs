import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerCensusProof,ownerCensusSourceReceipt,readOwnerCensusEvidence,readOwnerCensusProofs,readOwnerCensusJson,preflightOwnerCensusBinding} from '../../supabase/functions/cos-operations-pages/ownerCensusProof.ts';
import {projectFieldGeocodes} from '../../supabase/functions/cos-operations-pages/fieldGeocodeProjection.ts';
import {projectFallbackGeocodes} from '../../supabase/functions/cos-operations-pages/fallbackGeocodeProjection.ts';
import {matchesOwnerCensusSource,createOwnerCensusSourceVerifier} from '../../supabase/functions/camera-field-geocode/ownerCensusSource.ts';
import {addressDigest,normalizeAddress} from '../../supabase/functions/cos-operations-pages/censusAddress.ts';
import {ownerIdentityDigest,ownerConfirmedPhysicalTuple} from '../../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts';
import {verifiedHealthIdentities} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';

const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const uid=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const ID=uid(1),ACTOR=uid(2),KEY='SYNTHETIC UNIT 001',ADDRESS='123 Example Rd, Test City, TX 77002';
const hash='a'.repeat(64),old='2026-10-01T00:00:00Z',moved='2026-10-10T00:00:00Z';
async function fixture(){
 const native={id:ID,organization_id:ORG,model_id:uid(3),unit_number:KEY,serial_number:'SYNTHETIC-NATIVE',status:'available',current_location_type:null,current_location_ref:null,installed_site_id:null,retired_at:null,updated_at:old,gps_latitude:30,gps_longitude:-95,gps_accuracy_m:5,gps_source:'manual',gps_recorded_at:old,gps_recorded_by:ACTOR};
 const device={id:'101',unit_key:KEY,source:'synthetic_provider',device_type:'IPC',external_device_id:'synthetic-external',device_serial:'synthetic-serial'};
 const claim={id:uid(4),organization_id:ORG,native_unit_id:ID,native_unit_label:KEY,legacy_unit_key:KEY,device_ids:['101'],resource_epoch:hash,physical_digest:await ownerIdentityDigest(ownerConfirmedPhysicalTuple(KEY,[device])),provenance:'owner_confirmation',status:'active',revision:'1'};
 const sources={units:[{id:ID,organization_id:ORG,unit_number:KEY,status:'available'}],devices:[device],matches:[],providers:[],audits:[{id:'201',unit_key:KEY,contract:'COS_CAMERA_PLACEMENT_V2',control_id:uid(5),request_id:uid(6),action:'MOVE_TO_FIELD',placement:'FIELD',site_label:'Synthetic site',street_address:ADDRESS,created_at:moved,device_ids:['101']}],ownerCrosswalk:{revision:hash,claims:[claim],nativeEpochs:[{unitId:ID,epoch:hash}]},ownerEpochs:[{unitKey:KEY,epoch:hash,deviceIds:['101']}]};
 const identity=await verifiedHealthIdentities(sources);
 const raw={id:ID,unitNumber:KEY,readOnly:false,_sourceField:false,_placementProof:{note:'historical',owner:true,historyId:uid(7)},status:'field',currentLocationType:null,installedSiteId:null,activeJobNumber:null,address:'100 Old Rd, Test City, TX 77002',site:'Old site',latitude:null,longitude:null,gpsRecordedAt:old,gpsAccuracyM:5,hasUnitGps:true,historicalLatitude:30,historicalLongitude:-95,historicalCoordinateSource:'manual',historicalRecordedAt:old,locationVerification:'coordinates_unverified'};
 const rawSnapshot={items:[],inventoryItems:[raw],generatedAt:moved,summary:{fieldUnits:0}};
 const snapshot=await projectOwnerPlacement(rawSnapshot,sources.audits,sources.devices,identity,sources.units);
 const record={auditId:'201',unitKey:KEY,address:ADDRESS,addressSha256:await addressDigest(ADDRESS),censusOnly:true,censusOnlyState:'ready',censusOnlyGuard:{nativeUnitId:ID,nativeGuardSha256:hash},status:'no_match',reason:'no_match',attempts:1};
 const target={native,site:null,history:{items:[{id:uid(7),latitude:30,longitude:-95,accuracyM:5,source:'manual',note:'Historic observation',recordedAt:old,recordedBy:'Synthetic Owner'}]},epochs:[{unitKey:KEY,epoch:hash,deviceIds:['101']}]};
 return {actorId:ACTOR,record,rawSnapshot,snapshot,bundle:{sources,identity},mhelpReceipt:{contract:'COS_MHELP_PLACEMENT_V1',enabled:true,items:[],lastSuccessAt:moved},target};
}
test('complete Owner historical-only source generates exact seven-field proof accepted by worker',async()=>{
 const f=await fixture(),proof=await ownerCensusProof(f);assert.ok(proof);
 assert.deepEqual(Object.keys(proof).sort(),['contract','nativeUnitId','auditId','unitKey','addressSha256','nativeGuardSha256','complete'].sort());
 assert.equal(proof.complete,true);assert.equal(JSON.stringify(proof).includes('Synthetic Owner'),false);assert.equal(JSON.stringify(proof).includes(ADDRESS),false);
 f.record.censusOnlyGuard.nativeGuardSha256=proof.nativeGuardSha256;
 assert.equal(await matchesOwnerCensusSource({...f.snapshot,ownerCensusProofs:[proof]},f.record),true);
});
test('lookup claim/finish metadata, unrelated health and retrieval timestamps do not alter native proof',async()=>{
 const f=await fixture(),expected=await ownerCensusProof(f);
 f.record={...f.record,censusOnlyState:'consumed',status:'success',attempts:2,claimToken:uid(8),geocodedAt:moved,latitude:29,longitude:-94};
 f.rawSnapshot.generatedAt='2026-10-11T00:00:00Z';f.bundle.sources.devices[0].source_status='offline';f.bundle.sources.devices[0].source_last_seen_at=moved;
 f.mhelpReceipt.lastSuccessAt='2026-10-11T00:00:00Z';
 assert.deepEqual(await ownerCensusProof(f),expected);
});
test('draining, ready and consumed share one unchanged native proof',async()=>{
 const f=await fixture(),expected=await ownerCensusProof(f);
 for(const state of ['draining','ready','consumed']){f.record.censusOnlyState=state;f.record.censusOnlyNotBefore='2026-10-12T00:08:00Z';assert.deepEqual(await ownerCensusProof(f),expected);}
});
test('unrelated fleet identity, audit, health and crosswalk changes do not invalidate target',async()=>{
 const f=await fixture(),expected=await ownerCensusProof(f),s=f.bundle.sources;
 s.units.push({id:uid(50),organization_id:ORG,unit_number:'UNRELATED 900',status:'installed'});
 s.devices.push({id:'900',unit_key:'UNRELATED 900',source:'unrelated',device_type:'IPC',device_serial:'other',external_device_id:'other'});
 s.ownerCrosswalk.revision='c'.repeat(64);s.ownerCrosswalk.nativeEpochs.push({unitId:uid(50),epoch:'c'.repeat(64)});
 s.audits.push({...s.audits[0],id:'900',unit_key:'UNRELATED 900',device_ids:['900'],control_id:uid(51),request_id:uid(52)});
 assert.deepEqual(await ownerCensusProof(f),expected);
});
function olderSite(f){
 const site={id:uid(60),organization_id:ORG,name:'Historical site',address_line1:'100 Old Rd',address_line2:null,city:'Test City',state_region:'TX',postal_code:'77002',latitude:30,longitude:-95,updated_at:old};
 Object.assign(f.target.native,{status:'installed',current_location_type:'site',current_location_ref:site.id,installed_site_id:site.id,gps_source:'site'});f.target.site=site;
 f.target.history.items[0].source='site';f.bundle.sources.units[0].status='installed';
 Object.assign(f.rawSnapshot.inventoryItems[0],{status:'installed',currentLocationType:'site',installedSiteId:site.id,historicalCoordinateSource:'site'});
 return f;
}
test('genuine older installed site and historical site GPS remain unchanged and eligible',async()=>{
 const f=olderSite(await fixture()),before=structuredClone(f);assert.ok(await ownerCensusProof(f));assert.deepEqual(f,before);
});
test('old site may have no stored site coordinates while its unique historical GPS counterpart remains intact',async()=>{
 const f=olderSite(await fixture());f.target.site.latitude=null;f.target.site.longitude=null;
 const before=structuredClone(f);assert.ok(await ownerCensusProof(f));assert.deepEqual(f,before);
});
test('missing history counterpart remains denied for arbitrary manual GPS or a conflicting same-time row',async()=>{
 const f=await fixture();f.target.history.items=[];assert.equal(await ownerCensusProof(f),null);
 const g=olderSite(await fixture());g.target.history.items[0].latitude=31;assert.equal(await ownerCensusProof(g),null);
 const h=olderSite(await fixture());h.target.history.items=[];assert.equal(await ownerCensusProof(h),null);
});
for(const [name,change] of [
 ['new site authority',f=>{f.target.site.updated_at=moved;}],
 ['new native site binding',f=>{f.target.native.updated_at=moved;}],
 ['site/reference mismatch',f=>{f.target.native.current_location_ref=uid(61);} ],
 ['site GPS mismatch',f=>{f.target.site.latitude=31;}],
 ['partial site GPS',f=>{f.target.site.longitude=null;}],
 ['missing site evidence',f=>{f.target.site=null;}],
])test(name+' cannot masquerade as historical installed evidence',async()=>{const f=olderSite(await fixture());change(f);assert.equal(await ownerCensusProof(f),null);});
test('private offline bootstrap uses the same canonical helper without a placeholder policy',async()=>{
 const f=olderSite(await fixture()),expected=await ownerCensusProof(f),now=Date.parse('2026-10-12T00:00:00Z');
 const {record,...inputs}=f,binding={nativeUnitId:ID,auditId:record.auditId,unitKey:record.unitKey,addressSha256:record.addressSha256};
 const authorization={contract:'COS_CURRENT_OWNER_READ_AUTHORIZATION_V1',actorId:ACTOR,organizationId:ORG,role:'owner',active:true,equipmentView:true,verifiedAt:new Date(now).toISOString(),history:{actorId:ACTOR,nativeUnitId:ID,authorized:true,complete:true}};
 for(const invalidClock of [undefined,NaN,Infinity])assert.equal((await preflightOwnerCensusBinding({...inputs,binding,authorization},invalidClock)).eligible,false);
 const result=await preflightOwnerCensusBinding({...inputs,binding,authorization},now);assert.equal(result.eligible,true);assert.equal(result.nativeGuardSha256,expected.nativeGuardSha256);
 assert.deepEqual(Object.keys(result).sort(),['eligible','nativeGuardSha256','nativeSourceSha256','identity','history','placement'].sort());
 for(const changed of [null,{...authorization,role:'it'},{...authorization,actorId:uid(99)},{...authorization,verifiedAt:'2026-10-11T23:58:00Z'},{...authorization,history:{...authorization.history,authorized:false}}])assert.equal((await preflightOwnerCensusBinding({...inputs,binding,authorization:changed},now)).eligible,false);
});
for(const [name,change] of [
 ['authorizing Owner',f=>{f.actorId=uid(9);}],
 ['native update revision',f=>{f.target.native.updated_at='2026-10-02T00:00:00Z';}],
 ['native GPS recorder',f=>{f.target.native.gps_recorded_by=uid(9);}],
 ['additional older history',f=>{f.target.history.items.push({...f.target.history.items[0],id:uid(10),recordedAt:'2026-09-01T00:00:00Z'});}],
 ['old history note',f=>{f.target.history.items[0].note='Changed historical note';}],
 ['physical incarnation',f=>{f.target.epochs[0].epoch='b'.repeat(64);}],
])test(name+' changes the canonical native commitment',async()=>{
 const f=await fixture(),before=await ownerCensusProof(f);change(f);const after=await ownerCensusProof(f);assert.ok(after);assert.notEqual(after.nativeGuardSha256,before.nativeGuardSha256);
});
for(const [name,change] of [
 ['partial GPS',f=>{f.target.native.gps_longitude=null;}],
 ['missing native field',f=>{delete f.target.native.gps_recorded_by;}],
 ['new GPS',f=>{f.target.native.gps_recorded_at=moved;}],
 ['new history',f=>{f.target.history.items.push({...f.target.history.items[0],id:uid(10),recordedAt:moved});}],
 ['duplicate history',f=>{f.target.history.items.push({...f.target.history.items[0]});}],
 ['missing history',f=>{f.target.history={};}],
 ['installed site',f=>{f.target.native.installed_site_id=uid(11);}],
 ['native current location',f=>{f.target.native.current_location_ref=uid(11);}],
 ['native field authority',f=>{f.target.native.current_location_type='field';}],
 ['retirement',f=>{f.target.native.retired_at=moved;}],
 ['current Owner GPS',f=>{f.snapshot.inventoryItems[0].locationVerification='owner_verified';}],
 ['related mHelp authority',f=>{f.mhelpReceipt.items.push({nativeUnitId:ID});}],
 ['missing mHelp completeness',f=>{f.mhelpReceipt=null;}],
 ['identity warning',f=>{f.bundle.identity.identityWarnings.push({unitId:ID,deviceIds:['101'],unitKeys:[KEY]});}],
 ['changed source roster',f=>{f.bundle.sources.devices.push({...f.bundle.sources.devices[0],id:'102'});}],
 ['missing epoch',f=>{f.target.epochs=[];}],
 ['missing audit',f=>{f.bundle.sources.audits=[];}],
])test(name+' refuses complete native proof',async()=>{const f=await fixture();change(f);assert.equal(await ownerCensusProof(f),null);});
test('two independent target reads must agree; unavailable reads do not become empty history',async()=>{
 const f=await fixture(),input={...f,records:[f.record]},reads=[];
 const yes=await readOwnerCensusProofs({...input,readTarget:async id=>{reads.push(id);return structuredClone(f.target);}});assert.equal(yes.length,1);assert.deepEqual(reads,[ID,ID]);
 let count=0;assert.deepEqual(await readOwnerCensusProofs({...input,readTarget:async()=>{const value=structuredClone(f.target);if(count++)value.native.updated_at=moved;return value;}}),[]);
 assert.deepEqual(await readOwnerCensusProofs({...input,readTarget:async()=>{throw Error('denied');}}),[]);
 assert.deepEqual(await readOwnerCensusProofs({...input,records:[],readTarget:async()=>{throw Error('unexpected');}}),[]);
});
test('saved success is independently held after native drift, with no fallback replacement',async()=>{
 const f=await fixture(),proof=await ownerCensusProof(f);f.record.censusOnlyGuard.nativeGuardSha256=proof.nativeGuardSha256;
 const success={...f.record,status:'success',latitude:29,longitude:-94,matchedAddress:ADDRESS,geocodedAt:moved};
 const good=await projectFieldGeocodes({...f.snapshot,ownerCensusProofs:[proof]},[success]);assert.equal(good.items[0].locationGeocode.status,'success');
 const held=await projectFieldGeocodes({...f.snapshot,ownerCensusProofs:[]},[success]);assert.equal(held.items[0].locationGeocode.status,'held');assert.equal(held.items[0].locationGeocode.latitude,undefined);
 const fallback=await projectFallbackGeocodes(held,[{...success,provider:'geocodio',verified:false,liveGps:false,confidence:'estimate'}]);assert.equal(fallback.items[0].locationGeocode.status,'held');
});
test('bounded JSON does not accept oversize, missing, invalid or failed evidence',async()=>{
 assert.deepEqual(await readOwnerCensusJson(new Response('{"items":[]}')),{items:[]});
 for(const response of [new Response('secret',{status:403}),new Response('x'.repeat(20)),new Response('{')])await assert.rejects(()=>readOwnerCensusJson(response,10));
});

// The existing fixed auth-map constants are used only to exercise its unchanged
// boundary; every equipment, history, placement and provider record is synthetic.
const legacyOwner='e4abc521-1ef3-45a6-9829-b87faff78210',nativeOwner='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const request=(path,method='GET',body=null)=>new Request('https://native.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-owner-token','Content-Type':'application/json'},body:JSON.stringify({path,method,body})});
async function routeFixture({historicalSite=false,verifiedIt=false}={}){
 const f=historicalSite?olderSite(await fixture()):await fixture();f.actorId=nativeOwner;
 const proof=await ownerCensusProof(f);f.record.censusOnlyGuard.nativeGuardSha256=proof.nativeGuardSha256;
 const sourceReceipt=await ownerCensusSourceReceipt(f);f.record.censusOnlySourceSha256=sourceReceipt.nativeSourceSha256;
 const legacyActor=verifiedIt?'4f7044b5-86b6-411f-8898-39bb64b4ddbc':legacyOwner,nativeActor=verifiedIt?'d0757b64-9623-4adc-afff-21cc7853e88a':nativeOwner;
 const calls=[];let denyHistory=false;let denySite=false;let role=verifiedIt?'it':'owner';let networkFailure=false;let archiveRows=[];let archiveReads=0;let recordReader=null;let recordReads=0;
 const transport=async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,headers:init.headers,body});const json=data=>new Response(JSON.stringify(data));
  if(url.includes('/auth/v1/user'))return json({id:legacyActor});
  if(url.includes('/rest/v1/profiles?'))return json([{user_id:legacyActor,role,active:true,archived_at:null,full_name:verifiedIt?'Teddy Hopper':'Synthetic Owner'}]);
  if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:nativeActor,active:true,department:verifiedIt?'it':'owner',display_name:verifiedIt?'Teddy Hopper':'Synthetic Owner'}]);
  if(url.includes('/rest/v1/user_roles?'))return json([{role_id:uid(90),roles:{code:verifiedIt?'it_technician':'owner',organization_id:ORG}}]);
  if(url.includes('/rpc/appdeploy_unit_location_history'))return denyHistory?new Response('{}',{status:403}):json(f.target.history);
  if(url.includes('/equipment_units?'))return json(url.includes('gps_recorded_by')?[f.target.native]:f.bundle.sources.units);
  if(url.includes('/sites?'))return denySite?new Response('{}',{status:403}):json([f.target.site]);
  if(url.includes('/vision_vigilant_unit_matches?'))return json(f.bundle.sources.matches);
  if(url.includes('/vision_vigilant_devices?'))return json(f.bundle.sources.providers);
  if(url.includes('/camera_devices?'))return json(f.bundle.sources.devices);
  if(url.includes('/rpc/cos_camera_identity_epochs_v1'))return json(f.target.epochs);
  if(url.includes('/rpc/cos_owner_identity_snapshot'))return json(f.bundle.sources.ownerCrosswalk);
  if(url.includes('/rpc/cos_fleet_placement_evidence_v1'))return json(f.bundle.sources.audits);
  if(url.includes('/rpc/appdeploy_field_map_snapshot'))return json(f.rawSnapshot);
  if(url.includes('/rpc/cos_archived_representation_projection'))return json(typeof archiveRows==='function'?archiveRows(archiveReads++):archiveRows);
  if(url.includes('/rpc/cos_mhelp_placement_snapshot'))return json(f.mhelpReceipt);
  if(url.includes('/rpc/cos_field_geocode_read_many'))return json(recordReader?recordReader(recordReads++):[f.record]);
  if(url.includes('/functions/v1/camera-field-geocode')){if(networkFailure)throw Error('secret transport failure');return json({ok:true,results:[{auditId:'201',status:'no_match',censusOnly:true,allowance:'consumed',secret:'discard'}],fallbackResults:[],importedResults:null,censusOnly:true,allowance:'consumed',secret:'discard'});}
  if(url.includes('/rpc/'))return json([]);
  throw Error('Unexpected route: '+url);
 };
 const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-service',fetch:transport,mhelpPlacementEnabled:true});
 return {f,proof,sourceReceipt,nativeActor,calls,handler,records:value=>{recordReader=value;recordReads=0;},archives:value=>{archiveRows=value;archiveReads=0;},deny:()=>{denyHistory=true;},denySite:()=>{denySite=true;},role:value=>{role=value;},networkFail:()=>{networkFailure=true;}};
}
test('actor map producer, worker verifier and Owner forward route share exact proof contract',async()=>{
 const t=await routeFixture(),response=await t.handler(request('/api/field-map')),map=await response.json();assert.equal(response.status,200);assert.deepEqual(map.ownerCensusProofs,[t.proof]);
 assert.equal(await matchesOwnerCensusSource(map,t.f.record),true);assert.equal(map.items[0].locationGeocode.censusOnlyState,'ready');
 const body={auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256};
 const forwarded=await t.handler(request('/api/field-map/'+ID+'/owner-census-once','POST',body));assert.equal(forwarded.status,200,await forwarded.clone().text());
 assert.equal((await forwarded.text()).includes('secret'),false);
 const calls=t.calls.filter(c=>c.url.includes('/functions/v1/camera-field-geocode'));assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{auditId:'201',unitKey:KEY});assert.equal(calls[0].headers.Authorization,'Bearer synthetic-owner-token');
 assert.ok(t.calls.filter(c=>c.url.includes('gps_recorded_by')).every(c=>c.url.includes('&id=eq.'+ID+'&limit=2')));
 assert.equal(t.calls.some(c=>c.url.includes('/rest/v1/equipment_unit_location_history')),false);
});
test('Owner history permission failure yields no proof or provider forwarding',async()=>{
 const t=await routeFixture();t.deny();const response=await t.handler(request('/api/field-map'));assert.equal(response.status,200);const map=await response.json();assert.deepEqual(map.ownerCensusProofs,[]);assert.equal(map.items[0].locationGeocode.status,'held');
 assert.equal(t.calls.some(c=>c.url.includes('gps_recorded_by')),false);
 const body={auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256};
 assert.equal((await t.handler(request('/api/field-map/'+ID+'/owner-census-once','POST',body))).status,409);
 assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
test('old installed site uses only existing-authorized exact selected read and never exposes new raw fields',async()=>{
 const t=await routeFixture({historicalSite:true}),response=await t.handler(request('/api/field-map')),map=await response.json();assert.equal(response.status,200);assert.equal(map.ownerCensusProofs.length,1);
 const sites=t.calls.filter(c=>c.url.includes('/sites?'));assert.equal(sites.length,2);assert.ok(sites.every(c=>c.url.includes('&organization_id=eq.'+ORG+'&id=eq.'+uid(60)+'&limit=2')));
 assert.equal(JSON.stringify(map).includes('Historical site'),false);assert.equal(JSON.stringify(map).includes('SYNTHETIC-NATIVE'),false);
});
test('exact site permission denial withholds proof without a bypass read or provider call',async()=>{
 const t=await routeFixture({historicalSite:true});t.denySite();const response=await t.handler(request('/api/field-map')),map=await response.json();assert.equal(response.status,200);assert.deepEqual(map.ownerCensusProofs,[]);assert.equal(map.items[0].locationGeocode.status,'held');
 assert.equal(t.calls.filter(c=>c.url.includes('/sites?')).length,1);assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
test('forged/stale binding, read request and non-Owner cannot invoke forward route',async()=>{
 const t=await routeFixture(),path='/api/field-map/'+ID+'/owner-census-once',body={auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256};
 assert.equal((await t.handler(request(path))).status,405);
 assert.equal((await t.handler(request(path,'POST',{...body,nativeGuardSha256:'f'.repeat(64)}))).status,409);
 assert.equal((await t.handler(request(path,'POST',{...body,actorId:nativeOwner}))).status,400);
 t.role('service');assert.equal((await t.handler(request(path,'POST',body))).status,403);
 assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
test('uncertain forwarding network failure preserves unknown allowance with readback-only message',async()=>{
 const t=await routeFixture();t.networkFail();const body={auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256};
 const response=await t.handler(request('/api/field-map/'+ID+'/owner-census-once','POST',body));assert.equal(response.status,503);const result=await response.json();assert.equal(result.censusOnly,true);assert.equal(result.allowance,'unknown');assert.match(result.error,/Refresh/);assert.doesNotMatch(result.error,/retry|secret/i);
});
test('draining and consumed policy never forward another request',async()=>{
 for(const state of ['draining','consumed']){const t=await routeFixture();t.f.record.censusOnlyState=state;const body={auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256};
 assert.equal((await t.handler(request('/api/field-map/'+ID+'/owner-census-once','POST',body))).status,409);assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);}
});


test('full source receipt is actor-independent while execution remains authorizing-Owner bound',async()=>{
 const f=olderSite(await fixture()),proof=await ownerCensusProof(f),receipt=await ownerCensusSourceReceipt(f);
 f.record.censusOnlyGuard.nativeGuardSha256=proof.nativeGuardSha256;f.record.censusOnlySourceSha256=receipt.nativeSourceSha256;
 f.actorId=uid(98);const otherProof=await ownerCensusProof(f),otherReceipt=await ownerCensusSourceReceipt(f);
 assert.notEqual(otherProof.nativeGuardSha256,proof.nativeGuardSha256);assert.deepEqual(otherReceipt,receipt);
 assert.equal(await matchesOwnerCensusSource({...f.snapshot,ownerCensusProofs:[otherProof]},f.record),false);
 const ready=await projectFieldGeocodes({...f.snapshot,ownerCensusProofs:[otherProof]},[f.record],false,[otherReceipt]);assert.equal(ready.items[0].locationGeocode.status,'held');
 f.record.censusOnlyState='consumed';f.record.status='success';f.record.latitude=29;f.record.longitude=-94;
 const shared=await projectFieldGeocodes({...f.snapshot,ownerCensusProofs:[otherProof]},[f.record],false,[otherReceipt]);assert.equal(shared.items[0].locationGeocode.status,'success');assert.equal(shared.items[0].locationGeocode.censusOnlyGuard,undefined);
 assert.equal(JSON.stringify(shared).includes('nativeSourceSha256'),false);
});
const sharedHiddenDrifts=[
 ['model ID',f=>{f.target.native.model_id=uid(91);} ],
 ['native serial',f=>{f.target.native.serial_number='changed';}],
 ['native updated time',f=>{f.target.native.updated_at='2026-10-02T00:00:00Z';}],
 ['native reference',f=>{f.target.native.current_location_ref=uid(91);}],
 ['retired time',f=>{f.target.native.retired_at=old;}],
 ['native GPS recorder',f=>{f.target.native.gps_recorded_by=uid(91);}],
 ['partial GPS pair',f=>{f.target.native.gps_latitude=null;}],
 ['site update time',f=>{f.target.site.updated_at='2026-10-02T00:00:00Z';}],
 ['hidden site coordinates',f=>{f.target.site.latitude=null;f.target.site.longitude=null;}],
 ['site address component boundary',f=>{f.target.site.address_line1='100 Old';f.target.site.address_line2='Rd';}],
 ['older history insert',f=>{f.target.history.items.push({...f.target.history.items[0],id:uid(92),recordedAt:'2026-09-01T00:00:00Z'});}],
 ['history ID',f=>{f.target.history.items[0].id=uid(92);}],
 ['history coordinates',f=>{f.target.history.items[0].latitude=31;}],
 ['history accuracy',f=>{f.target.history.items[0].accuracyM=7;}],
 ['history source',f=>{f.target.history.items[0].source='manual';}],
 ['history note tail',f=>{f.target.history.items[0].note+='\nchanged tail';}],
 ['history timestamp',f=>{f.target.history.items[0].recordedAt='2026-10-02T00:00:00Z';}],
 ['history display author',f=>{f.target.history.items[0].recordedBy='Changed synthetic author';}],
 ['camera incarnation',f=>{f.target.epochs[0].epoch='c'.repeat(64);}],
];
for(const [name,change] of sharedHiddenDrifts)test('shared saved success withheld after '+name+' drift invisible to a reduced map receipt',async()=>{
 const f=olderSite(await fixture()),receipt=await ownerCensusSourceReceipt(f);f.record.censusOnlySourceSha256=receipt.nativeSourceSha256;f.record.censusOnlyState='consumed';f.record.status='success';f.record.latitude=29;f.record.longitude=-94;
 change(f);const changed=await ownerCensusSourceReceipt(f);
 const map=await projectFieldGeocodes({...f.snapshot,ownerCensusProofs:[]},[f.record],false,changed?[changed]:[]);
 assert.equal(map.items[0].locationGeocode.status,'held');assert.equal(map.items[0].locationGeocode.latitude,undefined);
});
test('source receipt binding must be exact, unique and persisted',async()=>{
 const f=await fixture(),receipt=await ownerCensusSourceReceipt(f);f.record.censusOnlySourceSha256=receipt.nativeSourceSha256;f.record.censusOnlyState='consumed';f.record.status='success';
 for(const receipts of [[],[receipt,receipt],[{...receipt,nativeUnitId:uid(92)}],[{...receipt,auditId:'202'}],[{...receipt,unitKey:'OTHER'}],[{...receipt,addressSha256:'b'.repeat(64)}],[{...receipt,complete:false}],[{...receipt,extra:true}]]){
  const map=await projectFieldGeocodes(f.snapshot,[f.record],false,receipts);assert.equal(map.items[0].locationGeocode.status,'held');
 }
 delete f.record.censusOnlySourceSha256;assert.equal((await projectFieldGeocodes(f.snapshot,[f.record],false,[receipt])).items[0].locationGeocode.status,'held');
});
for(const verifiedIt of [false,true])test((verifiedIt?'verified IT':'Owner')+' reads shared consumed success under its own actor without source receipt or raw history disclosure',async()=>{
 const t=await routeFixture({historicalSite:true,verifiedIt});Object.assign(t.f.record,{censusOnlyState:'consumed',status:'success',latitude:29,longitude:-94});
 const response=await t.handler(request('/api/field-map')),map=await response.json();assert.equal(response.status,200);assert.equal(map.items[0].locationGeocode.status,'success');
 assert.ok(t.calls.filter(c=>c.url.includes('/rpc/appdeploy_unit_location_history')).every(c=>c.body.p_actor_user_id===t.nativeActor));
 const text=JSON.stringify(map);for(const hidden of ['nativeSourceSha256','censusOnlySourceSha256','Historic observation','Synthetic Owner','SYNTHETIC-NATIVE','gps_recorded_by'])assert.equal(text.includes(hidden),false);
 if(verifiedIt){assert.deepEqual(map.ownerCensusProofs,[]);assert.equal(map.items[0].locationGeocode.censusOnlyGuard,undefined);
  const path='/api/field-map/'+ID;assert.equal((await t.handler(request(path+'/history'))).status,403);
  assert.equal((await t.handler(request(path+'/owner-census-once','POST',{auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256}))).status,403);
 }
 assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
for(const kind of ['history','site'])test('verified IT '+kind+' permission denial withholds shared success without impersonation or fallback',async()=>{
 const t=await routeFixture({historicalSite:true,verifiedIt:true});Object.assign(t.f.record,{censusOnlyState:'consumed',status:'success',latitude:29,longitude:-94});if(kind==='history')t.deny();else t.denySite();
 const response=await t.handler(request('/api/field-map')),map=await response.json();assert.equal(response.status,200);assert.equal(map.items[0].locationGeocode.status,'held');assert.equal(map.items[0].locationGeocode.latitude,undefined);assert.deepEqual(map.ownerCensusProofs,[]);
 assert.ok(t.calls.filter(c=>c.url.includes('/rpc/appdeploy_unit_location_history')).every(c=>c.body.p_actor_user_id===t.nativeActor));
 assert.equal(t.calls.some(c=>c.url.includes('/rest/v1/equipment_unit_location_history')),false);
});


test('narrow proof route matches full map and unchanged canonical proof without unrelated lookup hydration',async()=>{
 const t=await routeFixture({historicalSite:true}),body={auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256};
 const response=await t.handler(request('/api/field-map/'+ID+'/owner-census-proof','POST',body)),map=await response.json();assert.equal(response.status,200,JSON.stringify(map));
 assert.equal(await matchesOwnerCensusSource(map,t.f.record),true);assert.deepEqual(map.ownerCensusProofs,[t.proof]);
 assert.deepEqual(Object.keys(map).sort(),['placementProjectionVersion','ownerCensusProofs','nativePlacementAliases','items','inventoryItems'].sort());
 const keys=['id','unitNumber','readOnly','placementSource','placement','status','currentLocationType','placementAuditId','placementUnitKey','address','locationVerification'].sort();
 assert.deepEqual(Object.keys(map.items[0]).sort(),keys);assert.deepEqual(map.items,map.inventoryItems);
 const text=JSON.stringify(map);for(const hidden of ['Historic observation','Synthetic Owner','gps_recorded_by','Historical site','SYNTHETIC-NATIVE','censusOnlySourceSha256'])assert.equal(text.includes(hidden),false);
 assert.equal(t.calls.some(c=>/cos_imported_geocode_read_many|cos_field_geocode_fallback_read_many|source_recorded|camera-field-geocode/.test(c.url)),false);
 assert.equal(t.calls.filter(c=>c.url.includes('/rpc/cos_field_geocode_read_many')).length,1);assert.deepEqual(t.calls.find(c=>c.url.includes('/rpc/cos_field_geocode_read_many')).body.p_audit_ids,['201']);
 assert.equal(t.calls.filter(c=>c.url.includes('/rpc/appdeploy_unit_location_history')).length,2);
 assert.equal(t.calls.filter(c=>c.url.includes('/rpc/cos_archived_representation_projection')).length,2);
 const full=await (await t.handler(request('/api/field-map'))).json();assert.deepEqual(map.ownerCensusProofs,full.ownerCensusProofs);assert.deepEqual(map.nativePlacementAliases,full.nativePlacementAliases);
});
test('real worker verifier consumes narrow native handler with normalized legacy address and untouched Owner text',async()=>{
 const t=await routeFixture({historicalSite:true}),original='123  Example Rd, Test  City, TX  77002';
 t.f.bundle.sources.audits[0].street_address=original;
 t.f.snapshot=await projectOwnerPlacement(t.f.rawSnapshot,t.f.bundle.sources.audits,t.f.bundle.sources.devices,t.f.bundle.identity,t.f.bundle.sources.units);
 t.f.record.address=normalizeAddress(original);t.f.record.addressSha256=await addressDigest(original);
 const proof=await ownerCensusProof(t.f);assert.ok(proof);t.f.record.censusOnlyGuard.nativeGuardSha256=proof.nativeGuardSha256;
 const read=createOwnerCensusSourceVerifier(async(url,init)=>t.handler(new Request(url,init)));
 assert.equal(await read(t.f.record,'Bearer synthetic-owner-token'),true);assert.equal(t.f.bundle.sources.audits[0].street_address,original);assert.equal(t.f.snapshot.items[0].address,original);
 assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
for(const verifiedIt of [false,true])test('narrow proof route rejects '+(verifiedIt?'verified IT actor':'forged or read-only requests'),async()=>{
 const t=await routeFixture({verifiedIt}),path='/api/field-map/'+ID+'/owner-census-proof',body={auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256};
 if(verifiedIt){assert.equal((await t.handler(request(path,'POST',body))).status,403);assert.equal(t.calls.some(c=>c.url.includes('/rpc/appdeploy_unit_location_history')),false);}
 else{assert.equal((await t.handler(request(path))).status,405);assert.equal((await t.handler(request(path,'POST',{...body,actorId:nativeOwner}))).status,400);assert.equal((await t.handler(request(path,'POST',{...body,nativeGuardSha256:'f'.repeat(64)}))).status,409);}
 assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
for(const when of ['initial','fresh'])test('narrow proof preserves '+when+' archive conflict denial from final Field Map',async()=>{
 const t=await routeFixture({historicalSite:true}),archive={contract:'COS_ARCHIVED_REPRESENTATION_V1',organizationId:ORG,state:'conflict',provenance:'postgres_admin_reviewed_source_archive',recordedByDatabaseRole:'postgres',id:uid(71),revision:uid(72),archivedNativeId:uid(73),canonicalNativeId:ID,archivedTrackerId:uid(74),canonicalTrackerId:uid(75),reviewSha256:hash,evidenceSha256:hash,beforeSha256:hash,archivedUnitNumber:'OLD SYNTHETIC',canonicalUnitNumber:KEY};
 t.archives(n=>when==='initial'?(n===0?[archive]:[]):(n===0?[]:[archive]));
 const body={auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256};
 assert.equal((await t.handler(request('/api/field-map/'+ID+'/owner-census-proof','POST',body))).status,409);
 assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
test('narrow proof rejects history denial and current source drift after policy read',async()=>{
 const t=await routeFixture(),body={auditId:'201',unitKey:KEY,addressSha256:t.proof.addressSha256,nativeGuardSha256:t.proof.nativeGuardSha256};t.deny();
 assert.equal((await t.handler(request('/api/field-map/'+ID+'/owner-census-proof','POST',body))).status,409);
 const changed=await routeFixture();changed.f.target.native.updated_at='2026-10-02T00:00:00Z';
 assert.equal((await changed.handler(request('/api/field-map/'+ID+'/owner-census-proof','POST',body))).status,409);
});

for(const verifiedIt of [false,true])for(const [name,change] of sharedHiddenDrifts)test((verifiedIt?'IT':'Owner')+' shared handler withholds '+name+' drift',async()=>{
 const t=await routeFixture({historicalSite:true,verifiedIt});Object.assign(t.f.record,{censusOnlyState:'consumed',status:'success',latitude:29,longitude:-94});change(t.f);
 const response=await t.handler(request('/api/field-map')),map=await response.json();assert.equal(response.status,200);const item=map.items.find(r=>r.id===ID);if(item){assert.equal(item.locationGeocode.status,'held');assert.equal(item.locationGeocode.latitude,undefined);}else{assert.equal(map.inventoryItems.find(r=>r.id===ID)?.placementStatus,'needs_identity_review');}
 assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
test('source receipt ignores viewer and lookup lifecycle while preserving exact full source binding',async()=>{
 const f=await fixture(),receipt=await ownerCensusSourceReceipt(f);
 f.actorId=uid(94);Object.assign(f.record,{censusOnlyState:'consumed',status:'success',attempts:2,latitude:29,longitude:-94,geocodedAt:moved});
 assert.deepEqual(await ownerCensusSourceReceipt(f),receipt);
 const evidence=await readOwnerCensusEvidence({...f,records:[f.record],readTarget:async()=>structuredClone(f.target)},false);assert.deepEqual(evidence.proofs,[]);assert.deepEqual(evidence.receipts,[receipt]);
});

function preparation(t){
 delete t.f.record.censusOnly;delete t.f.record.censusOnlyGuard;delete t.f.record.censusOnlyState;delete t.f.record.censusOnlySourceSha256;
 Object.assign(t.f.record,{status:'invalid_address',censusPreparation:{nativeUnitId:ID}});
 return {path:'/api/field-map/'+ID+'/owner-census-prepare',body:{auditId:t.f.record.auditId,unitKey:t.f.record.unitKey,addressSha256:t.f.record.addressSha256}};
}
test('exact Owner preparation marker produces only two canonical digests without an enrolled placeholder or provider side effect',async()=>{
 const t=await routeFixture({historicalSite:true}),p=preparation(t),before=structuredClone(t.f),started=Date.now();
 const response=await t.handler(request(p.path,'POST',p.body));assert.equal(response.status,200,await response.clone().text());
 const result=await response.json();assert.deepEqual(Object.keys(result).sort(),['eligible','nativeGuardSha256','nativeSourceSha256','preparedAt'].sort());
 const {preparedAt,...digests}=result;assert.deepEqual(digests,{eligible:true,nativeGuardSha256:t.proof.nativeGuardSha256,nativeSourceSha256:t.sourceReceipt.nativeSourceSha256});
 assert.equal(new Date(preparedAt).toISOString(),preparedAt);assert.ok(Date.parse(preparedAt)>=started&&Date.parse(preparedAt)<=Date.now());
 assert.deepEqual(t.f,before);assert.equal(t.calls.filter(c=>c.url.includes('/rpc/appdeploy_unit_location_history')).length,2);
 assert.equal(t.calls.filter(c=>c.url.includes('/rpc/cos_field_geocode_read_many')).length,2);
 assert.equal(t.calls.some(c=>/geocoding.geo.census.gov|geocodio|camera-field-geocode|cos_field_geocode_claim|cos_field_geocode_finish|cos_imported_geocode_read_many|cos_field_geocode_fallback_read_many/.test(c.url)),false);
 assert.ok(t.calls.filter(c=>c.url.includes('/rpc/cos_camera_identity_epochs_v1')).every(c=>c.headers.Authorization==='Bearer synthetic-owner-token'));
 const map=await (await t.handler(request('/api/field-map'))).json();assert.deepEqual(map.items[0].locationGeocode.censusPreparation,{nativeUnitId:ID});assert.equal(map.items[0].locationGeocode.censusOnly,undefined);
});
for(const [name,change] of [
 ['missing marker',r=>{delete r.censusPreparation;}],['different native ID',r=>{r.censusPreparation.nativeUnitId=uid(98);}],
 ['extra marker field',r=>{r.censusPreparation.extra=true;}],['unrelated audit',r=>{r.auditId='999';}],['different full address',r=>{r.addressSha256='f'.repeat(64);}],
 ['success cache',r=>{r.status='success';}],['no-match cache',r=>{r.status='no_match';}],['pending cache',r=>{r.status='pending';}],
 ['real policy',r=>{r.censusOnly=true;}],['guard placeholder',r=>{r.censusOnlyGuard={nativeUnitId:ID,nativeGuardSha256:hash};}],['allowance placeholder',r=>{r.censusOnlyState='ready';}],
])test('preparation denies '+name+' before extra target reads',async()=>{
 const t=await routeFixture(),p=preparation(t);change(t.f.record);
 assert.equal((await t.handler(request(p.path,'POST',p.body))).status,409);assert.equal(t.calls.some(c=>c.url.includes('/rpc/appdeploy_unit_location_history')),false);
 assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
test('preparation requires exact three-field body and cannot invoke the four-field execution routes',async()=>{
 const t=await routeFixture(),p=preparation(t);
 for(const body of [{...p.body,nativeGuardSha256:hash},{...p.body,actorId:nativeOwner},{...p.body,address:ADDRESS},{auditId:p.body.auditId,unitKey:p.body.unitKey}])assert.equal((await t.handler(request(p.path,'POST',body))).status,400);
 assert.equal((await t.handler(request(p.path))).status,405);
 for(const suffix of ['owner-census-proof','owner-census-once'])assert.equal((await t.handler(request('/api/field-map/'+ID+'/'+suffix,'POST',{...p.body,nativeGuardSha256:t.proof.nativeGuardSha256}))).status,409);
 assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
test('verified IT cannot see preparation metadata or invoke preparation even if a malformed upstream returns its marker',async()=>{
 const t=await routeFixture({verifiedIt:true}),p=preparation(t);
 const response=await t.handler(request('/api/field-map'));assert.equal(response.status,200);const map=await response.json();assert.equal(map.items[0].locationGeocode.censusPreparation,undefined);
 t.calls.length=0;assert.equal((await t.handler(request(p.path,'POST',p.body))).status,403);assert.equal(t.calls.some(c=>c.url.includes('/rpc/appdeploy_unit_location_history')),false);
});
for(const mode of ['marker revoked','cache changed','policy enrolled'])test('preparation rechecks '+mode+' after source reads',async()=>{
 const t=await routeFixture(),p=preparation(t),changed=structuredClone(t.f.record);
 if(mode==='marker revoked')delete changed.censusPreparation;if(mode==='cache changed')changed.attempts++;if(mode==='policy enrolled')changed.censusOnly=true;
 t.records(n=>n===0?[t.f.record]:[changed]);assert.equal((await t.handler(request(p.path,'POST',p.body))).status,409);
 assert.equal(t.calls.filter(c=>c.url.includes('/rpc/appdeploy_unit_location_history')).length,2);assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
for(const mode of ['history','site','new GPS','archive'])test('preparation fails closed for '+mode+' uncertainty or conflict',async()=>{
 const t=await routeFixture({historicalSite:true}),p=preparation(t);
 if(mode==='history')t.deny();if(mode==='site')t.denySite();if(mode==='new GPS')t.f.target.native.gps_recorded_at=moved;
 if(mode==='archive')t.archives([{contract:'COS_ARCHIVED_REPRESENTATION_V1',organizationId:ORG,state:'conflict',provenance:'postgres_admin_reviewed_source_archive',recordedByDatabaseRole:'postgres',id:uid(71),revision:uid(72),archivedNativeId:uid(73),canonicalNativeId:ID,archivedTrackerId:uid(74),canonicalTrackerId:uid(75),reviewSha256:hash,evidenceSha256:hash,beforeSha256:hash,archivedUnitNumber:'OLD SYNTHETIC',canonicalUnitNumber:KEY}]);
 assert.equal((await t.handler(request(p.path,'POST',p.body))).status,409);assert.equal(t.calls.some(c=>c.url.includes('/functions/v1/camera-field-geocode')),false);
});
