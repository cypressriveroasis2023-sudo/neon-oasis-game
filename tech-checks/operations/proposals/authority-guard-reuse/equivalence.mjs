import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../../db/',import.meta.url);
const original=readFileSync(new URL('20261113_authority_guard_reuse_original.sql',root),'utf8').replace('FUNCTION cos_mhelp_placement_private.authoritative_product_records(', 'FUNCTION cos_mhelp_placement_private.original_records(');
const candidate=readFileSync(new URL('20261113_authority_guard_reuse_candidate.sql',root),'utf8');
const db=new PGlite();
await db.exec(`create schema cos_mhelp_placement_private; create schema app_private;
create table cos_mhelp_placement_private.upload_batches(source_sha256 text, payload_sha256 text, receipt jsonb, records jsonb, admitted_at timestamptz);
create table cos_mhelp_placement_private.links(equipment_id text primary key,tracker_id uuid,native_unit_id uuid,baseline_guard text,source_revision text,reviewed_at timestamptz,authorization_sha256 text,tracker_label text,native_label text,model text);
create table app_private.cos_geocode_sources(product_id text,tracker_id uuid,native_unit_id uuid,entity_kind text,source_system text,active boolean,source_revision text);
create table public.test_guard(value text,shop_return boolean); insert into public.test_guard values('good',false);
create function cos_mhelp_placement_private.guard(uuid,uuid) returns text language sql stable as $$ select value from public.test_guard $$;
create function cos_mhelp_placement_private.recorded_shop_return_current(text,uuid,uuid) returns boolean language sql stable as $$ select shop_return from public.test_guard $$;
create function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid) returns text language sql stable as $$ select 'current'::text $$;`);
await db.exec(original); await db.exec(candidate);
const tid='11111111-1111-4111-8111-111111111111';
const binding={matchMethod:'reviewed_product_id',reviewEvidence:{review_state:'confirmed',reviewed_product_id:'1'},productId:'1',trackerId:tid,nativeUnitId:null,trackerLabel:'Unit 1',nativeLabel:null,expectedGuard:'old'};
const history=[{productId:'1',unitNumber:'Unit 1',category:'Camera',binding}];
const row={productId:'1',unitNumber:'Unit 1',category:'Camera',customerId:'7',placement:'SHOP',lifecycle:'UNFLAGGED',binding:null,apiAssignment:{active:true,fullLabel:'Unit 1',customerId:'7',placementProof:{version:'1',parentIsServiceLocation:false,parentActive:true,parentLabel:'Cameras Onsite',model:'M'}}};
async function reset(){await db.exec(`truncate cos_mhelp_placement_private.upload_batches,cos_mhelp_placement_private.links,app_private.cos_geocode_sources; update public.test_guard set value='good',shop_return=false;`);
await db.query(`insert into cos_mhelp_placement_private.links values('1',$1,null,'good','r1',now(),repeat('a',64),'Unit 1',null,'M')`,[tid]);
await db.query(`insert into app_private.cos_geocode_sources values('1',$1,null,'tracker','mhelpdesk_product_import',true,'r1')`,[tid]);
const receipt={contract:'COS_MHELP_UPLOAD_V1',sourceSha256:'source1'};
await db.query(`insert into cos_mhelp_placement_private.upload_batches select 'source1',encode(sha256(convert_to(jsonb_build_object('receipt',$1::jsonb,'records',$2::jsonb)::text,'UTF8')),'hex'),$1::jsonb,$2::jsonb,now()`,[JSON.stringify(receipt),JSON.stringify(history)]);}
const tests=[['valid',()=>{}],['no candidate',r=>r.productId='2'],['already bound',r=>r.binding={trackerId:tid,nativeUnitId:null}],['held',r=>r.holdReason='Owner unresolved'],['retired',r=>r.lifecycle='RETIRED'],['inactive',r=>r.apiAssignment.active=false],['wrong version',r=>r.apiAssignment.placementProof.version='2'],['wrong label',r=>r.unitNumber='Other'],['wrong customer',r=>r.customerId='8'],['service parent',r=>r.apiAssignment.placementProof.parentIsServiceLocation=true],['inactive parent',r=>r.apiAssignment.placementProof.parentActive=false],['wrong shop',r=>r.apiAssignment.placementProof.parentLabel='Other'],['wrong model',r=>r.apiAssignment.placementProof.model='Other'],['wrong category',r=>r.category='Stand'],['alias conflict',r=>r.possibleAliasUnitIds=['22222222-2222-4222-8222-222222222222']],['stale guard',()=>{},`update public.test_guard set value='changed'`],['shop return',()=>{},`update public.test_guard set value='changed',shop_return=true`],['inactive source',()=>{},`update app_private.cos_geocode_sources set active=false`],['changed source',()=>{},`update app_private.cos_geocode_sources set source_revision='r2'`],['unreviewed',()=>{},`update cos_mhelp_placement_private.links set reviewed_at=null`],['bad authorization',()=>{},`update cos_mhelp_placement_private.links set authorization_sha256='bad'`],['tampered history',()=>{},`update cos_mhelp_placement_private.upload_batches set payload_sha256='bad'`],['field valid',r=>{r.placement='FIELD';Object.assign(r.apiAssignment,{serviceLocationId:'9'});Object.assign(r.apiAssignment.placementProof,{serviceVerified:true,serviceActive:true,siteLabel:'Site'});}]];
let checks=0;
for(const [name,mutate,sql] of tests){await reset();const r=structuredClone(row);mutate(r);if(sql)await db.exec(sql);for(const projection of [true,false]){const {rows}=await db.query(`select cos_mhelp_placement_private.original_records($1::jsonb,$2) old,cos_mhelp_placement_private.authoritative_product_records($1::jsonb,$2) new`,[JSON.stringify([r]),projection]);assert.deepEqual(rows[0].new,rows[0].old,name);if(name==='valid')assert.equal(rows[0].new[0].binding.expectedGuard,'current');checks++;}}
for(const input of [{},[row,row]]){for(const fn of ['original_records','authoritative_product_records']){await assert.rejects(db.query(`select cos_mhelp_placement_private.${fn}($1::jsonb,true)`,[JSON.stringify(input)]),/Unique current Product IDs required/);checks++;}}
async function putHistory(rows,source='source1',when='2026-11-01T00:00:00Z') {
 const receipt={contract:'COS_MHELP_UPLOAD_V1',sourceSha256:source};
 await db.query(`delete from cos_mhelp_placement_private.upload_batches where source_sha256=$1`,[source]);
 await db.query(`insert into cos_mhelp_placement_private.upload_batches select $1,encode(sha256(convert_to(jsonb_build_object('receipt',$2::jsonb,'records',$3::jsonb)::text,'UTF8')),'hex'),$2::jsonb,$3::jsonb,$4::timestamptz`,[source,JSON.stringify(receipt),JSON.stringify(rows),when]);
}
for(const scenario of ['native','competing-source','competing-input','multiple-history','tampered-new-history','null-guard']) {
 await reset(); const input=[structuredClone(row)];
 if(scenario==='native'){
  const nid='22222222-2222-4222-8222-222222222222';
  await db.query(`update cos_mhelp_placement_private.links set native_unit_id=$1,native_label='Native 1'`,[nid]);
  await db.query(`update app_private.cos_geocode_sources set native_unit_id=$1,entity_kind='equipment_unit'`,[nid]);
  const h=structuredClone(history);Object.assign(h[0].binding,{nativeUnitId:nid,nativeLabel:'Native 1'});await putHistory(h);
 }
 if(scenario==='competing-source')await db.query(`insert into app_private.cos_geocode_sources values('2',$1,null,'tracker','mhelpdesk_product_import',true,'r1')`,[tid]);
 if(scenario==='competing-input')input.push({productId:'2',binding:{trackerId:tid,nativeUnitId:null}});
 if(scenario.includes('history')){
  const old=structuredClone(history),newer=structuredClone(history);old[0].binding.marker='old';newer[0].binding.marker='new';
  await putHistory(old);await putHistory(newer,'source2','2026-11-02T00:00:00Z');
  if(scenario==='tampered-new-history')await db.exec(`update cos_mhelp_placement_private.upload_batches set payload_sha256='invalid' where source_sha256='source2'`);
 }
 if(scenario==='null-guard')await db.exec('update public.test_guard set value=null');
 for(const projection of [true,false]){
  const {rows}=await db.query(`select cos_mhelp_placement_private.original_records($1::jsonb,$2) old,cos_mhelp_placement_private.authoritative_product_records($1::jsonb,$2) new`,[JSON.stringify(input),projection]);assert.deepEqual(rows[0].new,rows[0].old,scenario);
  if(scenario==='native')assert.equal(rows[0].new[0].binding.nativeUnitId,'22222222-2222-4222-8222-222222222222');
  if(scenario.startsWith('competing'))assert.equal(rows[0].new[0].binding,null);
  if(scenario==='multiple-history')assert.equal(rows[0].new[0].binding.marker,'new');
  if(scenario==='tampered-new-history')assert.equal(rows[0].new[0].binding.marker,'old');checks++;
 }
}
await db.exec(`create schema cos_sheets_placement_private; create schema cos_operational_private;
create table cos_sheets_placement_private.refresh_requests(equipment_id text,requested_at timestamptz);
create table cos_sheets_placement_private.bindings(equipment_id text,pending_cells jsonb);
create table cos_operational_private.current_placements(product_id text);
alter table cos_mhelp_placement_private.links add observation jsonb, add observed_at timestamptz;`);
const refresh=JSON.parse(readFileSync(new URL('./refresh-queries.json',import.meta.url),'utf8'));
for(const mutation of ['',`update cos_sheets_placement_private.refresh_requests set requested_at=now()-interval '3 hours'`,`update cos_sheets_placement_private.bindings set pending_cells='{}'::jsonb where equipment_id='1'`,`update cos_mhelp_placement_private.links set observation='{"state":"waiting"}' where equipment_id='1'`,`insert into cos_operational_private.current_placements values('1')`,`update public.test_guard set value='changed'`]) {
await reset();await db.exec(`truncate cos_sheets_placement_private.refresh_requests,cos_sheets_placement_private.bindings,cos_operational_private.current_placements;
update cos_mhelp_placement_private.links set observation='{"state":"confirmed"}',observed_at=null;
insert into cos_sheets_placement_private.refresh_requests values('1',now());
insert into cos_sheets_placement_private.bindings values('1',null);
insert into cos_mhelp_placement_private.links select i::text,'11111111-1111-4111-8111-111111111111',null,'good','r1',now(),repeat('a',64),'Unit '||i,null,'M','{"state":"confirmed"}',now()+i*interval '1 second' from generate_series(2,10) i;
insert into cos_sheets_placement_private.refresh_requests select i::text,now() from generate_series(2,10) i;
insert into cos_sheets_placement_private.bindings select i::text,null from generate_series(2,10) i;`);
if(mutation)await db.exec(mutation);
const old=await db.query(refresh.old),candidate=await db.query(refresh.candidate);
assert.deepEqual(candidate.rows,old.rows,'refresh '+mutation);assert(candidate.rows.length<=6);checks++;
}
await db.exec(`set check_function_bodies=off; create role service_role;`);
await db.exec(original.replace('FUNCTION cos_mhelp_placement_private.original_records(', 'FUNCTION cos_mhelp_placement_private.authoritative_product_records('));
await db.exec(readFileSync(new URL('20261113_baseline_refresh_original.sql',root),'utf8'));
await db.exec(`revoke all on function cos_mhelp_placement_private.authoritative_product_records(jsonb,boolean) from public;
revoke all on function public.cos_mhelp_inventory_baseline() from public;
grant execute on function public.cos_mhelp_inventory_baseline() to service_role;`);
const install=readFileSync(new URL('20261113_inventory_guard_reuse_install.sql',root),'utf8');
const rollback=readFileSync(new URL('20261113_inventory_guard_reuse_rollback.sql',root),'utf8');
await db.exec(install);checks++;
await db.exec(rollback);checks++;
await db.exec(`alter function public.cos_mhelp_inventory_baseline() set work_mem='32MB'`);
await assert.rejects(db.exec(install),/Function drift or permission mismatch/);await db.exec('rollback');checks++;
console.log(`PASS ${checks} exact-result, rejection, install/rollback and drift checks; synthetic local database only`);await db.close();
