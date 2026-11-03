import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const sql=readFileSync(new URL('../db/mhelp-product-id-authority.sql',import.meta.url),'utf8');
const tracker='11111111-1111-4111-8111-111111111111',native='22222222-2222-4222-8222-222222222222',revision='33333333-3333-4333-8333-333333333333';
const binding={productId:'123',trackerId:tracker,nativeUnitId:native,trackerLabel:'Old unit name',nativeLabel:'Old unit name',fullLabel:'Old unit name',matchMethod:'reviewed_product_id',expectedGuard:'historical',canonicalKey:'SPOTTER:1',reviewEvidence:{reviewed_product_id:'123'}};
const record=()=>({productId:'123',unitNumber:'Current mHelp name',category:'Spotter HDC2',placement:'FIELD',customerId:'9',customer:'Current customer: Current site',sourceAddress:{street:'Current street'},sourceDates:{apiCustomerObservedAt:'2026-11-03T21:35:00Z'},lifecycle:'UNFLAGGED',binding:null,holdReason:'Source assignment or protection changed; Owner installation review required',possibleAliasUnitIds:[],apiAssignment:{fullLabel:'Current mHelp name ',active:true,customerId:'9',serviceLocationId:'10',placementProof:{version:1,model:null,parentLabel:'Current customer',parentActive:true,parentIsServiceLocation:false,serviceVerified:true,serviceActive:true,siteLabel:'Current site'}}});
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema cos_mhelp_placement_private;create schema app_private;
 create table cos_mhelp_placement_private.upload_batches(source_sha256 text,payload_sha256 text,receipt jsonb,records jsonb,admitted_at timestamptz);
 create table cos_mhelp_placement_private.links(equipment_id text,tracker_id uuid,native_unit_id uuid,tracker_label text,native_label text,source_revision uuid,baseline_guard text,model text);
 create table app_private.cos_geocode_sources(product_id text,tracker_id uuid,native_unit_id uuid,source_revision uuid,active boolean,source_system text);
 create table app_private.fixture_guard(value text);
 insert into app_private.fixture_guard values('unchanged');
 create function cos_mhelp_placement_private.guard(uuid,uuid) returns text language sql as 'select value from app_private.fixture_guard';
 create function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid) returns text language sql as 'select ''current-upload-guard''::text';`);
 await db.query('insert into cos_mhelp_placement_private.links values($1,$2,$3,$4,$4,$5,$6,null)',['123',tracker,native,'Old unit name',revision,'unchanged']);
 await db.query("insert into app_private.cos_geocode_sources values('123',$1,$2,$3,true,'mhelpdesk_product_import')",[tracker,native,revision]);
 const receipt={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:'old-source'},records=[{productId:'123',unitNumber:'Old unit name',category:'Spotter HDC2',binding}];
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
