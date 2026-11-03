import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const sql=readFileSync(new URL('../db/mhelp-product-id-authority.sql',import.meta.url),'utf8');
const tracker='11111111-1111-4111-8111-111111111111',native='22222222-2222-4222-8222-222222222222',revision='33333333-3333-4333-8333-333333333333';
const binding={productId:'123',trackerId:tracker,nativeUnitId:native,trackerLabel:'Old unit name',nativeLabel:'Old unit name',fullLabel:'Old unit name',matchMethod:'reviewed_product_id',expectedGuard:'historical',canonicalKey:'SPOTTER:1',reviewEvidence:{reviewed_product_id:'123',review_state:'confirmed'}};
const record=()=>({productId:'123',unitNumber:'Current mHelp name',category:'Spotter HDC2',placement:'FIELD',customerId:'9',customer:'Current customer: Current site',sourceAddress:{street:'Current street'},sourceDates:{apiCustomerObservedAt:'2026-11-03T21:35:00Z'},lifecycle:'UNFLAGGED',binding:null,holdReason:'Source assignment or protection changed; Owner installation review required',possibleAliasUnitIds:[],apiAssignment:{fullLabel:'Current mHelp name ',active:true,customerId:'9',serviceLocationId:'10',placementProof:{version:1,model:null,parentLabel:'Current customer',parentActive:true,parentIsServiceLocation:false,serviceVerified:true,serviceActive:true,siteLabel:'Current site'}}});
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema cos_mhelp_placement_private;create schema app_private;
 create table cos_mhelp_placement_private.upload_batches(source_sha256 text,payload_sha256 text,receipt jsonb,records jsonb,admitted_at timestamptz);
 create table cos_mhelp_placement_private.links(equipment_id text,tracker_id uuid,native_unit_id uuid,tracker_label text,native_label text,source_revision uuid,baseline_guard text,model text,reviewed_at timestamptz default now(),authorization_sha256 text default repeat('a',64),full_label text default 'Old unit name');
 create table app_private.cos_geocode_sources(product_id text,tracker_id uuid,native_unit_id uuid,source_revision uuid,active boolean,source_system text,entity_kind text default 'equipment_unit');
 create function cos_mhelp_placement_private.recorded_shop_return_current(text,uuid,uuid) returns boolean language sql as 'select false';
 create table app_private.fixture_guard(value text);
 insert into app_private.fixture_guard values('unchanged');
 create function cos_mhelp_placement_private.guard(uuid,uuid) returns text language sql as 'select value from app_private.fixture_guard';
 create function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid) returns text language sql as 'select ''current-upload-guard''::text';`);
 await db.query('insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,native_unit_id,tracker_label,native_label,source_revision,baseline_guard,model) values($1,$2,$3,$4,$4,$5,$6,null)',['123',tracker,native,'Old unit name',revision,'unchanged']);
 await db.query("insert into app_private.cos_geocode_sources(product_id,tracker_id,native_unit_id,source_revision,active,source_system) values('123',$1,$2,$3,true,'mhelpdesk_product_import')",[tracker,native,revision]);
 const receipt={contract:'COS_MHELP_UPLOAD_V1',sourceSha256:'old-source'},records=[{productId:'123',unitNumber:'Old unit name',category:'Spotter HDC2',binding}];
 await db.query("insert into cos_mhelp_placement_private.upload_batches select 'old-source',encode(sha256(convert_to(jsonb_build_object('receipt',$1::jsonb,'records',$2::jsonb)::text,'UTF8')),'hex'),$1,$2,now()",[receipt,records]);
 await db.exec(sql);return db;
}
async function run(db,rows=[record()],projection=false){return (await db.query('select cos_mhelp_placement_private.authoritative_product_records($1,$2) value',[rows,projection])).rows[0].value;}
test('exact reviewed Product ID follows current mHelp name/customer/site and preserves clocks, address and original records',async()=>{
 const db=await fixture();try{
 const before=(await db.query('select to_jsonb(b) row from cos_mhelp_placement_private.upload_batches b')).rows;
 const input=record(),[out]=await run(db,[input]);
 assert.equal(out.holdReason,null);assert.equal(out.binding.productId,'123');assert.equal(out.binding.trackerId,tracker);assert.equal(out.binding.fullLabel,input.unitNumber);assert.equal(out.binding.expectedGuard,'current-upload-guard');assert.equal(out.binding.guardCurrent,undefined);
 for(const key of ['unitNumber','placement','customerId','customer','sourceAddress','sourceDates','apiAssignment'])assert.deepEqual(out[key],input[key]);
 assert.deepEqual((await db.query('select to_jsonb(b) row from cos_mhelp_placement_private.upload_batches b')).rows,before);
 assert.equal((await run(db,[input],true))[0].binding.guardCurrent,true);
 }finally{await db.close();}
});
test('changed, missing, retired, incomplete and unknown evidence cannot be silently cleared',async()=>{
 const db=await fixture();try{
 const changes=[r=>r.productId='999',r=>r.lifecycle='DO_NOT_USE',r=>r.apiAssignment.active=false,r=>r.apiAssignment.placementProof.model='Other model',r=>r.category='Sniper',r=>r.apiAssignment.placementProof.parentActive=false,r=>r.apiAssignment.placementProof.serviceActive=false,r=>r.apiAssignment.placementProof.serviceVerified=false,r=>r.apiAssignment.placementProof.parentIsServiceLocation=true,r=>r.apiAssignment.placementProof.version=2,r=>r.unitNumber='Not the source label',r=>r.customerId='8',r=>r.holdReason='manual_security_hold',r=>r.possibleAliasUnitIds=['44444444-4444-4444-8444-444444444444']];
 for(const change of changes){const input=record();change(input);assert.deepEqual(await run(db,[input]),[input],String(change));}
 for(const query of ["update app_private.fixture_guard set value='changed'","update app_private.cos_geocode_sources set active=false","update app_private.cos_geocode_sources set source_revision='44444444-4444-4444-8444-444444444444'","update cos_mhelp_placement_private.upload_batches set payload_sha256='corrupt'"]){await db.exec('begin');await db.exec(query);assert.deepEqual(await run(db),[record()],query);await db.exec('rollback');}
 }finally{await db.close();}
});
test('competing bindings and duplicate Product IDs are rejected or held; valid bindings remain untouched',async()=>{
 const db=await fixture();try{
 const bound={...record(),productId:'999',binding:{...binding,productId:'999'},holdReason:null};
 assert.deepEqual((await run(db,[record(),bound]))[0],record());
 await assert.rejects(run(db,[record(),record()]),/Unique current Product IDs/);
 const valid={...record(),binding:{...binding,guardCurrent:false}};assert.deepEqual(await run(db,[valid]),[valid]);
 }finally{await db.close();}
});
test('Shop and support equipment retain mHelp classification, with no telemetry fabricated',async()=>{
 const db=await fixture();try{
 const r=record();r.placement='SHOP';r.apiAssignment.placementProof={...r.apiAssignment.placementProof,parentLabel:'Cameras OnSite',serviceVerified:false,serviceActive:null,siteLabel:''};
 const [out]=await run(db,[r]);assert.equal(out.holdReason,null);assert.equal(out.placement,'SHOP');assert.equal(out.health,undefined);assert.equal(out.online,undefined);
 const r2=record();r2.category='Solar Stand 72';await db.query("update cos_mhelp_placement_private.upload_batches set records=jsonb_set(records,'{0,category}','\"Solar Stand 72\"'),payload_sha256=null");
 await db.exec("update cos_mhelp_placement_private.upload_batches set payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',records)::text,'UTF8')),'hex')");
 assert.equal((await run(db,[r2]))[0].category,'Solar Stand 72');assert.equal((await run(db,[r2]))[0].holdReason,null);
 }finally{await db.close();}
});

test('tracker-only identities retain their source row ID without inventing native equipment',async()=>{
 const db=await fixture();try{
 await db.exec("update cos_mhelp_placement_private.links set native_unit_id=null,native_label=null; update app_private.cos_geocode_sources set entity_kind='tracker',native_unit_id=tracker_id");
 await db.exec("update cos_mhelp_placement_private.upload_batches set records=jsonb_set(jsonb_set(records,'{0,binding,nativeUnitId}','null'),'{{0,binding,nativeLabel}}','null')".replace('{{','{').replace('}}','}'));
 await db.exec("update cos_mhelp_placement_private.upload_batches set payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',records)::text,'UTF8')),'hex')");
 const [out]=await run(db);assert.equal(out.holdReason,null);assert.equal(out.binding.nativeUnitId,null);assert.equal(out.binding.trackerId,tracker);
 }finally{await db.close();}
});
test('previous placement hold needs the separately reviewed active Product ID link',async()=>{
 const db=await fixture();try{
 await db.exec("update cos_mhelp_placement_private.upload_batches set records=jsonb_set(records,'{0,binding,reviewEvidence,review_state}','\"held\"')");
 await db.exec("update cos_mhelp_placement_private.upload_batches set payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',records)::text,'UTF8')),'hex')");
 assert.equal((await run(db))[0].holdReason,null);
 await db.exec("update cos_mhelp_placement_private.links set authorization_sha256=null");assert.deepEqual(await run(db),[record()]);
 }finally{await db.close();}
});

async function shopFixture(){
 const db=await fixture();
 await db.exec(`create table public.equipment_units(id uuid,organization_id uuid,unit_number text,current_location_type text,status text,retired_at timestamptz,installed_site_id uuid,current_location_ref text,gps_latitude numeric,gps_longitude numeric,model_id uuid);
 create table app_private.vision_tracker_locations(id uuid,organization_id uuid,unit_number text);
 alter table app_private.cos_geocode_sources add organization_id uuid,add eligibility text,add event_id bigint;
 create table app_private.cos_fleet_shop_moves(id uuid,unit_id uuid,organization_id uuid,created_at timestamptz,unit_number text,model_id uuid,source_bindings jsonb);
 create table app_private.cos_geocode_source_events(event_id bigint,kind text,product_id text,native_unit_id uuid,source_revision uuid);
 create table app_private.cos_owner_identity_claims(native_unit_id uuid);
 create table app_private.cos_archived_representations(archived_tracker_id uuid,canonical_tracker_id uuid,archived_native_id uuid,canonical_native_id uuid);
 update app_private.fixture_guard set value=null;`);
 const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',model='55555555-5555-4555-8555-555555555555';
 await db.query("insert into public.equipment_units values($1,$2,'Old unit name','shop','available',null,null,null,null,null,$3)",[native,org,model]);
 await db.query("insert into app_private.vision_tracker_locations values($1,$2,'Old unit name')",[tracker,org]);
 await db.query("update app_private.cos_geocode_sources set active=false,eligibility='tombstone',event_id=1,organization_id=$1",[org]);
 await db.query("insert into app_private.cos_geocode_source_events values(1,'tombstone','123',$1,$2)",[native,revision]);
 await db.query("insert into app_private.cos_fleet_shop_moves values(gen_random_uuid(),$1,$2,now(),'Old unit name',$3,$4)",[native,org,model,[{productId:'123',sourceUnitNumber:'Old unit name'}]]);
 await db.exec(readFileSync(new URL('../db/mhelp-recorded-shop-return.sql',import.meta.url),'utf8').replace('create function ','create or replace function '));
 return db;
}
function shopRecord(){const r=record();r.placement='SHOP';r.holdReason=null;r.possibleAliasUnitIds=[native,tracker];r.apiAssignment.placementProof={...r.apiAssignment.placementProof,parentLabel:'Cameras OnSite',serviceVerified:false,serviceActive:null,siteLabel:''};return r;}
const shopCurrent=async db=>(await db.query('select cos_mhelp_placement_private.recorded_shop_return_current($1,$2,$3) value',['123',tracker,native])).rows[0].value;
test('recorded Shop return remains inactive, preserves move history and restores only its exact Product ID',async()=>{
 const db=await shopFixture();try{
 const before=(await db.query('select to_jsonb(s) row from app_private.cos_geocode_sources s')).rows;
 assert.equal(await shopCurrent(db),true);const [out]=await run(db,[shopRecord()],true);assert.equal(out.binding.productId,'123');assert.equal(out.binding.guardCurrent,true);assert.equal(out.placement,'SHOP');
 assert.deepEqual((await db.query('select to_jsonb(s) row from app_private.cos_geocode_sources s')).rows,before);
 assert.equal((await db.query('select count(*) n from app_private.cos_fleet_shop_moves')).rows[0].n,1);
 }finally{await db.close();}
});
test('Shop proof rejects wrong product/event, later move, model, placement, GPS, owner claims and archived identity',async()=>{
 const db=await shopFixture();try{
 const changes=["update app_private.cos_geocode_source_events set product_id='999'","update app_private.cos_geocode_source_events set kind='upsert'","update public.equipment_units set current_location_type='field'","update public.equipment_units set gps_latitude=30","update public.equipment_units set status='retired'","update public.equipment_units set model_id=null","update app_private.cos_fleet_shop_moves set source_bindings='[]'","insert into app_private.cos_owner_identity_claims select id from public.equipment_units","insert into app_private.cos_archived_representations(archived_native_id) select id from public.equipment_units"];
 for(const q of changes){await db.exec('begin');await db.exec(q);assert.equal(await shopCurrent(db),false,q);assert.deepEqual(await run(db,[shopRecord()]),[shopRecord()],q);await db.exec('rollback');}
 }finally{await db.close();}
});
