import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixture,reset,seed,reserve as ownerReserve,finish as ownerFinish,credits,ORG,hash} from './fixtures/geocodio-database-fixture.mjs';
let db;
before(async()=>{db=await fixture({imported:true});});
beforeEach(async()=>reset(db));
after(async()=>db?.close());
const binding=(n=1,zip='77002-1234')=>({schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:randomUUID(),productId:String(n),unitNumber:`SPOTTER ${n}`,family:'SPOTTER',variant:null,sourceRevision:randomUUID(),sourceFileSha256:'a'.repeat(64),sourceRowSha256:'b'.repeat(64),addressSha256:hash(`${n} main st, houston, tx ${zip}`),nativeGuardSha256:'c'.repeat(64),installation:{street:`${n} Main St`,city:'Houston',state:'TX',zip},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:String(n)});
async function rpc(name,args={},role='service_role'){
 await db.exec('reset role');await db.exec(`set role ${role}`);
 try{return (await db.query(`select public.cos_imported_geocode_${name}(${Object.keys({p_organization_id:ORG,...args}).map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,Object.values({p_organization_id:ORG,...args}))).rows[0].result;}
 finally{await db.exec('reset role');}
}
async function sync(bs){const c=await rpc('cursor_read');return rpc('sync',{p_scan_generation:c.scanGeneration,p_after_event_id:c.eventId,p_next_event_id:bs.at(-1).eventId,p_events:bs.map(b=>({eventId:b.eventId,entityKind:b.entityKind,nativeUnitId:b.nativeUnitId,productId:b.productId,sourceRevision:b.sourceRevision,source:b}))});}
const claim=(b,id=randomUUID())=>rpc('census_claim',{p_binding:b,p_request_id:id});
const census=(b,t,result={p_status:'no_match'})=>rpc('census_finish',{p_binding:b,p_claim_token:t,p_source_current:true,...result});
const reserve=(b,id=randomUUID())=>rpc('reserve',{p_binding:b,p_request_id:id});
const geo=(b,t,result={p_status:'no_match'})=>rpc('finish',{p_binding:b,p_reservation_token:t,p_source_current:true,...result});
const enroll=bs=>rpc('postal_retry_enroll',{p_bindings:bs});
const due=()=>rpc('postal_retry_list_due');
const success={p_status:'success',p_latitude:29,p_longitude:-95,p_matched_address:'1 Main St, Houston, TX 77002'};
const paidSuccess={...success,p_accuracy_type:'rooftop',p_accuracy:1};
async function terminal(b,{paid=true}={}){await census(b,(await claim(b)).claimToken);if(paid)await geo(b,(await reserve(b)).reservationToken);}
const rows=async table=>(await db.query(`select to_jsonb(t) value from app_private.${table} t order by to_jsonb(t)::text`)).rows;
const marker=async()=>(await db.query('select * from app_private.cos_imported_postal_retry_jobs')).rows[0];
const caches=async()=>({c:await rows('cos_imported_census_cache'),f:await rows('cos_field_geocode_fallback_cache'),budget:await rows('cos_geocodio_daily_budget'),q:await rows('cos_imported_census_requests'),r:await rows('cos_geocodio_reservations')});

test('enrollment freezes a bounded full-binding manifest and changes no cache, source, attempt, lease or credit',async()=>{
 const a=binding(),b=binding(2);await sync([a,b]);await terminal(a);await terminal(b);
 const before=await caches(),sources=await rows('cos_imported_geocode_jobs');
 assert.deepEqual(await enroll([b,a]),{policyVersion:'us_zip_precision_v1',enrolled:2,existing:0,skipped:0});
 assert.deepEqual(await caches(),before);assert.deepEqual(await rows('cos_imported_geocode_jobs'),sources);
 assert.equal((await enroll([a,b])).existing,2);assert.deepEqual(await caches(),before);
 await assert.rejects(enroll([a]),/cohort is frozen/);await assert.rejects(enroll([a,b,binding(3)]),/cohort is frozen/);
 assert.equal((await due()).length,2);assert.ok((await due()).every(x=>x.stage==='census'));
 await assert.rejects(enroll(Array(81).fill(a)),/1 to 80/);
 for(const role of ['anon','authenticated']){await assert.rejects(rpc('postal_retry_enroll',{p_bindings:[a,b]},role));await assert.rejects(rpc('postal_retry_list_due',{},role));}
});

test('enrollment is atomic and excludes malformed ZIP5, stale/GPS-held bindings, successful or active caches',async()=>{
 const a=binding(),b=binding(2,'77002');await sync([a,b]);await terminal(a);await terminal(b);
 await assert.rejects(enroll([a,b]),/string ZIP\+4/);assert.deepEqual(await rows('cos_imported_postal_retry_batches'),[]);
 await assert.rejects(enroll([{...a,nativeGuardSha256:'d'.repeat(64)}]),/not current/);
 await db.exec("update app_private.cos_imported_geocode_jobs set invalidated=true where product_id='1'");await assert.rejects(enroll([a]),/not current/);
 await db.exec("update app_private.cos_imported_geocode_jobs set invalidated=false where product_id='1'");
 await db.exec("update app_private.cos_field_geocode_fallback_cache set status='success',reason=null,latitude=29,longitude=-95,matched_address=address,accuracy_type='rooftop',provider_accuracy=1 where address like '1 %'");
 await assert.rejects(enroll([a]),/fallback must be absent or exact terminal/);assert.deepEqual(await rows('cos_imported_postal_retry_batches'),[]);
});

test('same-hash sources enroll once and only the frozen current binding can claim its one-time retry',async()=>{
 const a=binding(),b={...binding(2),installation:a.installation,addressSha256:a.addressSha256};await sync([a,b]);await terminal(a);
 assert.equal((await enroll([a,b])).enrolled,1);const chosen=(await due())[0].binding,other=chosen.nativeUnitId===a.nativeUnitId?b:a;
 assert.equal((await claim(other)).reason,'retry_bound_elsewhere');assert.equal((await claim(chosen)).claimed,true);assert.equal((await claim(chosen)).reason,'duplicate_inflight');assert.equal(await credits(db),1);
});

test('Census retry bypasses only historical Owner no_match and blocks imported/Owner fallback until actual completion',async()=>{
 const b=binding();await sync([b]);const key=await seed(db,{unit:'Unrelated',address:'1 main st, houston, tx 77002-1234'});
 const reused=await claim(b);assert.equal(reused.claimed,false);assert.equal(reused.record.status,'no_match');assert.equal((await rows('cos_imported_census_requests')).length,0);
 await enroll([b]);const before=await caches();assert.equal((await reserve(b)).reason,'census_required');assert.equal((await ownerReserve(db,key)).reserved,false);assert.deepEqual(await caches(),before);
 const c=await claim(b);assert.equal(c.claimed,true);assert.equal(c.record.status,'pending');assert.ok(c.record.leaseUntil);assert.equal((await marker()).census_claims,1);assert.equal(await credits(db),0);
 await census(b,c.claimToken,success);assert.equal((await marker()).phase,'complete');assert.deepEqual(await due(),[]);
 assert.equal((await ownerReserve(db,key)).reason,'census_success');assert.equal(await credits(db),0);
 assert.equal((await claim(b)).reason,'cache_hit');assert.equal((await enroll([b])).existing,1);assert.equal((await rows('cos_imported_census_requests')).length,1);assert.equal(await credits(db),0);
 assert.equal((await db.query('select status from app_private.cos_field_geocode_cache')).rows[0].status,'no_match');
});

test('fresh Census no_match permits exactly one Geocodio terminal reopen and replay cannot send again',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);const old=await rows('cos_field_geocode_fallback_cache');
 const c=await claim(b);await census(b,c.claimToken,{p_status:'no_match',p_reason:'provider_empty'});assert.deepEqual(await rows('cos_field_geocode_fallback_cache'),old);assert.equal((await due())[0].stage,'geocodio');
 const id=randomUUID(),r=await reserve(b,id);assert.equal(r.reserved,true);assert.equal(r.record.status,'pending');assert.equal(r.record.attempts,2);assert.equal(await credits(db),2);
 assert.equal((await reserve(b,id)).reason,'reservation_replayed');assert.equal((await reserve(b)).reason,'duplicate_inflight');
 await geo(b,r.reservationToken,{p_status:'no_match',p_reason:'component_mismatch'});assert.equal((await marker()).phase,'complete');assert.deepEqual(await due(),[]);
 assert.equal((await reserve(b)).reason,'cache_hit');assert.equal((await enroll([b])).existing,1);assert.equal(await credits(db),2);
 assert.equal((await marker()).geocodio_claims,1);assert.equal((await rows('cos_geocodio_reservations')).length,2);
});

test('budget, account stops and daily attempts retain the exact old terminal no_match until real reservation',async()=>{
 for(const kind of ['budget','daily','forbidden','rate','disabled']){
  await reset(db);const b=binding();await sync([b]);await terminal(b);
  if(kind==='daily')await db.exec("update app_private.cos_field_geocode_fallback_cache set attempts=3");
  await enroll([b]);await census(b,(await claim(b)).claimToken,{p_status:'no_match',p_reason:'provider_empty'});
  if(kind==='budget')await db.exec('update app_private.cos_geocodio_daily_budget set credits=2400');
  if(kind==='forbidden')await db.exec("update app_private.cos_geocodio_account_state set blocked_until=clock_timestamp()+interval '1 hour'");
  if(kind==='rate')await db.exec("update app_private.cos_geocodio_account_state set cooldown_until=clock_timestamp()+interval '1 hour'");
  if(kind==='disabled')await db.exec('update app_private.cos_geocodio_control set enabled=false');
  const before=await caches();const r=await reserve(b);assert.equal(r.reserved,false,kind);assert.equal(r.record.status,'no_match',kind);assert.deepEqual(await caches(),before,kind);assert.equal((await marker()).geocodio_claims,0);
 }
});

test('changed snapshots or newer success cannot be overwritten, and source/GPS change suppresses late publication',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);
 await db.exec("update app_private.cos_imported_census_cache set reason='provider_empty'");assert.deepEqual(await due(),[]);assert.equal((await claim(b)).claimed,false);assert.equal(await credits(db),1);
 await reset(db);await sync([b]);await terminal(b);await enroll([b]);
 await db.exec("update app_private.cos_field_geocode_fallback_cache set status='success',reason=null,latitude=29,longitude=-95,matched_address=address,accuracy_type='rooftop',provider_accuracy=1");
 const prior=await caches();assert.equal((await claim(b)).claimed,false);assert.deepEqual(await caches(),prior);assert.equal((await marker()).phase,'complete');
 await reset(db);await sync([b]);await terminal(b);await enroll([b]);const c=await claim(b);await rpc('invalidate',{p_binding:b});
 assert.equal((await census(b,c.claimToken,success)).accepted,false);assert.deepEqual(await due(),[]);assert.equal((await reserve(b)).reserved,false);assert.equal(await credits(db),1);
});

test('Census policy cap survives next-day attempt resets and direct calls, preserving real error results',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);
 for(let i=0;i<3;i++){
  if(i)await db.exec("update app_private.cos_imported_census_cache set next_attempt_at=clock_timestamp()-interval '1 second',attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
  const r=await claim(b);assert.equal(r.claimed,true);await census(b,r.claimToken,{p_status:'provider_error',p_reason:'provider_timeout'});
 }
 assert.equal((await marker()).phase,'exhausted');assert.equal((await marker()).census_claims,3);assert.deepEqual(await due(),[]);
 await db.exec("update app_private.cos_imported_census_cache set next_attempt_at=clock_timestamp()-interval '1 second',attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
 assert.equal((await claim(b)).reason,'retry_deferred');assert.equal((await reserve(b)).reserved,false);assert.equal(await credits(db),1);
 assert.equal((await db.query('select status,reason from app_private.cos_imported_census_cache')).rows[0].status,'provider_error');
});

test('paid policy cap cannot be bypassed by ordinary imported or Owner calls across days; no refunds',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);await census(b,(await claim(b)).claimToken);
 const owner=await seed(db,{unit:'Other',address:'1 main st, houston, tx 77002-1234'});
 for(let i=0;i<3;i++){
  if(i)await db.exec("update app_private.cos_field_geocode_fallback_cache set next_attempt_at=clock_timestamp()-interval '1 second',attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
  assert.equal((await ownerReserve(db,owner)).reserved,false);
  const r=await reserve(b);assert.equal(r.reserved,true);await geo(b,r.reservationToken,{p_status:'provider_error',p_reason:'provider_timeout'});
 }
 assert.equal((await marker()).phase,'exhausted');assert.equal((await marker()).geocodio_claims,3);assert.equal(await credits(db),4);
 await db.exec("update app_private.cos_field_geocode_fallback_cache set next_attempt_at=clock_timestamp()-interval '1 second',attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
 assert.equal((await reserve(b)).reason,'retry_deferred');assert.equal((await ownerReserve(db,owner)).reserved,false);assert.equal(await credits(db),4);
 assert.equal((await db.query('select status,reason from app_private.cos_field_geocode_fallback_cache')).rows[0].reason,'provider_timeout');
});

test('migration replays preserve frozen cohort and all cache data, and leave ordinary queue-prefilter definitions untouched',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);const before=await caches(),markers=await rows('cos_imported_postal_retry_jobs'),batches=await rows('cos_imported_postal_retry_batches');
 const queues=async()=>(await db.query("select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cos_imported_geocode_list_due','cos_field_geocode_fallback_list_due') order by p.proname")).rows;
 const queueBefore=await queues();const sql=await readFile(new URL('../db/geocodio-postal-retry-v1.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 assert.deepEqual(await queues(),queueBefore);assert.deepEqual(await caches(),before);assert.deepEqual(await rows('cos_imported_postal_retry_jobs'),markers);assert.deepEqual(await rows('cos_imported_postal_retry_batches'),batches);
});


test('new Owner placement retires a stale import marker and retains normal Owner fallback authority',async()=>{
 const b=binding();await sync([b]);await terminal(b,{paid:false});await enroll([b]);
 const owner=await seed(db,{unit:'SPOTTER 1',address:'1 main st, houston, tx 77002-1234'});
 const r=await ownerReserve(db,owner);assert.equal(r.reserved,true);assert.equal((await marker()).phase,'cancelled');assert.equal(await credits(db),1);
 assert.equal((await ownerFinish(db,owner,r.reservationToken,paidSuccess)).accepted,true);assert.deepEqual(await due(),[]);
});

test('stale source revision cancels recovery, while legacy lock contention never cancels a current marker',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);
 const original=(await db.query("select pg_get_functiondef('app_private.cos_imported_try_lock_legacy()'::regprocedure) definition")).rows[0].definition;
 await db.exec("create or replace function app_private.cos_imported_try_lock_legacy() returns boolean language sql set search_path='' as $$select false$$");
 assert.deepEqual(await due(),[]);assert.equal((await marker()).phase,'census');assert.equal((await claim(b)).claimed,false);
 await db.exec(original);const newer={...b,eventId:'2',sourceRevision:randomUUID()};await sync([newer]);
 assert.deepEqual(await due(),[]);assert.equal((await marker()).phase,'cancelled');assert.equal((await claim(newer)).reason,'cache_hit');assert.equal(await credits(db),1);
});

test('third expired Census lease consumes its real attempt and cannot authorize a fourth policy request',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);
 for(let i=0;i<2;i++){
  if(i)await db.exec("update app_private.cos_imported_census_cache set next_attempt_at=clock_timestamp()-interval '1 second',attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
  await census(b,(await claim(b)).claimToken,{p_status:'provider_error',p_reason:'provider_timeout'});
 }
 await db.exec("update app_private.cos_imported_census_cache set next_attempt_at=clock_timestamp()-interval '1 second',attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
 const c=await claim(b);assert.equal(c.claimed,true);
 await db.exec("update app_private.cos_imported_census_requests set lease_until=clock_timestamp()-interval '1 second' where completed_at is null;update app_private.cos_imported_census_cache set lease_until=clock_timestamp()-interval '1 second'");
 assert.equal((await due())[0].stage,'census');assert.equal((await claim(b)).reason,'provider_timeout');
 await db.exec("update app_private.cos_imported_census_cache set next_attempt_at=clock_timestamp()-interval '1 second',attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
 assert.equal((await claim(b)).reason,'retry_deferred');assert.equal((await marker()).phase,'exhausted');assert.equal((await marker()).census_claims,3);assert.equal(await credits(db),1);
});


test('expired third paid retry retains its charged credit and permanently exhausts this policy for the current binding',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);await census(b,(await claim(b)).claimToken);
 for(let i=0;i<2;i++){
  if(i)await db.exec("update app_private.cos_field_geocode_fallback_cache set next_attempt_at=clock_timestamp()-interval '1 second',attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
  await geo(b,(await reserve(b)).reservationToken,{p_status:'provider_error',p_reason:'provider_timeout'});
 }
 await db.exec("update app_private.cos_field_geocode_fallback_cache set next_attempt_at=clock_timestamp()-interval '1 second',attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
 const g=await reserve(b);assert.equal(g.reserved,true);assert.equal(await credits(db),4);
 await db.exec("update app_private.cos_geocodio_reservations set reserved_at=clock_timestamp()-interval '2 minutes',send_before=clock_timestamp()-interval '119 seconds',lease_until=clock_timestamp()-interval '1 second' where completed_at is null;update app_private.cos_field_geocode_fallback_cache set lease_until=clock_timestamp()-interval '1 second'");
 assert.equal((await due())[0].stage,'geocodio');assert.equal((await reserve(b)).reason,'provider_timeout');assert.equal((await marker()).phase,'exhausted');
 assert.equal((await geo(b,g.reservationToken,paidSuccess)).accepted,false);assert.equal(await credits(db),4);assert.equal((await reserve(b)).reason,'retry_deferred');assert.deepEqual(await due(),[]);
});

for(const stage of ['census','geocodio'])test('cancelled '+stage+' policy cannot resume for the identical binding after a stale bridge result',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);const c=await claim(b);
 if(stage==='census')assert.equal((await census(b,c.claimToken,{p_status:'provider_error',p_reason:'provider_timeout',p_source_current:false})).accepted,false);
 else{
  await census(b,c.claimToken);const r=await reserve(b);assert.equal(r.reserved,true);
  assert.equal((await geo(b,r.reservationToken,{p_status:'provider_error',p_reason:'provider_timeout',p_source_current:false})).accepted,false);
 }
 assert.equal((await marker()).phase,'cancelled');const charged=await credits(db),before=await caches();
 for(let i=0;i<3;i++)assert.equal((await (stage==='census'?claim(b):reserve(b))).reason,'retry_cancelled');
 assert.deepEqual(await caches(),before);assert.equal(await credits(db),charged);assert.deepEqual(await due(),[]);
 // Daily reset or expiry cannot revive that cancelled exact revision.
 if(stage==='census')await db.exec("update app_private.cos_imported_census_requests set lease_until=clock_timestamp()-interval '1 second' where completed_at is null;update app_private.cos_imported_census_cache set lease_until=clock_timestamp()-interval '1 second',next_attempt_at=null,attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
 else await db.exec("update app_private.cos_geocodio_reservations set reserved_at=clock_timestamp()-interval '2 minutes',send_before=clock_timestamp()-interval '119 seconds',lease_until=clock_timestamp()-interval '1 second' where completed_at is null;update app_private.cos_field_geocode_fallback_cache set lease_until=clock_timestamp()-interval '1 second',next_attempt_at=null,attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
 assert.equal((await (stage==='census'?claim(b):reserve(b))).reason,'retry_cancelled');assert.equal(await credits(db),charged);
 // A truly revised source may use normal lease recovery, without reopening this marker.
 const newer={...b,eventId:'2',sourceRevision:randomUUID()};await sync([newer]);
 assert.equal((await (stage==='census'?claim(newer):reserve(newer))).reason,'provider_timeout');assert.equal((await marker()).phase,'cancelled');assert.equal(await credits(db),charged);
});

test('an unchanged cancelled binding cannot evade the policy through a shared-address Owner request',async()=>{
 const b=binding();await sync([b]);await terminal(b);await enroll([b]);await census(b,(await claim(b)).claimToken);
 const r=await reserve(b);await geo(b,r.reservationToken,{p_status:'provider_error',p_reason:'provider_timeout',p_source_current:false});
 assert.equal((await marker()).phase,'cancelled');const owner=await seed(db,{unit:'Unrelated',address:'1 main st, houston, tx 77002-1234'});
 const charged=await credits(db),before=await rows('cos_field_geocode_fallback_cache');
 assert.equal((await ownerReserve(db,owner)).reason,'retry_deferred');assert.deepEqual(await rows('cos_field_geocode_fallback_cache'),before);assert.equal(await credits(db),charged);
 await db.exec("update app_private.cos_geocodio_reservations set reserved_at=clock_timestamp()-interval '2 minutes',send_before=clock_timestamp()-interval '119 seconds',lease_until=clock_timestamp()-interval '1 second' where completed_at is null;update app_private.cos_field_geocode_fallback_cache set lease_until=clock_timestamp()-interval '1 second',next_attempt_at=null,attempt_day=(clock_timestamp() at time zone 'America/New_York')::date-1");
 assert.equal((await ownerReserve(db,owner)).reason,'retry_deferred');assert.equal(await credits(db),charged);
 // A real local source revision change releases normal Owner lease recovery.
 await sync([{...b,eventId:'2',sourceRevision:randomUUID()}]);assert.equal((await ownerReserve(db,owner)).reason,'provider_timeout');assert.equal(await credits(db),charged);
});

for(const stage of ['census','geocodio'])test('another preexisting imported binding cannot escape cancelled '+stage+' recovery at the same hash',async()=>{
 const a=binding(),b={...binding(2),installation:a.installation,addressSha256:a.addressSha256};await sync([a,b]);await terminal(a);await enroll([a]);
 const c=await claim(a);
 if(stage==='census')await census(a,c.claimToken,{p_status:'provider_error',p_reason:'provider_timeout',p_source_current:false});
 else{await census(a,c.claimToken);const g=await reserve(a);await geo(a,g.reservationToken,{p_status:'provider_error',p_reason:'provider_timeout',p_source_current:false});}
 assert.equal((await marker()).phase,'cancelled');const before=await caches(),charged=await credits(db);
 assert.equal((await (stage==='census'?claim(b):reserve(b))).reason,'retry_bound_elsewhere');assert.deepEqual(await caches(),before);assert.equal(await credits(db),charged);
});

for(const phase of ['exhausted','cancelled'])test('80 '+phase+' policy hashes cannot starve newer ordinary v2 work',async()=>{
 const bs=Array.from({length:81},(_,i)=>binding(i+1));await sync(bs);
 await db.exec("insert into app_private.cos_imported_census_cache(organization_id,address_sha256,address,status,reason,attempts,attempt_day,geocoded_at) select organization_id,address_sha256,address,'no_match','no_match',1,(clock_timestamp() at time zone 'America/New_York')::date,clock_timestamp() from app_private.cos_imported_geocode_jobs where product_id<>'81';insert into app_private.cos_field_geocode_fallback_cache(organization_id,address_sha256,address,status,reason,attempts,attempt_day,geocoded_at) select organization_id,address_sha256,address,'no_match','no_match',1,(clock_timestamp() at time zone 'America/New_York')::date,clock_timestamp() from app_private.cos_imported_geocode_jobs where product_id<>'81'");
 await enroll(bs.slice(0,80));await db.query('update app_private.cos_imported_postal_retry_jobs set phase=$1',[phase]);
 await db.exec("update app_private.cos_imported_census_cache set status='provider_error',reason='provider_timeout',next_attempt_at=clock_timestamp()-interval '1 second'");
 const old=await rpc('list_due');assert.equal(old.length,80);assert.equal(old.some(x=>x.binding.productId==='81'),false);
 const fresh=await rpc('postal_ordinary_list_due');assert.equal(fresh.length,1);assert.equal(fresh[0].binding.productId,'81');assert.equal(fresh[0].stage,'census');
 assert.equal((await claim(bs[80])).claimed,true);assert.equal(await credits(db),0);
});

test('ordinary postal reader releases genuinely revised shared-address work while preserving original v2 ordering',async()=>{
 const a=binding(),b={...binding(2),installation:a.installation,addressSha256:a.addressSha256};await sync([a,b]);await terminal(a);await enroll([a]);
 await census(a,(await claim(a)).claimToken,{p_status:'provider_error',p_reason:'provider_timeout',p_source_current:false});
 await db.exec("update app_private.cos_imported_census_cache set lease_until=clock_timestamp()-interval '1 second',next_attempt_at=null");
 assert.deepEqual(await rpc('postal_ordinary_list_due'),[]);
 const revised={...a,eventId:'3',sourceRevision:randomUUID()};await sync([revised]);
 const expected=await rpc('list_due'),actual=await rpc('postal_ordinary_list_due');assert.deepEqual(actual,expected);assert.equal(actual.length,1);assert.equal(actual[0].binding.nativeUnitId,b.nativeUnitId);
 assert.equal((await claim(actual[0].binding)).reason,'provider_timeout');assert.equal((await marker()).phase,'cancelled');
});
test('fresh safely diagnosed no_match results are ineligible for historical unknown-cause recovery',async()=>{
 const b=binding();await sync([b]);await terminal(b);
 await db.exec("update app_private.cos_imported_census_cache set reason='provider_empty'");await assert.rejects(enroll([b]),/terminal Census no_match/);assert.deepEqual(await rows('cos_imported_postal_retry_batches'),[]);
 await db.exec("update app_private.cos_imported_census_cache set reason='no_match';update app_private.cos_field_geocode_fallback_cache set reason='component_mismatch'");await assert.rejects(enroll([b]),/fallback must be absent or exact terminal/);assert.deepEqual(await rows('cos_imported_postal_retry_batches'),[]);
});
