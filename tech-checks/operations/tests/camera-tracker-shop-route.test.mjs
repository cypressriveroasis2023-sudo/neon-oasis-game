import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {fixture,mhelpReceiptFor,clone} from './camera-tracker-shop-fixtures.mjs';
import {ownerIdentityDigest,ownerConfirmedPhysicalTuple} from '../../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts';
const observedAt=new Date(Date.now()-1000).toISOString(); // Generated synthetic time; no live records.
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);reject(Error('Synthetic aborted page'));}signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
// Reuse public authorization constants only in this injected in-memory transport.
const source=readFileSync(new URL('../../supabase/functions/cos-operations-pages/index.ts',import.meta.url),'utf8');
const [ownerId,actorId]=source.match(/const OWNER_LINKS = Object.freeze\(\{\s*'([^']+)': '([^']+)'/).slice(1);
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',json=(body,status=200)=>new Response(JSON.stringify(body),{status});
async function setup(mode='valid'){
 const f=fixture(),calls=[];let sourceReads=0,unitReads=0,cameraReads=0,mapReads=0,mhelpReads=0,active=0,maxActive=0;
 const receipt=mhelpReceiptFor(f);receipt.lastSuccessAt=observedAt;receipt.items[0].observedAt=observedAt;
 const devices=[],crosswalk={revision:'a'.repeat(64),nativeEpochs:[],claims:[]},epochs=[];
 if(mode.startsWith('mhelp-actual')){
  const unitId='77777777-7777-4777-8777-777777777777',trackerId='88888888-8888-4888-8888-888888888888',unit='Ranger 990200';
  f.before.inventory.push({id:unitId,unitNumber:unit,readOnly:false});f.before.nativeUnits.push({id:unitId,unit_number:unit,organization_id:org,status:'available'});
  devices.push({id:990700,unit_key:unit,device_name:'Synthetic provider resource',device_type:'IPC',source:'vigilant_control_center',source_status:'online',source_last_seen_at:observedAt,activation_state:'active',organization:'Synthetic original field',device_serial:'synthetic-physical-990700',external_device_id:'synthetic-external-990700'});
  crosswalk.nativeEpochs.push({unitId,epoch:'b'.repeat(64)});epochs.push({unitKey:unit,epoch:'c'.repeat(64),deviceIds:['990700']});
  crosswalk.claims.push({id:'99999999-9999-4999-8999-999999999999',organization_id:org,native_unit_id:unitId,native_unit_label:unit,legacy_unit_key:unit,device_ids:['990700'],resource_epoch:'c'.repeat(64),physical_digest:await ownerIdentityDigest(ownerConfirmedPhysicalTuple(unit,devices)),provenance:'owner_confirmation',status:'active',revision:'1'});
  receipt.items.push({...receipt.items[0],trackerId,nativeUnitId:unitId,trackerLabel:unit,nativeLabel:unit});
 }
 if(mode.startsWith('page-'))for(let i=1;i<=(['page-slow','page-many','page-slow-failure'].includes(mode)?1250:255);i++){const id='10000000-0000-4000-8000-'+String(i).padStart(12,'0'),unitNumber='Ranger '+(990000+i);f.before.inventory.push({id,unitNumber,readOnly:false});f.before.nativeUnits.push({id,unit_number:unitNumber,organization_id:org,status:'available'});}
 const fetch=async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,method:init.method||'GET',body,signal:init.signal});
  if(url.includes('/auth/v1/user'))return json({id:ownerId});
  if(url.includes('/profiles?'))return json([{user_id:ownerId,full_name:'Fixture owner',role:'owner',active:true,archived_at:null}]);
  if(url.includes('/user_profiles?'))return json([{user_id:actorId,display_name:'Fixture owner',active:true,department:'owner'}]);
  if(url.includes('/user_roles?'))return json([{role_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',roles:{code:'owner',organization_id:org}}]);
  if(url.includes('/equipment_units?')){unitReads++;const rows=mode==='native-change'&&unitReads>1?f.before.nativeUnits.map(r=>({...r,status:'installed'})):f.before.nativeUnits,offset=Number(new URL(url).searchParams.get('offset')||0);return json(rows.slice(offset,offset+1000));}
  if(url.includes('/vision_vigilant_unit_matches?')||url.includes('/vision_vigilant_devices?'))return json([]);
  if(url.includes('/camera_devices?')){cameraReads++;return json(mode==='camera-change'&&cameraReads>1?[{id:99,unit_key:'Helios 990001',device_name:'New synthetic resource',device_type:'IPC',source:'vigilant_control_center',activation_state:'active',source_status:'unknown'}]:devices);}
  if(url.includes('/camera_health_current?'))return json([]);
  if(url.includes('/equipment_master?'))return json(f.tracker);
  if(url.includes('/camera_integrations?'))return json([]);
  if(url.endsWith('/cos_owner_identity_snapshot'))return json(crosswalk);
  if(url.endsWith('/cos_camera_identity_epochs_v1'))return json(epochs);
  if(url.endsWith('/cos_mhelp_placement_snapshot')){
   mhelpReads++;if(mhelpReads>1)assert(init.signal instanceof AbortSignal);
   if(mode==='mhelp-current-failure'&&mhelpReads>1)return json({message:'PRIVATE fixture failure'},503);
   if(mode==='mhelp-null')return json(null);
   const value=clone(receipt);
   if(mode==='mhelp-disabled')value.enabled=false;
   if(mode==='mhelp-mode-change'&&mhelpReads>1)value.enabled=false;
   if(mode==='mhelp-empty'||mode==='mhelp-disappears'&&mhelpReads>1)value.items=[];
   if(mode==='mhelp-field'||mode==='mhelp-changed'&&mhelpReads>1)value.items[0].placement='FIELD';
   if(mode==='mhelp-held')value.items[0].state='held';
   if(mode==='mhelp-stale')value.items[0].observedAt='2001-01-15T12:00:00Z';
   return json(value);
  }
  if(url.endsWith('/cos_fleet_placement_evidence_v1'))return json([]);
  if(url.endsWith('/appdeploy_field_map_snapshot')){mapReads++;return json(mode==='fresh-snapshot-missing'&&mapReads>1?{}:{items:f.before.inventory,inventoryItems:f.before.inventory,summary:{fieldUnits:1}});}
  if(url.endsWith('/cos_geocode_sources_map_projection')){
   sourceReads++;const readNumber=sourceReads;assert(init.signal instanceof AbortSignal);assert.equal(body.p_organization_id,org);assert(body.p_identities.length<=250);assert(body.p_identities.every(r=>r.entityKind==='equipment_unit'&&f.before.inventory.some(v=>v.id===r.nativeUnitId)));
   active++;maxActive=Math.max(maxActive,active);
   try{if(['page-slow','page-slow-failure'].includes(mode))await delay(700,init.signal);else if(mode==='page-many')await delay(readNumber%4,init.signal);}finally{active--;}
   if(mode==='page-slow-failure'&&readNumber===2)return json({message:'Synthetic failed page'},503);
   if(mode==='failure'||mode==='mhelp-actual-failure')return json({message:'Fixture unavailable'},503);
   if(mode==='duplicate')return json([...f.before.sources,...f.before.sources]);
   if(mode==='unexpected')return json([{...f.before.sources[0],nativeUnitId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}]);
   if(mode==='changed'&&sourceReads===2)return json([]);
   if(mode==='page-failure'&&sourceReads===2)return json({message:'Second page unavailable'},503);
   if(mode==='page-unexpected'&&sourceReads===2)return json(f.before.sources);
   if(mode.startsWith('page-')&&!body.p_identities.some(r=>r.nativeUnitId===f.before.sources[0].nativeUnitId))return json([]);
   return json(f.before.sources);
  }
  throw Error('Unexpected fixture route '+url);
 };
 return {calls,stats:()=>({maxActive,sourceReads,mhelpReads}),handler:createOperationsHandler({platformUrl:'https://fixture.example',serviceKey:'synthetic-test-key',fetch,mhelpPlacementEnabled:mode.startsWith('mhelp-')})};
}
const request=(path='/api/camera-health/summary-v3',auth=true)=>new Request('https://fixture.example/functions/v1/cos-operations-pages',{method:'POST',headers:{...(auth?{Authorization:'Bearer synthetic-owner-token'}:{}),'Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path,method:'GET'})});
for(const mode of ['valid','failure','duplicate','unexpected','changed','native-change','camera-change','fresh-snapshot-missing','page-valid','page-failure','page-unexpected'])test('integrated v3 route '+mode+' is bounded read-only and fail-closed',async()=>{
 const {calls,handler}=await setup(mode),response=await handler(request()),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.rows.length,1);assert.equal(result.rows[0].scope,['valid','page-valid'].includes(mode)?'shop':'unknown');assert.equal(result.rows[0].status,'review');assert.equal(result.totalDevices,1);
 const rpc=calls.filter(c=>c.url.includes('/rpc/'));assert(rpc.every(c=>/\/(cos_owner_identity_snapshot|cos_fleet_placement_evidence_v1|appdeploy_field_map_snapshot|cos_geocode_sources_map_projection)$/.test(c.url)));
 assert(calls.every(c=>c.method==='GET'||c.url.includes('/rpc/')));assert(!JSON.stringify(result).includes('sourceRevision'));assert(!JSON.stringify(result).includes('nativeGuardSha256'));
 if(mode==='valid'){assert.equal(calls.filter(c=>c.url.endsWith('/cos_geocode_sources_map_projection')).length,2);assert(calls.filter(c=>c.signal).every(c=>c.signal.aborted));}
});
test('legacy v2 summary contract does not perform the new reads',async()=>{const {calls,handler}=await setup();const response=await handler(request('/api/camera-health/summary-v2')),result=await response.json();assert.equal(response.status,200);assert.equal(result.rows[0].scope,'unknown');assert.equal(calls.some(c=>c.url.endsWith('/cos_geocode_sources_map_projection')),false);});
test('unauthenticated request cannot read optional source proof',async()=>{const {calls,handler}=await setup();assert.equal((await handler(request(undefined,false))).status,401);assert.equal(calls.length,0);});
for(const mode of ['mhelp-valid','mhelp-disabled','mhelp-field','mhelp-held','mhelp-stale','mhelp-empty','mhelp-null','mhelp-changed','mhelp-disappears','mhelp-mode-change','mhelp-current-failure'])test('integrated enabled-receipt guard '+mode,async()=>{
 const {handler,calls,stats}=await setup(mode),response=await handler(request()),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.rows[0].scope,['mhelp-valid','mhelp-disabled'].includes(mode)?'shop':'unknown');assert.equal(stats().mhelpReads,2);assert.equal(calls.filter(c=>c.url.endsWith('/cos_mhelp_placement_snapshot')&&c.signal).every(c=>c.signal.aborted),true);
 assert.equal(JSON.stringify(result).includes('guardCurrent'),false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('HTTP route preserves newer mHelp actual-camera placement and evidence on optional success and fallback',async()=>{
 const results=[];for(const mode of ['mhelp-actual','mhelp-actual-failure']){const {handler}=await setup(mode),response=await handler(request()),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.rows.find(r=>r.trackerOnly).scope,mode==='mhelp-actual'?'shop':'unknown');const camera=result.rows.find(r=>r.id===990700);assert.equal(camera.scope,'shop');assert.equal(camera.evidence.status,'online');results.push({camera,sync:result.mhelpPlacementSync});}assert.deepEqual(results[0],results[1]);
});
test('bounded parallel pages complete within five seconds where serial page latency would exceed it',async()=>{
 const {handler,stats}=await setup('page-slow'),start=performance.now(),response=await handler(request()),result=await response.json(),elapsed=performance.now()-start;
 assert.equal(response.status,200);assert.equal(result.rows[0].scope,'shop');assert.equal(stats().sourceReads,12);assert.equal(stats().maxActive,4);assert(stats().sourceReads*700>5000);assert(elapsed<5000,'bounded parallel read must finish before the unchanged request deadline');
});
test('more than four pages never exceeds four in flight and reversed completion stays deterministic',async()=>{const {handler,stats}=await setup('page-many'),response=await handler(request()),result=await response.json();assert.equal(response.status,200);assert.equal(result.rows[0].scope,'shop');assert.equal(stats().sourceReads,12);assert.equal(stats().maxActive,4);});
test('one failed parallel page denies the entire allowance and aborts remaining work',async()=>{const {handler,calls,stats}=await setup('page-slow-failure'),response=await handler(request()),result=await response.json();assert.equal(response.status,200);assert.equal(result.rows[0].scope,'unknown');assert(stats().maxActive<=4);assert(calls.filter(c=>c.url.endsWith('/cos_geocode_sources_map_projection')).every(c=>c.signal.aborted));});
