import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fixture,reset,seed,ORG,OWNER,hash} from './fixtures/geocodio-database-fixture.mjs';
const source=await readFile(new URL('../db/geocodio-imported-jobs.sql',import.meta.url),'utf8');
const baseline=source.slice(source.indexOf('create function public.cos_imported_geocode_list_due('),source.indexOf('\ncreate function public.cos_imported_geocode_census_claim(')).replace('create function ','create or replace function ');
const replacement=await readFile(new URL('../db/geocodio-imported-list-due-v2.sql',import.meta.url),'utf8');
let db;
before(async()=>{
 db=await fixture({imported:true});
 // Observe real guard calls, including its unchanged locks and legacy table scans.
 await db.exec(`create table public.test_guard_calls(unit_number text);
 grant insert,select on public.test_guard_calls to service_role;
 alter function app_private.cos_imported_legacy_guard(text) rename to test_original_legacy_guard;
 create function app_private.cos_imported_legacy_guard(p_unit_number text)
 returns jsonb language plpgsql set search_path='' as $$
 declare result jsonb; hook jsonb;
 begin
  insert into public.test_guard_calls values(p_unit_number);
  result:=app_private.test_original_legacy_guard(p_unit_number);
  hook:=nullif(current_setting('test.guard_hook',true),'')::jsonb;
  if hook->>'unit'=p_unit_number then
   if hook->>'target'='census' then
    update app_private.cos_imported_census_cache set status='no_match',reason='no_match',active_request_id=null,lease_until=null,next_attempt_at=null where address_sha256=hook->>'sha';
   elsif hook->>'target'='fallback' then
    update app_private.cos_field_geocode_fallback_cache set status='no_match',reason='no_match',active_request_id=null,lease_until=null,next_attempt_at=null where address_sha256=hook->>'sha';
   end if;
  end if;
  return result;
 end $$;
 grant execute on function app_private.cos_imported_legacy_guard(text) to service_role;`);
});
beforeEach(async()=>{await reset(db);await db.exec("truncate public.test_guard_calls;select set_config('test.guard_hook','',false)");await db.exec(replacement);});
after(async()=>db?.close());
function binding(n,overrides={}){
 return {schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:randomUUID(),productId:String(n),unitNumber:`SPOTTER ${n}`,family:'SPOTTER',variant:null,sourceRevision:randomUUID(),sourceFileSha256:'a'.repeat(64),sourceRowSha256:hash(String(n)),addressSha256:hash(`${n} fixture st, example, tx 77002`),nativeGuardSha256:'b'.repeat(64),installation:{street:`${n} Fixture St`,city:'Example',state:'TX',zip:'77002'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:String(n),...overrides};
}
async function jobs(bindings){
 await db.query('select app_private.cos_imported_assert_binding($1,value) from jsonb_array_elements($2)',[ORG,bindings]);
 await db.query(`insert into app_private.cos_imported_geocode_jobs(organization_id,entity_kind,native_unit_id,product_id,source_revision,event_id,binding,unit_number,address,address_sha256,legacy_guard_sha256)
 select $1,b->>'entityKind',(b->>'nativeUnitId')::uuid,b->>'productId',(b->>'sourceRevision')::uuid,(b->>'eventId')::bigint,b,b->>'unitNumber',app_private.cos_imported_address(b),b->>'addressSha256',app_private.cos_imported_legacy_guard(b->>'unitNumber')->>'sha256' from jsonb_array_elements($2) b`,[ORG,bindings]);
}
async function census(b,status,{lease=null,retry=null}={}){
 const request=status==='pending'?randomUUID():null;
 if(request)await db.query(`insert into app_private.cos_imported_census_requests(request_id,organization_id,binding,legacy_guard_sha256,address_sha256,reserved_at,lease_until) values($1,$2,$3,$4,$5,clock_timestamp()-interval '2 hours',clock_timestamp()+$6::interval)`,[request,ORG,b,'a'.repeat(64),b.addressSha256,lease]);
 await db.query(`insert into app_private.cos_imported_census_cache(organization_id,address_sha256,address,status,reason,active_request_id,lease_until,next_attempt_at,latitude,longitude,matched_address,geocoded_at)
 values($1,$2,app_private.cos_imported_address($3),$4,$5,$6,case when $7::text is null then null else clock_timestamp()+$7::interval end,case when $8::text is null then null else clock_timestamp()+$8::interval end,$9,$10,$11,case when $4='success' then clock_timestamp() end)`,[ORG,b.addressSha256,b,status,['success','pending'].includes(status)?null:status==='provider_error'?'provider_timeout':status,request,lease,retry,status==='success'?29:null,status==='success'?-95:null,status==='success'?'Synthetic matched address':null]);
}
async function fallback(b,status,{lease=null,retry=null}={}){
 const request=status==='pending'?randomUUID():null;
 if(request){
  await db.exec('insert into app_private.cos_geocodio_daily_budget values(current_date,1) on conflict do nothing');
  await db.query(`insert into app_private.cos_geocodio_reservations(request_id,organization_id,unit_key,address,address_sha256,budget_day,reserved_at,lease_until,send_before,job_kind,native_binding,legacy_guard_sha256)
   values($1,$2,$3,app_private.cos_imported_address($4),$5,current_date,clock_timestamp()-interval '2 hours',clock_timestamp()+$6::interval,clock_timestamp()-interval '119 minutes','native_import',$4,$7)`,[request,ORG,b.unitNumber,b,b.addressSha256,lease,'a'.repeat(64)]);
 }
 await db.query(`insert into app_private.cos_field_geocode_fallback_cache(organization_id,address_sha256,address,status,reason,active_request_id,lease_until,next_attempt_at,latitude,longitude,matched_address,accuracy_type,provider_accuracy,geocoded_at)
 values($1,$2,app_private.cos_imported_address($3),$4,$5,$6,case when $7::text is null then null else clock_timestamp()+$7::interval end,case when $8::text is null then null else clock_timestamp()+$8::interval end,$9,$10,$11,$12,$13,case when $4='success' then clock_timestamp() end)`,[ORG,b.addressSha256,b,status,status==='no_match'?'no_match':status==='provider_error'?'provider_timeout':status==='deferred'?'budget_exhausted':null,request,lease,retry,status==='success'?29:null,status==='success'?-95:null,status==='success'?'Synthetic matched address':null,status==='success'?'rooftop':null,status==='success'?1:null]);
}
async function due({limit=80,role='service_role',org=ORG}={}){
 await db.exec('truncate public.test_guard_calls');await db.exec(`set role ${role}`);const start=performance.now();let rows;
 try{rows=(await db.query('select public.cos_imported_geocode_list_due($1,$2) result',[org,limit])).rows[0].result;}finally{await db.exec('reset role');}
 return {rows,calls:(await db.query('select unit_number from public.test_guard_calls')).rows.map(r=>r.unit_number),elapsedMs:performance.now()-start};
}
async function parity(options){await db.exec(baseline);const old=await due(options);await db.exec(replacement);const next=await due(options);assert.deepEqual(next.rows,old.rows);return {old,next};}
const labels=rows=>rows.map(r=>[r.binding.unitNumber,r.stage]);

test('cache statuses, leases and retry times match baseline with only due guard calls',async()=>{
 const b=Array.from({length:17},(_,i)=>binding(i+1));await jobs(b);
 await census(b[1],'success');await census(b[2],'invalid_address');await census(b[3],'pending',{lease:'1 hour'});await census(b[4],'pending',{lease:'-1 hour'});
 await census(b[5],'provider_error',{retry:'1 day'});await census(b[6],'provider_error',{retry:'-1 day'});
 for(const item of b.slice(7))await census(item,'no_match');
 await fallback(b[8],'success');await fallback(b[9],'no_match');await fallback(b[10],'pending',{lease:'1 hour'});await fallback(b[11],'pending',{lease:'-1 hour'});
 await fallback(b[12],'provider_error',{retry:'1 day'});await fallback(b[13],'provider_error',{retry:'-1 day'});await fallback(b[14],'deferred',{retry:'1 day'});await fallback(b[15],'deferred',{retry:'-1 day'});await fallback(b[16],'provider_error');
 const {old,next}=await parity();assert.deepEqual(labels(next.rows),[[1,'census'],[5,'census'],[7,'census'],[8,'geocodio'],[12,'geocodio'],[14,'geocodio'],[16,'geocodio'],[17,'geocodio']].map(([n,s])=>[`SPOTTER ${n}`,s]));assert.equal(old.calls.length,17);assert.equal(next.calls.length,8);
});

test('disabled, non-free, blocked, cooldown and missing account gates retain Census work',async()=>{
 const b=[binding(1),binding(2)];await jobs(b);await census(b[1],'no_match');
 for(const mode of ['update app_private.cos_geocodio_control set enabled=false','update app_private.cos_geocodio_control set free_only=false',"update app_private.cos_geocodio_account_state set blocked_until=clock_timestamp()+interval '1 day'","update app_private.cos_geocodio_account_state set cooldown_until=clock_timestamp()+interval '1 day'",'delete from app_private.cos_geocodio_account_state']){
  await db.exec(mode);const {next}=await parity();assert.deepEqual(labels(next.rows),[['SPOTTER 1','census']]);assert.equal(next.calls.length,1);
  await db.exec('update app_private.cos_geocodio_control set enabled=true,free_only=true;insert into app_private.cos_geocodio_account_state(singleton) values(true) on conflict do nothing;update app_private.cos_geocodio_account_state set blocked_until=null,cooldown_until=null');
 }
});

test('Owner suppression and stale guard permit later allowed unit at a shared address',async()=>{
 const a=binding(1),b=binding(2,{installation:a.installation,addressSha256:a.addressSha256}),c=binding(3,{installation:a.installation,addressSha256:a.addressSha256}),d=binding(4,{installation:a.installation,addressSha256:a.addressSha256}),e=binding(5),f=binding(6);
 await jobs([a,b,c,d,e,f]);await seed(db,{id:1,unit:a.unitNumber});
 await db.query('update app_private.cos_imported_geocode_jobs set legacy_guard_sha256=$1 where native_unit_id=$2',['f'.repeat(64),b.nativeUnitId]);
 await db.query('update app_private.cos_imported_geocode_jobs set invalidated=true where native_unit_id=$1',[e.nativeUnitId]);await db.query('update app_private.cos_imported_geocode_jobs set binding=null where native_unit_id=$1',[f.nativeUnitId]);
 const {next}=await parity();assert.deepEqual(labels(next.rows),[[c.unitNumber,'census']]);assert.deepEqual(next.calls,[a.unitNumber,b.unitNumber,c.unitNumber]);
});

test('ordering, dedupe and limit80 preserved without premature candidate limit',async()=>{
 const b=Array.from({length:95},(_,i)=>binding(i+1,{eventId:String(Math.floor(i/3)+1),entityKind:i%2?'tracker':'equipment_unit'}));b[1].installation=b[0].installation;b[1].addressSha256=b[0].addressSha256;await jobs(b);
 for(const limit of [1,7,80]){const {next}=await parity({limit});assert.equal(next.rows.length,limit);assert.equal(new Set(next.rows.map(r=>r.binding.addressSha256)).size,limit);assert.deepEqual(next.rows,[...next.rows].sort((a,z)=>Number(a.binding.eventId)-Number(z.binding.eventId)||a.binding.entityKind.localeCompare(z.binding.entityKind)||a.binding.nativeUnitId.localeCompare(z.binding.nativeUnitId)));}
 await db.exec("update app_private.cos_imported_geocode_jobs set legacy_guard_sha256=repeat('f',64) where product_id::integer<=90");const {next}=await parity({limit:1});assert.equal(next.rows.length,1);assert.ok(Number(next.rows[0].binding.productId)>90);
});

test('service/fixed-org/limit gates and function ACL/attributes remain unchanged',async()=>{
 const metadata=async()=>(await db.query("select proowner,proacl,prosecdef,provolatile,proconfig,proargdefaults::text from pg_proc where oid='public.cos_imported_geocode_list_due(uuid,integer)'::regprocedure")).rows;
 await db.exec(baseline);const previous=await metadata();await db.exec(replacement);assert.deepEqual(await metadata(),previous);
 const definitions=async()=>(await db.query("select oid,pg_get_functiondef(oid) definition from pg_proc where pronamespace in ('public'::regnamespace,'app_private'::regnamespace) and oid<>'public.cos_imported_geocode_list_due(uuid,integer)'::regprocedure order by oid")).rows;
 const others=await definitions();await db.exec(replacement);assert.deepEqual(await definitions(),others);
 for(const limit of [null,0,-1,81])await assert.rejects(due({limit}),{code:'22023'});for(const role of ['anon','authenticated'])await assert.rejects(due({role}),{code:'42501'});for(const org of [null,randomUUID()])await assert.rejects(due({org}),{code:'42501'});
});

test('fresh post-guard stage reads handle Census advancement and terminal fallback',async()=>{
 const b=binding(1);await jobs([b]);await census(b,'provider_error');
 await db.query("select set_config('test.guard_hook',$1,false)",[JSON.stringify({unit:b.unitNumber,target:'census',sha:b.addressSha256})]);assert.deepEqual(labels((await due()).rows),[[b.unitNumber,'geocodio']]);
 await fallback(b,'provider_error');await db.query("select set_config('test.guard_hook',$1,false)",[JSON.stringify({unit:b.unitNumber,target:'fallback',sha:b.addressSha256})]);assert.deepEqual((await due()).rows,[]);
});

test('fleet completed caches reproduce wasted real legacy scans; guard work stays bounded as terminal rows grow',async t=>{
 await jobs([binding(10001),binding(10002),binding(10003)]);let last=0;
 for(const total of [185,555]){
  const added=[];for(let n=last+1;n<=total;n++){const shared=binding(Math.floor((n-1)/5)+20000);added.push(binding(n,{installation:shared.installation,addressSha256:shared.addressSha256}));}await jobs(added);
  for(const b of added){if(!(await db.query('select 1 from app_private.cos_imported_census_cache where address_sha256=$1',[b.addressSha256])).rows.length)await census(b,'success');}
  if(!last)await db.exec(`insert into public.camera_devices select n,'LEGACY FIXTURE '||n from generate_series(1,185) n;insert into public.camera_inventory_audit select n,'${OWNER}','OTHER','LEGACY FIXTURE '||((n-1)%185+1),array[((n-1)%185+1)::bigint],'{}'::jsonb from generate_series(1,740) n;`);
  const {old,next}=await parity();assert.equal(next.rows.length,3);assert.equal(next.calls.length,3);assert.equal(old.calls.length,total+3);t.diagnostic(`${total} terminal jobs: baseline ${old.calls.length} real guards / ${old.elapsedMs.toFixed(1)}ms; replacement ${next.calls.length} / ${next.elapsedMs.toFixed(1)}ms`);last=total;
 }
});
