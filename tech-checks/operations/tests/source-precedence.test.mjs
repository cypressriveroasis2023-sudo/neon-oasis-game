import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {fixture as nativeFixture,reset as nativeReset,seed,ORG,hash,rpc as nativeRPC} from './fixtures/geocode-sources-database-fixture.mjs';
import {fixture as legacyFixture,reset as legacyReset,OWNER,SERVICE} from './fixtures/geocodio-database-fixture.mjs';
import {sourcePrecedenceAuditSha256} from '../../supabase/functions/_shared/sourcePrecedence.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {sourceDto,createGeocodeSourcesHandler} from '../../supabase/functions/cos-geocode-sources/index.ts';
import {checkedImportedSource,sourceIdentity} from '../../supabase/functions/camera-field-geocode/importedSources.ts';
import {processImportedGeocodes} from '../../supabase/functions/camera-field-geocode/importedGeocodeSweep.ts';
import {projectImportedSourceAddresses,projectImportedGeocodes,checkedImportedBinding} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
globalThis.crypto??=webcrypto;
let native,legacy;
const replacedFunctions=['app_private.cos_imported_lock_binding(uuid,jsonb)','public.cos_imported_geocode_sync(uuid,uuid,text,jsonb,text)','public.cos_imported_geocode_list_due(uuid,integer)','public.cos_imported_geocode_read_many(uuid,jsonb)','app_private.cos_postal_retry_current(app_private.cos_imported_postal_retry_jobs)','public.cos_imported_geocode_postal_ordinary_list_due(uuid,integer)'];
let existingFunctionProperties,existingBodies;
const sql=name=>readFileSync(new URL('../db/'+name,import.meta.url),'utf8');
before(async()=>{
 native=await nativeFixture();legacy=await legacyFixture({imported:true});
 await native.exec('alter table app_private.vision_tracker_locations add column customer text');
 for(const name of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql','source-precedence-contract.sql','cos-source-precedence.sql'])await native.exec(sql(name));
 await native.exec('revoke usage on schema app_private from service_role');
 await legacy.exec('alter table public.camera_inventory_audit add column created_at timestamptz,add column request_id uuid');
 await legacy.exec(sql('geocodio-tracker-source-v2.sql'));
 existingFunctionProperties=(await legacy.query("select oid::regprocedure::text signature,proowner,prosecdef,proconfig,proacl::text from pg_proc where oid=any($1::regprocedure[]) order by oid",[replacedFunctions])).rows;
 existingBodies=(await legacy.query("select oid::regprocedure::text signature,pg_get_functiondef(oid) body from pg_proc where oid=any($1::regprocedure[]) order by oid",[replacedFunctions])).rows;
 for(const name of ['source-precedence-contract.sql','geocodio-source-precedence.sql'])await legacy.exec(sql(name));
});
after(async()=>{await native?.close();await legacy?.close();});
beforeEach(async()=>{await nativeReset(native);await legacyReset(legacy);await native.exec('truncate app_private.cos_source_precedence_decisions');await legacy.exec('truncate app_private.cos_imported_precedence_reviews');});
async function legacyRPC(name,args,role='service_role',actor){
 if(actor)await legacy.query("select set_config('test.actor',$1,false)",[actor]);await legacy.exec('set role '+role);
 try{return (await legacy.query('select public.'+name+'('+Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')+') v',Object.values(args))).rows[0].v;}finally{await legacy.exec('reset role');}
}
const nativeReview=async(source,review)=>(await native.query('select app_private.cos_source_precedence_admin_review($1,$2,$3,$4) v',[source,review,'Synthetic administrator/importer',hash('explicit synthetic source authority')])).rows[0].v;
const legacyReview=async source=>(await legacy.query('select app_private.cos_imported_precedence_admin_review($1,$2,$3) v',[source,'Synthetic administrator/importer',hash('explicit synthetic source authority')])).rows[0].v;
async function prepare({review=true,register=true}={}){
 const input=await seed(native,{label:'Ranger 991',product:'999991'});
 const [prior]=(await native.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2) v',[ORG,[input]])).rows[0].v;
 await legacy.query('insert into public.camera_devices values($1,$2)',[9001,'RANGER 991']);
 await legacy.query("insert into public.camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state,created_at) values(901,$1,'MOVE_TO_ROOT','RANGER 991',array[9001],$2,'2026-01-01T13:59:29.100862Z')",[OWNER,{organization:'root',syntheticPrivateReason:'historical only'}]);
 const audit={id:'901',unit_key:'RANGER 991',action:'MOVE_TO_ROOT',contract:null,placement:null,control_id:null,request_id:null,site_label:null,street_address:null,created_at:'2026-01-01T13:59:29.100862+00:00',device_ids:[9001]};
 const hashes=(await legacy.query("select app_private.cos_source_precedence_audit_sha(a) semantic,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') full from public.camera_inventory_audit a where id=901")).rows[0];
 assert.equal(await sourcePrecedenceAuditSha256(audit),hashes.semantic);
 const decision={contract:'COS_REVIEWED_SOURCE_PRECEDENCE_V1',decisionId:randomUUID(),reviewedSourceRevision:prior.sourceRevision,unitKey:'RANGER 991',deviceIds:['9001'],legacyAuditId:'901',legacyAuditSha256:hashes.semantic,legacyAuditRowSha256:hashes.full,reviewedAt:'2026-01-02T00:00:00Z',reviewKind:'administrator_import_review'};
 const source=review?await nativeReview(prior,decision):prior;if(review&&register)await legacyReview(source);
 return {input,prior,source,audit,decision};
}
async function projection(f,{audits=[f.audit],devices=[{id:9001,unit_key:'RANGER 991'}],patch={},identity={identityVersion:1,unitIdentities:[],identityWarnings:[]},contextPatch={}}={}){
 const sources=await nativeRPC(native,'map_projection',{p_organization_id:ORG,p_identities:[{entityKind:'equipment_unit',nativeUnitId:f.source.nativeUnitId}]});
 const bindings=await legacyRPC('cos_imported_precedence_read_current',{p_organization_id:ORG,p_bindings:sources.filter(s=>s.sourcePrecedence).map(sourceDto)});
 const row={id:f.source.nativeUnitId,unitNumber:f.source.unitNumber,readOnly:false,_sourceField:false,status:'readiness_unverified',currentLocationType:'shop',placement:'SHOP',hasUnitGps:false,latitude:null,longitude:null,site:'Historical shop',address:'1 Historical St, Houston, TX 77001',...patch};
 const context={nativeUnits:[{id:row.id,organization_id:ORG,unit_number:row.unitNumber}],identity,currentSources:sources,confirmedPrecedenceBindings:await Promise.all(bindings.map(checkedImportedBinding)),...contextPatch};
 const snapshot={items:[],inventoryItems:[row],summary:{}},overlay=await projectImportedSourceAddresses(snapshot,sources,audits,devices,[],context);
 const placed=await projectOwnerPlacement(overlay,audits,devices,identity,context.nativeUnits);
 const records=await legacyRPC('cos_imported_geocode_read_many',{p_organization_id:ORG,p_bindings:(await Promise.all(placed.items.map(r=>checkedImportedBinding(r.importedInstallation)))).filter(Boolean)});
 return {row,overlay,map:await projectImportedGeocodes(placed,records,audits,devices,context),context};
}
function harness({onCensus}={}){
 let calls=0;const bridge=createGeocodeSourcesHandler({readKey:'a'.repeat(64),rpc:(name,args)=>nativeRPC(native,name.replace('cos_geocode_sources_',''),args)});
 const fetch=async(url,init)=>{const u=new URL(url);if(u.hostname==='tughscoxralhofrckvxy.supabase.co')return bridge(new Request(url,init));
  assert.equal(u.hostname,'geocoding.geo.census.gov');calls++;await onCensus?.();return new Response(JSON.stringify({result:{addressMatches:[{matchedAddress:'123 Main St, Houston, TX 77002-1234',coordinates:{x:-95,y:29}}]}}),{headers:{'Content-Type':'application/json'}});};
 return {calls:()=>calls,run:()=>processImportedGeocodes({rpc:legacyRPC,fetch,sourceReadKey:'a'.repeat(64),deadlineMs:Date.now()+100000})};
}
test('review creates immutable new revision/event and preserves source evidence and audit',async()=>{
 const f=await prepare();assert.notEqual(f.source.sourceRevision,f.prior.sourceRevision);assert.ok(BigInt(f.source.eventId)>BigInt(f.prior.eventId));assert.equal(f.source.sourcePrecedence.reviewedSourceRevision,f.prior.sourceRevision);
 assert.deepEqual({...f.source,sourceRevision:f.prior.sourceRevision,eventId:f.prior.eventId,sourcePrecedence:undefined},{...f.prior,sourcePrecedence:undefined});
 assert.deepEqual(await checkedImportedSource(sourceDto(f.source)),await checkedImportedBinding(f.source));assert.equal((await legacy.query('select count(*)::integer n from public.camera_inventory_audit')).rows[0].n,1);
 await assert.rejects(()=>nativeReview(f.prior,f.decision),/changed/);assert.deepEqual((await nativeRPC(native,'read_current_batch',{p_organization_id:ORG,p_sources:[sourceIdentity(f.prior)]})).sources,[null]);
});
test('approved source projects same-unit FIELD/address and estimate without Owner placement or GPS',async()=>{
 const f=await prepare(),h=harness(),before=(await legacy.query('select to_jsonb(a) v from public.camera_inventory_audit a')).rows;
 const mapBefore=(await projection(f)).map;assert.equal(mapBefore.items.length,1);assert.equal(mapBefore.items[0].address,'123 Main St, Houston, TX 77002-1234');
 await h.run();assert.equal(h.calls(),1);const {map}=await projection(f),row=map.items[0];assert.equal(row.id,f.source.nativeUnitId);assert.equal(row.placementSource,null);assert.equal(row.placementAuditId,null);assert.equal(row.hasUnitGps,false);assert.equal(row.latitude,null);assert.equal(row.importedPlacement,'FIELD');assert.ok(await checkedAddressEstimate(row));
 assert.deepEqual((await legacy.query('select to_jsonb(a) v from public.camera_inventory_audit a')).rows,before);assert.equal((await legacy.query('select coalesce(sum(credits),0)::integer n from app_private.cos_geocodio_daily_budget')).rows[0].n,0);await h.run();assert.equal(h.calls(),1);
});
test('no decision or no legacy registration preserves historical hold',async()=>{
 const f=await prepare({review:false}),h=harness();await h.run();assert.equal(h.calls(),0);assert.equal((await projection(f)).map.items.length,0);
 f.source=await nativeReview(f.prior,f.decision);await h.run();assert.equal(h.calls(),0);assert.equal((await projection(f)).map.items.length,0);
 await legacyReview(f.source);await h.run();assert.equal(h.calls(),1);assert.equal((await projection(f)).map.items.length,1);
});
test('private audit content changes invalidate full-row guard without exposing it',async()=>{
 const f=await prepare();await legacy.exec("update public.camera_inventory_audit set after_state=after_state||'{\"privateChange\":true}'::jsonb where id=901");assert.equal((await projection(f)).map.items.length,0);const h=harness();await h.run();assert.equal(h.calls(),0);
});
test('new Owner/IT or unmarked audit on same key or device holds projection and queue',async()=>{
 const f=await prepare();for(const [key,action,after] of [['RANGER 991','MOVE_TO_FIELD',{placement_contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD'}],['RANGER 991','MOVE_TO_ROOT',{}],['OTHER UNIT','CHANGE_LABEL',{}]]){
  await legacy.query('insert into public.camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state,created_at) values(902,$1,$2,$3,array[9001],$4,now())',[OWNER,action,key,after]);assert.equal((await projection(f)).map.items.length,0);const h=harness();await h.run();assert.equal(h.calls(),0);await legacy.exec('delete from public.camera_inventory_audit where id=902');
 }
});
test('roster relabel, duplicate alias and removed audit fail closed',async()=>{
 const f=await prepare();await legacy.exec("update public.camera_devices set unit_key='OTHER UNIT' where id=9001");assert.equal((await projection(f)).map.items.length,0);
 await legacy.exec("update public.camera_devices set unit_key='RANGER 991' where id=9001;insert into public.camera_devices values(9002,'Ranger 991')");assert.equal((await projection(f)).map.items.length,0);
 await legacy.exec('delete from public.camera_devices where id=9002;delete from public.camera_inventory_audit where id=901');assert.equal((await projection(f,{audits:[]})).map.items.length,0);
});
test('map independently rejects changed evidence, lost registration, aliases and warnings',async()=>{
 const f=await prepare();for(const options of [{audits:[{...f.audit,created_at:'2026-01-01T13:59:29.100863Z'}]},{audits:[]},{devices:[]},{devices:[{id:9001,unit_key:'RANGER 991HDC2'}]},{contextPatch:{confirmedPrecedenceBindings:[]}},{identity:{identityVersion:1,unitIdentities:[],identityWarnings:[{unitId:f.source.nativeUnitId,reason:'Changed native identity',unitKeys:[],deviceIds:[]}]}}])assert.equal((await projection(f,options)).overlay.items.length,0);
});
test('duplicate audit rows fail closed at the existing identity projector',async()=>{const f=await prepare();await assert.rejects(()=>projection(f,{audits:[f.audit,f.audit]}),/duplicate audit/);});
test('manual GPS, native installation and Owner projection keep priority',async()=>{
 const f=await prepare();for(const patch of [{hasUnitGps:true,latitude:30,longitude:-96},{locationVerification:'owner_verified',latitude:30,longitude:-96},{installedSiteId:randomUUID()},{placementSource:'owner',placementAuditId:'999'}]){const {row,overlay}=await projection(f,{patch});assert.deepEqual(overlay.inventoryItems[0],row);}
 await native.query('update public.equipment_units set gps_latitude=30,gps_longitude=-96 where id=$1',[f.source.nativeUnitId]);assert.equal((await projection(f)).map.items.length,0);
});
test('legacy changes during provider lookup cannot publish a pin',async()=>{
 const f=await prepare(),h=harness({onCensus:()=>legacy.exec("update public.camera_inventory_audit set after_state=after_state||'{\"changed\":true}'::jsonb where id=901")});await h.run();assert.equal(h.calls(),1);assert.equal((await projection(f)).map.items.length,0);assert.equal((await legacy.query("select count(*)::integer n from app_private.cos_imported_census_cache where status='success'")).rows[0].n,0);
});
test('forged/unsupported decisions reject at all binding boundaries',async()=>{
 const f=await prepare();for(const patch of [{legacyAuditId:'0'},{deviceIds:[]},{sourceRevision:randomUUID()},{reviewKind:'owner_confirmation'},{extra:true},{legacyAuditRowSha256:'bad'}]){const bad={...f.source,sourcePrecedence:{...f.source.sourcePrecedence,...patch}};assert.equal(await checkedImportedSource(bad),null);assert.equal(await checkedImportedBinding(bad),null);assert.throws(()=>sourceDto(bad));await assert.rejects(()=>legacyRPC('cos_imported_precedence_read_current',{p_organization_id:ORG,p_bindings:[bad]}));}
 assert.equal(await checkedImportedBinding({...f.source,entityKind:'tracker'}),null);
});
test('writes stay administrator-only; existing reader gate excludes Service',async()=>{
 const f=await prepare();for(const role of ['anon','authenticated','service_role']){await native.exec('set role '+role);try{await assert.rejects(()=>nativeReview(f.prior,f.decision),/permission denied/);}finally{await native.exec('reset role');}await legacy.exec('set role '+role);try{await assert.rejects(()=>legacyReview(f.source),/permission denied/);}finally{await legacy.exec('reset role');}}
 const args={p_organization_id:ORG,p_bindings:[f.source]};
 await legacy.exec('revoke usage on schema app_private from service_role');
 try{assert.deepEqual(await legacyRPC('cos_imported_precedence_read_current',args),[f.source]);await legacy.exec('set role service_role');await assert.rejects(()=>legacy.query('select * from app_private.cos_imported_precedence_reviews'),/permission denied/);}finally{await legacy.exec('reset role;grant usage on schema app_private to service_role');}
 assert.deepEqual(await legacyRPC('cos_imported_precedence_read_current',args,'authenticated',OWNER),[f.source]);await assert.rejects(()=>legacyRPC('cos_imported_precedence_read_current',args,'authenticated',SERVICE),/Owner account required/);assert.equal((await native.query("select has_schema_privilege('service_role','app_private','USAGE') allowed")).rows[0].allowed,false);
 for(const privilege of ["has_table_privilege('service_role','app_private.cos_source_precedence_decisions','SELECT')","has_function_privilege('service_role','app_private.cos_source_precedence_record(app_private.cos_geocode_sources)','EXECUTE')","has_function_privilege('service_role','app_private.cos_source_precedence_assert(jsonb)','EXECUTE')"])assert.equal((await native.query('select '+privilege+' allowed')).rows[0].allowed,false);
});

test('existing SQL signatures, ACLs, definer, search path and non-guard behavior stay identical',async()=>{
 assert.deepEqual((await legacy.query("select oid::regprocedure::text signature,proowner,prosecdef,proconfig,proacl::text from pg_proc where oid=any($1::regprocedure[]) order by oid",[replacedFunctions])).rows,existingFunctionProperties);
 const bodies=(await legacy.query("select oid::regprocedure::text signature,pg_get_functiondef(oid) body from pg_proc where oid=any($1::regprocedure[]) order by oid",[replacedFunctions])).rows;
 for(let i=0;i<bodies.length;i++){
  const reverted=bodies[i].body.replace('app_private.cos_imported_precedence_guard(p_binding)',"app_private.cos_imported_legacy_guard(p_binding->>'unitNumber')").replace('app_private.cos_imported_precedence_guard(source)',"app_private.cos_imported_legacy_guard(source->>'unitNumber')").replace('app_private.cos_imported_precedence_guard(job.binding)','app_private.cos_imported_legacy_guard(job.unit_number)').replace('app_private.cos_imported_precedence_guard(p_retry.binding)',"app_private.cos_imported_legacy_guard(p_retry.binding->>'unitNumber')");
  assert.equal(reverted,existingBodies[i].body,bodies[i].signature);
 }
});
test('migration and no-decision serialization preserve both source systems exactly',async()=>{
 const old=await nativeFixture();try{
  for(const name of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql'])await old.exec(sql(name));
  await old.exec('alter table app_private.vision_tracker_locations add column customer text');
  const input=await seed(old,{label:'Ranger 992',product:'999992'});await old.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2)',[ORG,[input]]);
  const id=randomUUID(),record={entityKind:'tracker',nativeUnitId:id,trackerId:id,sourceSystem:'google_sheet_tracker',sourceRecordId:'google_sheet:synthetic_sheet_123:12:Solar Pole 72|999',sourceProvenance:{sheetId:'synthetic_sheet_123',tabId:'12',fullIdentity:'Solar Pole 72|999',sourceRange:'A999:L999'},createTracker:true,unitNumber:'Solar Pole 72 999',trackerUnitNumber:'Solar Pole 72 999',family:'Solar Pole 72',trackerFamily:'SOLAR POLES & SKIDS',variant:null,sourceFileSha256:hash('file'),sourceRowSha256:hash('row'),installation:input.installation,addressSha256:input.addressSha256,previousSourceRevision:null,placement:'FIELD',siteLabel:'Synthetic site',customerLabel:'Synthetic customer'};
  await old.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2)',[ORG,[record]]);
  const snapshot=async()=>({sources:(await old.query("select jsonb_agg(to_jsonb(s)-'precedence_decision_id' order by native_unit_id) v from app_private.cos_geocode_sources s")).rows[0].v,events:(await old.query('select jsonb_agg(to_jsonb(e) order by event_id) v from app_private.cos_geocode_source_events e')).rows[0].v,dtos:(await old.query('select jsonb_agg(app_private.cos_source_record(s) order by native_unit_id) v from app_private.cos_geocode_sources s')).rows[0].v});
  const before=await snapshot();await old.exec(sql('source-precedence-contract.sql'));await old.exec(sql('cos-source-precedence.sql'));assert.deepEqual(await snapshot(),before);
  for(const dto of before.dtos){assert.equal(Object.hasOwn(dto,'sourcePrecedence'),false);assert.deepEqual(await checkedImportedBinding(dto),await checkedImportedSource(sourceDto(dto)));}
 }finally{await old.close();}
});

async function fieldRoute(f,{size=400,evidence='available'}={}){
 const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',counts={precedence:0,sources:0,snapshots:0};
 const others=Array.from({length:size},(_,i)=>({id:randomUUID(),unitNumber:'SNIPER '+(i+10000),readOnly:true,_sourceField:true,status:'field',currentLocationType:'field',hasUnitGps:false,address:null,latitude:null,longitude:null}));
 const target={id:f.source.nativeUnitId,unitNumber:f.source.unitNumber,readOnly:false,_sourceField:false,status:'readiness_unverified',currentLocationType:'shop',hasUnitGps:false,address:'Historical shop',latitude:null,longitude:null};
 const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 const handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'synthetic-key',fetch:async(url,init={})=>{
  if(url.includes('/auth/v1/user'))return response({id:owner});
  if(url.includes('/rest/v1/profiles?'))return response([{user_id:owner,full_name:'Synthetic Owner',role:'owner',active:true,archived_at:null}]);
  if(url.includes('/rest/v1/user_profiles?'))return response([{user_id:actor,display_name:'Synthetic Owner',department:'owner',active:true}]);
  if(url.includes('/rest/v1/user_roles?'))return response([{roles:{code:'owner',organization_id:ORG}}]);
  if(url.includes('/rest/v1/camera_devices?'))return response([{id:'9001',unit_key:'RANGER 991',source:'unreviewed',device_type:'IPC'},...others.map((r,i)=>({id:String(10000+i),unit_key:r.unitNumber,source:'unreviewed',device_type:'IPC'}))]);
  if(url.includes('/rest/v1/equipment_units?'))return response((await native.query('select id,organization_id,unit_number,status from public.equipment_units')).rows);
  if(url.includes('/rest/v1/vision_vigilant_unit_matches?')||url.includes('/rest/v1/vision_vigilant_devices?'))return response([]);
  const name=url.split('/rest/v1/rpc/')[1],args=init.body?JSON.parse(init.body):{};
  if(name==='appdeploy_field_map_snapshot'){counts.snapshots++;return response({items:others,inventoryItems:[target,...others],summary:{}});}
  if(name==='cos_geocode_sources_map_projection'){counts.sources++;return response(await nativeRPC(native,'map_projection',args));}
  if(name==='cos_owner_identity_snapshot')return response({revision:'a'.repeat(64),nativeEpochs:[],claims:[]});
  if(name==='cos_fleet_placement_evidence_v1')return response([f.audit]);
  if(name==='cos_imported_precedence_read_current'){
   counts.precedence++;if(evidence==='unavailable')return response({error:'Unavailable'},503);
   if(evidence==='fresh-missing'&&counts.precedence===2)return response([]);
   return response(await legacyRPC(name,args));
  }
  if(name==='cos_imported_geocode_read_many')return response(await legacyRPC(name,args));
  if(['cos_field_geocode_read_many','cos_field_geocode_fallback_read_many','cos_archived_representation_projection','cos_source_recorded_coordinate_projection'].includes(name))return response([]);
  throw Error('Unexpected path '+name);
 }});
 const started=process.cpuUsage(),result=await handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path:'/api/field-map',method:'GET',body:null})}));
 assert.equal(result.status,200,await result.clone().text());return {map:await result.json(),counts,cpu:process.cpuUsage(started)};
}
test('whole 401-row handler batches precedence twice and keeps map available when optional evidence fails',async()=>{
 const f=await prepare();for(const evidence of ['available','unavailable','fresh-missing']){
  const {map,counts}=await fieldRoute(f,{evidence});assert.equal(counts.precedence,2);assert.equal(counts.sources,4);assert.equal(counts.snapshots,2);
  assert.equal(map.inventoryItems.length,401);assert.equal(map.items.length,evidence==='available'?401:400);
  assert.equal(map.inventoryItems.find(r=>r.id===f.source.nativeUnitId).importedPlacement,evidence==='available'?'FIELD':undefined);
 }
});
