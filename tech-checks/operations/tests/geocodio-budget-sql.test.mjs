import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture,reset,seed,rpc,reserve,finish,credits,ORG,OWNER,IT,SERVICE,hash } from './fixtures/geocodio-database-fixture.mjs';
let db;
before(async()=>{db=await fixture();});
beforeEach(async()=>reset(db));
after(async()=>db?.close());
const read=ids=>rpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:ids});
const error=(reason,delay)=>({p_status:'provider_error',p_reason:reason,...(delay===undefined?{}:{p_retry_after_seconds:delay})});

test('DDL defaults disabled and free-only unconfirmed; absent config fails closed',async()=>{
 // reset() enables test control, so inspect the installed defaults explicitly.
 const defaults=(await db.query("select column_name,column_default from information_schema.columns where table_name='cos_geocodio_control'")).rows;
 assert.equal(defaults.find(x=>x.column_name==='enabled').column_default,'false');
 assert.equal(defaults.find(x=>x.column_name==='free_only').column_default,'false');
 const key=await seed(db);
 await db.exec('update app_private.cos_geocodio_control set enabled=false');
 assert.deepEqual(await rpc(db,'list_due',{p_organization_id:ORG}),[]);
 let r=await reserve(db,key); assert.equal(r.reserved,false);assert.equal(r.reason,'configuration_unavailable');assert.equal(r.record.status,'deferred');
 await db.exec('delete from app_private.cos_geocodio_control');
 r=await reserve(db,key);assert.equal(r.reserved,false);assert.equal(await credits(db),0);
 await db.exec('insert into app_private.cos_geocodio_control(singleton) values(true)');
});

test('missing state or free_only false cannot reserve; limit cannot exceed 2400',async()=>{
 const key=await seed(db);
 await db.exec('update app_private.cos_geocodio_control set free_only=false');
 assert.equal((await reserve(db,key)).reason,'configuration_unavailable');
 await assert.rejects(db.exec('update app_private.cos_geocodio_control set daily_limit=2401'));
 await db.exec('delete from app_private.cos_geocodio_account_state');
 assert.equal((await reserve(db,key)).reason,'configuration_unavailable');
 await db.exec('insert into app_private.cos_geocodio_account_state(singleton) values(true)');
 assert.equal(await credits(db),0);
});

test('only exact current Census no_match queues; success and invalid input do not',async()=>{
 const key=await seed(db);await seed(db,{id:2,status:'success'});await seed(db,{id:3,status:'invalid_address'});
 const due=await rpc(db,'list_due',{p_organization_id:ORG});assert.deepEqual(due.map(x=>x.auditId),['1']);
 await assert.rejects(reserve(db,{...key,p_address_sha256:'0'.repeat(64)}));
 await assert.rejects(rpc(db,'list_due',{p_organization_id:ORG,p_limit:6}));
 assert.equal((await reserve(db,{...key,p_audit_id:'2',p_unit_key:'Unit-2',p_address:'2 main st, houston, tx 77002',p_address_sha256:hash('2 main st, houston, tx 77002')})).reason,'ineligible');
 assert.equal(await credits(db),0);
});

test('one reservation commits one credit; replay and duplicate address cannot resend',async()=>{
 const key=await seed(db);const twin=await seed(db,{id:2,address:key.p_address});const id=randomUUID();
 const first=await reserve(db,key,id);assert.equal(first.reserved,true);assert.ok(first.reservationToken);
 assert.ok(new Date(first.sendBefore)>new Date());assert.ok(new Date(first.sendBefore)-new Date()<11000);
 assert.equal((await reserve(db,key,id)).reason,'reservation_replayed');
 const duplicate=await reserve(db,twin);assert.equal(duplicate.reason,'duplicate_inflight');assert.equal(duplicate.reservationToken,null);
 assert.equal(await credits(db),1);assert.equal((await read(['1','2'])).length,2);
});

test('successful estimate is distinct provenance, current exact projection, and reusable within organization',async()=>{
 const key=await seed(db);const twin=await seed(db,{id:2,address:key.p_address});const reservation=await reserve(db,key);
 const censusBefore=(await db.query('select row_to_json(c) value from app_private.cos_field_geocode_cache c order by audit_id')).rows;
 const saved=await finish(db,key,reservation.reservationToken);assert.equal(saved.accepted,true);
 assert.equal(saved.record.provider,'geocodio');assert.equal(saved.record.accuracyType,'rooftop');assert.equal(saved.record.matchType,'building_centroid');
 assert.equal(saved.record.confidence,'estimate');assert.equal(saved.record.verified,false);assert.equal(saved.record.liveGps,false);
 const cached=await reserve(db,twin);assert.equal(cached.reason,'cache_hit');assert.equal(cached.record.auditId,'2');assert.equal(cached.record.unitKey,'Unit-2');
 assert.equal(await credits(db),1);assert.equal((await read(['1','2'])).length,2);
 assert.deepEqual((await db.query('select row_to_json(c) value from app_private.cos_field_geocode_cache c order by audit_id')).rows,censusBefore);
 assert.equal((await finish(db,key,reservation.reservationToken)).accepted,true);
});

test('address cache cannot leak across organizations and wrong organization is rejected',async()=>{
 const key=await seed(db);await finish(db,key,(await reserve(db,key)).reservationToken);
 const other=randomUUID();await db.query('update app_private.cos_field_geocode_fallback_cache set organization_id=$1',[other]);
 assert.deepEqual(await read(['1']),[]);
 await assert.rejects(rpc(db,'read_many',{p_organization_id:other,p_audit_ids:['1']}));
 assert.equal((await reserve(db,key)).reserved,true);assert.equal(await credits(db),2);
});

test('invalid accuracy, type, metadata and non-finite coordinates are rejected without changing credits',async()=>{
 const key=await seed(db);const r=await reserve(db,key);const base={p_status:'success',p_latitude:29,p_longitude:-95,p_matched_address:key.p_address,p_accuracy_type:'rooftop',p_accuracy:1};
 for(const bad of [{p_accuracy:0.89},{p_accuracy:1.1},{p_accuracy_type:'place'},{p_match_type:'unit'},{p_match_type:'arbitrary vendor text'},{p_accuracy_type:'range_interpolation',p_match_type:'parcel_centroid'},{p_latitude:Infinity},{p_latitude:NaN},{p_matched_address:'raw\nunsafe'},{p_reason:'provider_unavailable'}])
  await assert.rejects(finish(db,key,r.reservationToken,{...base,...bad}));
 const saved=await finish(db,key,r.reservationToken,{...base,p_accuracy_type:'range_interpolation',p_accuracy:0.9});
 assert.equal(saved.record.accuracyType,'range_interpolation');assert.equal(saved.record.accuracy,0.9);assert.equal(await credits(db),1);
});

test('new audit, edited address, and different current device set invalidate read and finish',async()=>{
 for(const mutation of ['audit','address','devices']){
  await reset(db);const key=await seed(db);const r=await reserve(db,key);
  if(mutation==='audit') await db.exec(`insert into public.camera_inventory_audit select 100,actor_id,'MOVE_TO_SHOP',unit_key,device_ids,after_state from public.camera_inventory_audit`);
  if(mutation==='address') await db.exec(`update public.camera_inventory_audit set after_state=jsonb_set(after_state,'{street_address}','"99 other st, houston, tx 77002"')`);
  if(mutation==='devices') await db.exec("insert into public.camera_devices values(2,'Unit-1')");
  assert.equal((await finish(db,key,r.reservationToken)).accepted,false);assert.deepEqual(await read(['1']),[]);
  assert.equal((await reserve(db,key)).reason,'superseded');assert.equal(await credits(db),1);
 }
});

test('successful cached result is hidden after current-device removal or newer placement',async()=>{
 const key=await seed(db);await finish(db,key,(await reserve(db,key)).reservationToken);
 assert.equal((await read(['1'])).length,1);
 await db.exec('delete from public.camera_devices');assert.deepEqual(await read(['1']),[]);
});

test('no_match is a cached terminal result; Census no_match remains unchanged',async()=>{
 const key=await seed(db);const saved=await finish(db,key,(await reserve(db,key)).reservationToken,{p_status:'no_match'});
 assert.equal(saved.record.status,'no_match');assert.equal(saved.record.reason,'no_match');
 assert.equal((await reserve(db,key)).reason,'cache_hit');assert.deepEqual(await rpc(db,'list_due',{p_organization_id:ORG}),[]);assert.equal(await credits(db),1);
});

test('budget boundary permits only remaining three credits and daily exhaustion defers',async()=>{
 const keys=[];for(let id=1;id<=9;id++)keys.push(await seed(db,{id}));
 await db.exec("insert into app_private.cos_geocodio_daily_budget values((clock_timestamp() at time zone 'America/New_York')::date,2397)");
 const results=[];for(const key of keys)results.push(await reserve(db,key));
 assert.equal(results.filter(r=>r.reserved).length,3);assert.equal(results.filter(r=>r.reason==='budget_exhausted').length,6);
 assert.equal(await credits(db),2400);assert.ok(results[8].record.nextAttemptAt);
});

test('expired or uncertain lease never refunds, replays, or accepts late coordinates',async()=>{
 const key=await seed(db);const request=randomUUID();const r=await reserve(db,key,request);
 await db.exec("update app_private.cos_geocodio_reservations set reserved_at=clock_timestamp()-interval '2 minutes',send_before=clock_timestamp()-interval '119 seconds',lease_until=clock_timestamp()-interval '60 seconds';update app_private.cos_field_geocode_fallback_cache set lease_until=clock_timestamp()-interval '60 seconds'");
 assert.equal((await reserve(db,key,request)).reason,'reservation_replayed');
 assert.equal((await reserve(db,key)).reason,'provider_timeout');assert.equal(await credits(db),1);
 assert.equal((await finish(db,key,r.reservationToken)).accepted,false);
 assert.equal((await reserve(db,key)).reserved,false);assert.equal(await credits(db),1);
 await db.exec("update app_private.cos_field_geocode_fallback_cache set next_attempt_at=clock_timestamp()-interval '1 second'");
 assert.equal((await reserve(db,key)).reserved,true);assert.equal(await credits(db),2);
});

test('provider errors retry with new paid reservations up to three, then defer to reset',async()=>{
 const key=await seed(db);
 for(let attempt=1;attempt<=3;attempt++){
  const r=await reserve(db,key);assert.equal(r.reserved,true);
  const result=await finish(db,key,r.reservationToken,error('provider_timeout'));assert.equal(result.record.attempts,attempt);
  assert.equal(result.record.status,attempt===3?'deferred':'provider_error');
  assert.equal((await reserve(db,key)).reserved,false);
  if(attempt<3)await db.exec("update app_private.cos_field_geocode_fallback_cache set next_attempt_at=clock_timestamp()-interval '1 second'");
 }
 assert.equal(await credits(db),3);
});

test('403 halts all other addresses until Eastern reset, including superseded reservation',async()=>{
 const key=await seed(db);const other=await seed(db,{id:2});const r=await reserve(db,key);
 await db.exec("insert into public.camera_inventory_audit select 100,actor_id,'MOVE_TO_SHOP',unit_key,device_ids,after_state from public.camera_inventory_audit where id=1");
 assert.equal((await finish(db,key,r.reservationToken,error('provider_forbidden'))).accepted,false);
 const blocked=await reserve(db,other);assert.equal(blocked.reason,'provider_forbidden');assert.equal(blocked.record.status,'deferred');
 assert.deepEqual(await rpc(db,'list_due',{p_organization_id:ORG}),[]);assert.equal(await credits(db),1);
 const state=(await db.query('select blocked_until=app_private.cos_geocodio_next_reset(clock_timestamp()) as correct from app_private.cos_geocodio_account_state')).rows[0];assert.equal(state.correct,true);
});

test('429 validates numeric bounds, clamps minimum cooldown, and blocks account-wide',async()=>{
 const key=await seed(db);const other=await seed(db,{id:2});const r=await reserve(db,key);
 for(const bad of [0,-1,86401])await assert.rejects(finish(db,key,r.reservationToken,error('provider_rate_limited',bad)));
 const saved=await finish(db,key,r.reservationToken,error('provider_rate_limited',1));assert.equal(saved.record.status,'deferred');
 assert.equal((await reserve(db,other)).reason,'provider_rate_limited');assert.equal(await credits(db),1);
 const {seconds}=(await db.query('select extract(epoch from cooldown_until-clock_timestamp()) seconds from app_private.cos_geocodio_account_state')).rows[0];assert.ok(Number(seconds)>28&&Number(seconds)<=30);
});

test('DST-aware reset yields 23/25-hour local days and correct UTC midnight',async()=>{
 const rows=(await db.query(`select p::text,app_private.cos_geocodio_next_reset(p)::text reset,extract(epoch from app_private.cos_geocodio_next_reset(p)-p)/3600 hours
  from unnest(array['2026-03-08 05:00:00+00'::timestamptz,'2026-11-01 04:00:00+00'::timestamptz,'2026-07-01 04:00:00+00'::timestamptz,'2026-01-01 05:00:00+00'::timestamptz]) p`)).rows;
 assert.deepEqual(rows.map(r=>Number(r.hours)),[23,25,24,24]);assert.ok(rows[0].reset.startsWith('2026-03-09 04:00:00'));assert.ok(rows[1].reset.startsWith('2026-11-02 05:00:00'));
});

test('read_many keeps Owner and approved IT gate; Service/inactive/anonymous cannot read or mutate',async()=>{
 const key=await seed(db);await finish(db,key,(await reserve(db,key)).reservationToken);
 for(const actor of [OWNER,IT])assert.equal((await rpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:['1']},'authenticated',actor)).length,1);
 for(const actor of [SERVICE,randomUUID(),''])await assert.rejects(rpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:['1']},'authenticated',actor));
 const unapprovedIT=randomUUID();
 await db.query("insert into public.profiles values($1,'it',true,null)",[unapprovedIT]);
 await assert.rejects(rpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:['1']},'authenticated',unapprovedIT));
 const secondIT='b7cc3cbf-d11e-4d4a-9742-c07701857911';
 await db.query("insert into public.profiles values($1,'it',true,null)",[secondIT]);
 assert.equal((await rpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:['1']},'authenticated',secondIT)).length,1);
 for(const actor of [OWNER,IT]){
  await db.query('update public.profiles set active=false where user_id=$1',[actor]);
  await assert.rejects(rpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:['1']},'authenticated',actor));
  await db.query('update public.profiles set active=true,archived_at=clock_timestamp() where user_id=$1',[actor]);
  await assert.rejects(rpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:['1']},'authenticated',actor));
  await db.query('update public.profiles set archived_at=null where user_id=$1',[actor]);
 }

 for(const role of ['anon','authenticated']){
  await assert.rejects(rpc(db,'reserve',{...key,p_request_id:randomUUID()},role,OWNER));
  await db.exec(`set role ${role}`);await assert.rejects(db.query('select * from app_private.cos_field_geocode_fallback_cache'));await db.exec('reset role');
 }
 await assert.rejects(rpc(db,'read_many',{p_organization_id:ORG,p_audit_ids:['1']},'anon',OWNER));
});

test('backend cannot silently enable billing config; old legacy functions are unchanged',async()=>{
 await db.exec('set role service_role');await assert.rejects(db.exec('update app_private.cos_geocodio_control set enabled=true'));await db.exec('reset role');
 const definitions=(await db.query("select p.proname,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and (p.proname like 'cos_geocode_%' or p.proname='cos_verified_fleet_actor') order by p.proname")).rows;
 assert.deepEqual(definitions,db.fixtureLegacyDefinitions);
 const rls=(await db.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and (relname like 'cos_geocodio_%' or relname in ('cos_field_geocode_fallback_cache','cos_field_geocode_fallback_rejections')) and relkind='r'")).rows;
 assert.equal(rls.length,6);assert.ok(rls.every(r=>r.relrowsecurity));
});

test('late 403 after lease recovery still stops account once without accepting stale coordinates',async()=>{
 const key=await seed(db);const other=await seed(db,{id:2});const r=await reserve(db,key);
 await db.exec("update app_private.cos_geocodio_reservations set reserved_at=clock_timestamp()-interval '2 minutes',send_before=clock_timestamp()-interval '119 seconds',lease_until=clock_timestamp()-interval '60 seconds';update app_private.cos_field_geocode_fallback_cache set lease_until=clock_timestamp()-interval '60 seconds'");
 assert.equal((await reserve(db,key)).reason,'provider_timeout');
 assert.equal((await finish(db,key,r.reservationToken,error('provider_forbidden'))).accepted,false);
 assert.equal((await reserve(db,other)).reason,'provider_forbidden');assert.equal(await credits(db),1);
 await db.exec('update app_private.cos_geocodio_account_state set blocked_until=null');
 await finish(db,key,r.reservationToken,error('provider_forbidden'));
 assert.equal((await db.query('select blocked_until from app_private.cos_geocodio_account_state')).rows[0].blocked_until,null);
});

test('new Eastern budget day grants fresh credit while previous-day charges remain durable',async()=>{
 const key=await seed(db);
 await db.exec("insert into app_private.cos_geocodio_daily_budget values((clock_timestamp() at time zone 'America/New_York')::date-1,2400)");
 const r=await reserve(db,key);assert.equal(r.reserved,true);assert.equal(r.remaining,2399);
 assert.equal(await credits(db),2401);
});

test('identity-mismatched tokens and contradictory finish replays cannot overwrite a result',async()=>{
 const key=await seed(db);const other=await seed(db,{id:2});const r=await reserve(db,key);
 assert.equal((await finish(db,other,r.reservationToken)).accepted,false);
 assert.equal((await finish(db,key,randomUUID())).accepted,false);
 assert.equal((await finish(db,key,r.reservationToken)).accepted,true);
 assert.equal((await finish(db,key,r.reservationToken,{p_status:'no_match'})).accepted,false);
 assert.equal((await read(['1']))[0].status,'success');assert.equal(await credits(db),1);
});

test('read validation rejects malformed audit arrays and target filters stay exact',async()=>{
 await seed(db);await seed(db,{id:2});
 for(const ids of [null,['0'],['1',null],Array(251).fill('1')])await assert.rejects(read(ids));
 assert.deepEqual((await rpc(db,'list_due',{p_organization_id:ORG,p_audit_id:'1',p_unit_key:' unit-1 '})).map(r=>r.auditId),['1']);
 assert.deepEqual(await rpc(db,'list_due',{p_organization_id:ORG,p_audit_id:'1',p_unit_key:'Unit-2'}),[]);
});

test('unsafe-address rejection prevents queue starvation without spending or poisoning shared cache',async()=>{
 const keys=[];for(let id=1;id<=6;id++)keys.push(await seed(db,{id}));
 for(const key of keys.slice(0,5))assert.equal((await rpc(db,'reject_address',key)).accepted,true);
 assert.deepEqual((await rpc(db,'list_due',{p_organization_id:ORG})).map(r=>r.auditId),['6']);
 assert.equal((await reserve(db,keys[0])).reason,'invalid_address');assert.equal(await credits(db),0);
 assert.equal((await read(['1']))[0].status,'no_match');assert.equal((await read(['1']))[0].reason,'invalid_address');
 await assert.rejects(rpc(db,'reject_address',keys[0],'authenticated',OWNER));
});

test('per-audit rejection leaves same-address positive cache and other in-flight reservation unchanged',async()=>{
 const key=await seed(db);const twin=await seed(db,{id:2,address:key.p_address});const r=await reserve(db,key);
 const before=(await db.query('select row_to_json(c) value from app_private.cos_field_geocode_fallback_cache c')).rows;
 await rpc(db,'reject_address',twin);
 assert.deepEqual((await db.query('select row_to_json(c) value from app_private.cos_field_geocode_fallback_cache c')).rows,before);
 assert.equal((await finish(db,key,r.reservationToken)).accepted,true);
 assert.equal((await read(['1']))[0].status,'success');assert.equal((await read(['2']))[0].reason,'invalid_address');
 assert.equal((await reserve(db,key)).reason,'cache_hit');assert.equal(await credits(db),1);
});

test('full-day rate-limit cooldown is retained conservatively',async()=>{
 const key=await seed(db);const r=await reserve(db,key);
 await finish(db,key,r.reservationToken,error('provider_rate_limited',86400));
 const {seconds}=(await db.query('select extract(epoch from cooldown_until-clock_timestamp()) seconds from app_private.cos_geocodio_account_state')).rows[0];
 assert.ok(Number(seconds)>86398&&Number(seconds)<=86400);
});

test('midnight send window fails closed for final 60 seconds across summer and winter offsets',async()=>{
 const values=(await db.query(`select app_private.cos_geocodio_send_before(t) as deadline from unnest(array[
  '2026-07-01 03:58:59+00'::timestamptz,'2026-07-01 03:59:00+00'::timestamptz,'2026-07-01 03:59:59+00'::timestamptz,
  '2026-01-01 04:58:59+00'::timestamptz,'2026-01-01 04:59:00+00'::timestamptz,'2026-01-01 04:59:59+00'::timestamptz]) t`)).rows;
 assert.equal(values[0].deadline.toISOString(),'2026-07-01T03:59:09.000Z');assert.equal(values[1].deadline,null);assert.equal(values[2].deadline,null);
 assert.equal(values[3].deadline.toISOString(),'2026-01-01T04:59:09.000Z');assert.equal(values[4].deadline,null);assert.equal(values[5].deadline,null);
});
