import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {fixture,reset,ORG,OWNER,IT,SERVICE,hash,credits} from './fixtures/geocodio-database-fixture.mjs';
import {checkedAppAddressProof,checkedAppAddressAuthority,APP_UNIT_ADDRESS_CONTRACT as CONTRACT} from '../../supabase/functions/_shared/appUnitAddressContract.ts';
import {sourceDto,createGeocodeSourcesHandler} from '../../supabase/functions/cos-geocode-sources/index.ts';
import {checkedImportedSource,createSourceReader,sourceIdentity,sameSource} from '../../supabase/functions/camera-field-geocode/importedSources.ts';
import {processImportedGeocodes} from '../../supabase/functions/camera-field-geocode/importedGeocodeSweep.ts';
globalThis.crypto??=webcrypto;
let db,previousFunctions;
const sql=name=>readFileSync(new URL('../db/'+name,import.meta.url),'utf8');
before(async()=>{
 db=await fixture({imported:true});
 await db.exec('alter table public.camera_devices add column source text,add column device_type text,add column external_device_id text,add column device_serial text,add column ip_address text;alter table public.camera_inventory_audit add column created_at timestamptz,add column request_id uuid');
 for(const file of ['legacy_owner_identity_epoch.sql','geocodio-tracker-source-v2.sql','source-precedence-contract.sql','geocodio-source-precedence.sql'])await db.exec(sql(file));
 previousFunctions=(await db.query("select oid::regprocedure::text signature,proowner,prosecdef,proconfig,proacl::text,pg_get_functiondef(oid) body from pg_proc where oid=any($1::regprocedure[]) order by oid",[['app_private.cos_imported_assert_binding(uuid,jsonb)','app_private.cos_imported_precedence_guard(jsonb)','app_private.cos_imported_lock_binding(uuid,jsonb)','public.cos_imported_geocode_sync(uuid,uuid,text,jsonb,text)','public.cos_imported_geocode_list_due(uuid,integer)','public.cos_imported_geocode_read_many(uuid,jsonb)','public.cos_imported_geocode_census_claim(uuid,jsonb,uuid)','public.cos_imported_geocode_reserve(uuid,jsonb,uuid)']])).rows;
 await db.exec(sql('geocodio-app-unit-address.sql'));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await reset(db);});
async function rpc(name,args={},role='service_role',actor=SERVICE){
 await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role '+role);
 try{return (await db.query('select public.'+name+'('+Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')+') v',Object.values(args))).rows[0].v;}finally{await db.exec('reset role');}
}
const imported=(name,args={})=>rpc('cos_imported_geocode_'+name,{p_organization_id:ORG,...args});
const proof=(unit='RANGER 991',key=null,role='service_role',actor=SERVICE)=>rpc('cos_app_unit_address_legacy_proof',{p_organization_id:ORG,p_unit_number:unit,p_legacy_unit_key:key},role,actor);
const dto=(n=1,patch={})=>({schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:randomUUID(),productId:String(n),sourceRevision:randomUUID(),eventId:String(n),unitNumber:'RANGER '+(990+n),family:'RANGER',variant:null,sourceFileSha256:hash('origin file'),sourceRowSha256:hash('origin row '+n),nativeGuardSha256:hash('native guard '+n),installation:{street:'123 Main St',city:'Houston',state:'TX',zip:'77002'},addressSha256:hash('123 main st, houston, tx 77002'),suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',...patch});
async function app(n=1,patch={},key=null){const source=dto(n,{entityKind:'tracker',...patch});source.addressAuthority={...await proof(source.unitNumber,key),revision:source.sourceRevision};return source;}
async function group(unit='RANGER 991',ids=[991]){
 for(const id of ids)await db.query('insert into public.camera_devices(id,unit_key,source,device_type,external_device_id,device_serial) values($1,$2,$3,$4,$5,$6)',[id,unit,'unregistered','IPC','camera-'+id,'serial-'+id]);
 await db.query("insert into public.camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state,created_at) values(991,$1,'MOVE_TO_ROOT',$2,$3,$4,now())",[OWNER,unit,ids,{private:'original private audit',organization:'root'}]);
}
async function sync(sources,after='0'){
 const c=await imported('cursor_read');return imported('sync',{p_scan_generation:c.scanGeneration,p_after_event_id:after,p_next_event_id:sources.at(-1)?.eventId??after,p_events:sources.map(source=>({...sourceIdentity(source),eventId:source.eventId,source}))});
}
const claim=source=>imported('census_claim',{p_binding:source,p_request_id:randomUUID()});
const censusFinish=(source,token,patch={})=>imported('census_finish',{p_binding:source,p_claim_token:token,p_source_current:true,p_status:'no_match',p_reason:'no_match',...patch});
const read=sources=>imported('read_many',{p_bindings:sources});
const reserve=source=>imported('reserve',{p_binding:source,p_request_id:randomUUID()});
const finish=(source,token,patch={})=>imported('finish',{p_binding:source,p_reservation_token:token,p_source_current:true,p_status:'success',p_latitude:29,p_longitude:-95,p_matched_address:'123 Main St, Houston, TX 77002',p_accuracy_type:'rooftop',p_accuracy:1,p_match_type:'building_centroid',...patch});
test('app authority is exact, revision bound, redacted and retains immutable source origin',async()=>{
 const source=await app(),p=await proof();
 assert.deepEqual(checkedAppAddressProof(p),p);assert.deepEqual(checkedAppAddressAuthority(source.addressAuthority,source.sourceRevision),source.addressAuthority);
 const emitted=sourceDto({...source,actorId:OWNER,history:['PRIVATE'],nativePrivateRecord:'PRIVATE'});
 assert.deepEqual(emitted,source);assert.equal(JSON.stringify(emitted).includes('PRIVATE'),false);
 assert.deepEqual(await checkedImportedSource(emitted),source);
 for(const authority of [null,{...source.addressAuthority,revision:randomUUID()},{...source.addressAuthority,actorId:OWNER},{...source.addressAuthority,contract:'COS_APP_UNIT_ADDRESS_V2'},{...source.addressAuthority,legacyUnitKey:' bad '},{...source.addressAuthority,legacyIdentitySha256:null}]){
  assert.equal(await checkedImportedSource({...source,addressAuthority:authority}),null);assert.throws(()=>sourceDto({...source,addressAuthority:authority}));
 }
 assert.equal(checkedAppAddressProof({...p,revision:source.sourceRevision}),null);
 assert.equal(sameSource(source,{...source,addressAuthority:{...source.addressAuthority,legacyPlacementSha256:hash('changed')}}),false);
 assert.equal(Object.hasOwn(sourceDto({...source,eligibility:'tombstone'}),'addressAuthority'),false);
 assert.equal(await checkedImportedSource({...source,sourcePrecedence:{}}),null);assert.throws(()=>sourceDto({...source,sourcePrecedence:{}}));
 const equipment={...source,entityKind:'equipment_unit'};
 assert.equal(await checkedImportedSource(equipment),null);assert.throws(()=>sourceDto(equipment));
 await assert.rejects(db.query('select app_private.cos_app_unit_address_assert($1::jsonb)',[JSON.stringify(equipment)]),/Invalid app address authority/);
});
test('existing queue/provider SQL signatures, privileges and non-authority functions stay unchanged',async()=>{
 const after=(await db.query("select oid::regprocedure::text signature,proowner,prosecdef,proconfig,proacl::text,pg_get_functiondef(oid) body from pg_proc where oid=any($1::regprocedure[]) order by oid",[previousFunctions.map(f=>f.signature)])).rows;
 for(let n=0;n<after.length;n++){
  const {body:oldBody,...oldProperties}=previousFunctions[n],{body,...properties}=after[n];assert.deepEqual(properties,oldProperties);
  if(!/cos_imported_(assert_binding|precedence_guard)\(/.test(after[n].signature))assert.equal(body,oldBody);
 }
});
test('proof and capability use existing active Owner/IT admission only',async()=>{
 for(const actor of [OWNER,IT])assert.equal((await proof('RANGER 991',null,'authenticated',actor)).contract,CONTRACT);
 await assert.rejects(proof('RANGER 991',null,'authenticated',SERVICE),/Verified fleet/);
 await assert.rejects(proof('RANGER 991',null,'anon',OWNER),/permission denied/);
 await db.query('update public.profiles set active=false where user_id=$1',[IT]);await assert.rejects(proof('RANGER 991',null,'authenticated',IT),/Verified fleet/);
 await assert.rejects(rpc('cos_app_unit_address_legacy_proof',{p_organization_id:randomUUID(),p_unit_number:'RANGER 991'},'authenticated',OWNER),/Organization/);
 assert.deepEqual(await rpc('cos_app_unit_address_legacy_capability',{p_organization_id:ORG},'authenticated',OWNER),{contract:CONTRACT,proof:true,queue:true});
 assert.equal((await db.query("select has_table_privilege('service_role','app_private.cos_camera_identity_events','SELECT') allowed")).rows[0].allowed,false);
});
test('positive proof requires full typed exact identity, complete group and complete latest placement',async()=>{
 await group('HELIOS 099HDC4',[991,992]);
 assert.ok(await proof('HELIOS 99HDC4','HELIOS 099HDC4'));
 for(const [unit,key] of [['HELIOS 99','HELIOS 099HDC4'],['HELIOS 99HDC2','HELIOS 099HDC4'],['RANGER 99','HELIOS 099HDC4'],['99','99'],['10.1.2.3','10.1.2.3'],['HELIOS 099HDC4',null]])assert.equal(await proof(unit,key),null);
 await db.exec("update public.camera_inventory_audit set device_ids=array[991]::bigint[] where id=991");assert.equal(await proof('HELIOS 99HDC4','HELIOS 099HDC4'),null);
 await db.exec("update public.camera_inventory_audit set device_ids=array[991,992]::bigint[] where id=991;insert into public.camera_devices(id,unit_key) values(993,'HELIOS 99')");assert.equal(await proof('HELIOS 99HDC4','HELIOS 099HDC4'),null);
});
test('absence proof excludes alias families and history even with no current cameras',async()=>{
 const empty=await proof('SOLAR STAND 72 001');assert.ok(empty);assert.equal(empty.legacyUnitKey,null);
 assert.ok(await proof('110V Stand 901'));assert.ok(await proof('Wall-E 901'));
 for(const label of ['901','10.1.2.3','---','', ' '])assert.equal(await proof(label),null);
 await db.exec("insert into public.camera_devices(id,unit_key) values(901,'110V Stand 901')");
 assert.equal(await proof('110V Stand 901'),null);assert.equal(await proof('110V Stand 901','110V Stand 901'),null);
 await db.query("insert into public.camera_inventory_audit(id,unit_key,device_ids,after_state) values(10,'SOLAR STAND 72 1',array[]::bigint[],'{}')");assert.equal(await proof('SOLAR STAND 72 001'),null);
 await db.exec("insert into public.camera_devices(id,unit_key) values(20,'SNIPER 4 012')");assert.equal(await proof('SNIPER 12'),null);
});
test('cross-key audit reuse and duplicate raw keys are held instead of establishing an association',async()=>{
 await group();
 await db.query("insert into public.camera_inventory_audit(id,unit_key,device_ids,after_state) values(992,'HELIOS 991',array[991],'{}')");assert.equal(await proof('RANGER 991','RANGER 991'),null);
 await db.exec("delete from public.camera_inventory_audit where id=992;insert into public.camera_devices(id,unit_key) values(992,'Ranger 991')");assert.equal(await proof('RANGER 991','RANGER 991'),null);
});
test('physical identity and epoch changes fail closed; IP telemetry is not identity',async()=>{
 await group();const initial=await proof('RANGER 991','RANGER 991');
 await db.exec("update public.camera_devices set ip_address='10.0.0.1'");assert.deepEqual(await proof('RANGER 991','RANGER 991'),initial);
 await db.exec("update public.camera_devices set device_serial='replacement'");assert.notEqual((await proof('RANGER 991','RANGER 991')).legacyIdentitySha256,initial.legacyIdentitySha256);
 await db.exec("update public.camera_devices set device_serial='serial-991'");assert.notEqual((await proof('RANGER 991','RANGER 991')).legacyIdentitySha256,initial.legacyIdentitySha256);
 await db.exec("insert into public.camera_devices(id,unit_key,source,device_serial) values(992,'RANGER 992','unregistered','serial-991')");assert.equal(await proof('RANGER 991','RANGER 991'),null);
});
test('placement edit/revert, inserted/deleted moves and truncate never revive an earlier authority',async()=>{
 await group();const initial=await proof('RANGER 991','RANGER 991');
 await db.exec("update public.camera_inventory_audit set action='MOVE_TO_FIELD' where id=991;update public.camera_inventory_audit set action='MOVE_TO_ROOT' where id=991");
 const reverted=await proof('RANGER 991','RANGER 991');assert.notEqual(reverted.legacyPlacementSha256,initial.legacyPlacementSha256);
 await db.exec("insert into public.camera_inventory_audit(id,unit_key,device_ids,action,after_state) values(992,'RANGER 991',array[991],'MOVE_TO_FIELD','{}');delete from public.camera_inventory_audit where id=992");
 const deleted=await proof('RANGER 991','RANGER 991');assert.notEqual(deleted.legacyPlacementSha256,reverted.legacyPlacementSha256);
 const unrelated=await proof('SOLAR STAND 72 901');await db.exec('truncate public.camera_inventory_audit');
 assert.notEqual((await proof('SOLAR STAND 72 901')).legacyPlacementSha256,unrelated.legacyPlacementSha256);
 await assert.rejects(db.exec('delete from app_private.cos_app_unit_address_placement_events'),/append-only/);
 assert.equal((await db.query("select has_table_privilege('service_role','app_private.cos_app_unit_address_placement_events','SELECT') allowed")).rows[0].allowed,false);
});
test('bounded map proof batch preserves order, holds unsafe entries and excludes Service',async()=>{
 const sources=[{unitNumber:'SOLAR STAND 72 901',legacyUnitKey:null},{unitNumber:'110V Stand 902',legacyUnitKey:null},{unitNumber:'901',legacyUnitKey:null}];
 const result=await rpc('cos_app_unit_address_legacy_proof_many',{p_organization_id:ORG,p_sources:sources},'authenticated',OWNER);
 assert.deepEqual(result.proofs,[await proof(sources[0].unitNumber),await proof(sources[1].unitNumber),null]);
 await assert.rejects(rpc('cos_app_unit_address_legacy_proof_many',{p_organization_id:ORG,p_sources:sources},'authenticated',SERVICE),/Verified fleet/);
 for(const bad of [[],Array.from({length:101},()=>sources[0]),[{...sources[0],actorId:OWNER}],{}])await assert.rejects(rpc('cos_app_unit_address_legacy_proof_many',{p_organization_id:ORG,p_sources:bad}));
});
test('ordinary imports retain legacy Owner hold; explicit app proof admits the new address through shared free queue',async()=>{
 await group();const ordinary=dto(1,{entityKind:'tracker'});await sync([ordinary]);assert.deepEqual(await imported('list_due'),[]);
 const updated=await app(2,{nativeUnitId:ordinary.nativeUnitId,productId:ordinary.productId,unitNumber:ordinary.unitNumber},'RANGER 991');await sync([updated],'1');
 assert.equal((await imported('list_due'))[0].stage,'census');const c=await claim(updated);assert.equal(c.claimed,true);await censusFinish(updated,c.claimToken);
 const r=await reserve(updated);assert.equal(r.reserved,true);assert.equal((await finish(updated,r.reservationToken)).accepted,true);
 assert.equal((await read([updated]))[0].provider,'geocodio');assert.equal(await credits(db),1);
 assert.equal((await reserve(updated)).reason,'cache_hit');assert.equal(await credits(db),1);
 assert.equal((await db.query('select count(*)::int n from public.camera_inventory_audit')).rows[0].n,1);
});
test('forged valid-shaped proof is held without blocking valid originals on a mixed page',async()=>{
 const forged=await app(1),original=dto(2);forged.addressAuthority.legacyPlacementSha256=hash('forged proof');
 assert.equal((await sync([forged,original])).accepted,true);
 assert.equal((await read([forged]))[0].reason,'legacy_override');const due=await imported('list_due');assert.equal(due.length,1);assert.equal(due[0].binding.nativeUnitId,original.nativeUnitId);
 assert.equal((await claim(forged)).claimed,false);assert.equal(await credits(db),0);
});
test('later Owner history before Census finish suppresses stale coordinates',async()=>{
 await group();const a=await app(1,{},'RANGER 991');await sync([a]);const c=await claim(a);
 await db.query("insert into public.camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state) values(992,$1,'MOVE_TO_FIELD','RANGER 991',array[991],$2)",[OWNER,{placement_contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD',street_address:'456 New St'}]);
 assert.equal((await censusFinish(a,c.claimToken,{p_status:'success',p_reason:null,p_latitude:29,p_longitude:-95,p_matched_address:'123 Main St, Houston, TX 77002'})).accepted,false);
 assert.equal((await read([a]))[0].reason,'legacy_override');assert.equal((await read([a]))[0].latitude,null);assert.equal((await reserve(a)).reserved,false);
});
test('later private audit mutation before paid finish suppresses coordinates without refunding a sent request',async()=>{
 await group();const b=await app(1,{},'RANGER 991');await sync([b]);const cb=await claim(b);await censusFinish(b,cb.claimToken);const r=await reserve(b);assert.equal(r.reserved,true);
 await db.exec("update public.camera_inventory_audit set after_state=after_state||'{\"privateEdit\":true}'::jsonb where id=991");
 assert.equal((await finish(b,r.reservationToken)).accepted,false);assert.equal((await read([b]))[0].latitude,null);assert.equal(await credits(db),1);
});
test('no-camera proof changes when a camera appears; lock contention fails closed',async()=>{
 const a=await app();await sync([a]);const c=await claim(a);await db.exec("insert into public.camera_devices(id,unit_key) values(991,'RANGER 991')");
 assert.equal((await censusFinish(a,c.claimToken)).accepted,false);assert.deepEqual(await imported('list_due'),[]);
 const original=(await db.query("select pg_get_functiondef('app_private.cos_imported_try_lock_legacy()'::regprocedure) v")).rows[0].v;
 await db.exec("create or replace function app_private.cos_imported_try_lock_legacy() returns boolean language sql set search_path='' as $$select false$$");
 try{assert.equal(await proof(),null);assert.equal((await read([a]))[0].reason,'legacy_busy');assert.equal((await claim(a)).claimed,false);}finally{await db.exec(original);}
});

function harness(sources,{changeDuringProvider}={}){
 let state=[...sources],calls={census:0,geocodio:0};const KEY='a'.repeat(64);let previous=Promise.resolve();
 const serialRPC=(name,args)=>{const task=previous.then(()=>rpc(name,args));previous=task.catch(()=>{});return task;};
 const bridge=createGeocodeSourcesHandler({readKey:KEY,rpc:async(name,args)=>{
  if(name==='cos_geocode_sources_list_changes'){const events=state.filter(s=>BigInt(s.eventId)>BigInt(args.p_after_event_id)).map(s=>({...sourceIdentity(s),eventId:s.eventId,kind:'upsert'}));return {events,nextEventId:events.at(-1)?.eventId??args.p_after_event_id};}
  return {sources:args.p_sources.map(i=>state.find(s=>JSON.stringify(sourceIdentity(s))===JSON.stringify(i))??null)};
 }});
 const request=async(url,init)=>{
  const u=new URL(url);if(u.hostname==='tughscoxralhofrckvxy.supabase.co')return bridge(new Request(url,init));
  if(u.hostname==='geocoding.geo.census.gov'){calls.census++;return new Response(JSON.stringify({result:{addressMatches:[]}}));}
  assert.equal(u.origin,'https://api.geocod.io');calls.geocodio++;await changeDuringProvider?.(()=>{state=[];});
  return new Response(JSON.stringify({results:[{address_components:{number:'123',formatted_street:'Main St',city:'Houston',state_province:'TX',postal_code:'77002',country:'US'},formatted_address:'123 Main St, Houston, TX 77002',location:{lat:29,lng:-95},accuracy:1,accuracy_type:'rooftop',match_type:'building_centroid'}]}));
 };
 return {calls,reader:createSourceReader(KEY,request),run:()=>processImportedGeocodes({rpc:serialRPC,fetch:request,sourceReadKey:KEY,geocodioApiKey:'synthetic-only',deadlineMs:Date.now()+100000})};
}
test('mixed original/app V1/V2 bridge sources share address dedupe, provider labels and one 2400-budget credit',async()=>{
 const original=dto(1),a=await app(2),tracker=await app(3,{schemaVersion:2,sourceSystem:'google_sheet_tracker',entityKind:'tracker',sourceRecordId:'google_sheet:synthetic_sheet_123:12:Solar Pole 72|003',unitNumber:'Solar Pole 72 003',family:'Solar Pole 72'});delete tracker.productId;
 const h=harness([original,a,tracker]);assert.deepEqual(await h.reader.currentMany([original,a,tracker].map(sourceIdentity)),[original,a,tracker]);
 await h.run();assert.equal(h.calls.census,1);assert.equal(h.calls.geocodio,1);assert.equal(await credits(db),1);
 for(const record of await read([original,a,tracker])){assert.equal(record.provider,'geocodio');assert.equal(record.status,'success');}
 assert.equal((await db.query('select daily_limit from app_private.cos_geocodio_control')).rows[0].daily_limit,2400);
 await h.run();assert.equal(h.calls.geocodio,1);
});
test('fresh after-provider native read rejects an address revision removed in flight',async()=>{
 const a=await app();const h=harness([a],{changeDuringProvider:clear=>clear()});await h.run();
 assert.equal(h.calls.geocodio,1);assert.equal((await read([a]))[0].latitude,null);assert.equal(await credits(db),1);
});
