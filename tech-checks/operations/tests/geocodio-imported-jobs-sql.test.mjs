import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,reset,seed,reserve,finish,credits,ORG,OWNER,IT,SERVICE,hash} from './fixtures/geocodio-database-fixture.mjs';
let db;
before(async()=>{db=await fixture({imported:true});});
beforeEach(async()=>reset(db));
after(async()=>db?.close());
const dto=(n=1,overrides={})=>{
 const installation={street:`${n} Main St`,city:'Houston',state:'TX',zip:'77002'};
 return {schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:randomUUID(),productId:String(n),unitNumber:`SPOTTER ${n}`,family:'SPOTTER',variant:null,sourceRevision:randomUUID(),sourceFileSha256:'a'.repeat(64),sourceRowSha256:hash(String(n)),addressSha256:hash(`${n} main st, houston, tx 77002`),nativeGuardSha256:'b'.repeat(64),installation,suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:String(n),...overrides};
};
const event=b=>({eventId:b.eventId,entityKind:b.entityKind,nativeUnitId:b.nativeUnitId,productId:b.productId,sourceRevision:b.sourceRevision,source:b});
async function rpc(name,args={},role='service_role',actor=OWNER){
 if(['sync','scan_complete'].includes(name)&&!Object.hasOwn(args,'p_scan_generation'))args={...args,p_scan_generation:(await rpc('cursor_read')).scanGeneration};
 await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec(`set role ${role}`);
 try{return (await db.query(`select public.cos_imported_geocode_${name}(${Object.keys({p_organization_id:ORG,...args}).map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,Object.values({p_organization_id:ORG,...args}))).rows[0].result;}
 finally{await db.exec('reset role');}
}
const sync=(bindings,after='0',next=bindings.at(-1)?.eventId??after)=>rpc('sync',{p_after_event_id:after,p_events:bindings.map(event),p_next_event_id:next});
const read=(bindings,role='service_role',actor=OWNER)=>rpc('read_many',{p_bindings:bindings},role,actor);
const claim=(b,id=randomUUID())=>rpc('census_claim',{p_binding:b,p_request_id:id});
const censusFinish=(b,t,status='no_match',extras={})=>rpc('census_finish',{p_binding:b,p_claim_token:t,p_source_current:true,p_status:status,...extras});
const geoReserve=(b,id=randomUUID())=>rpc('reserve',{p_binding:b,p_request_id:id});
const geoFinish=(b,t,extras={})=>rpc('finish',{p_binding:b,p_reservation_token:t,p_source_current:true,p_status:'success',p_latitude:29.1,p_longitude:-95.1,p_matched_address:'1 Main St, Houston, TX 77002',p_accuracy_type:'rooftop',p_accuracy:1,...extras});
async function censusNoMatch(b){const r=await claim(b);if(r.claimed)await censusFinish(b,r.claimToken);return r;}
const late=async(table,cache)=>db.exec(`update app_private.${table} set reserved_at=clock_timestamp()-interval '2 minutes',lease_until=clock_timestamp()-interval '60 seconds'${table==='cos_geocodio_reservations'?',send_before=clock_timestamp()-interval \'119 seconds\'':''};update app_private.${cache} set lease_until=clock_timestamp()-interval '60 seconds'`);

test('cursor CAS, exact replay, ordered pages and atomic rollback',async()=>{
 const a=dto(),b=dto(2);assert.equal((await rpc('cursor_read')).eventId,'0');
 const result=await sync([a,b]);assert.equal(result.applied,2);assert.equal((await sync([a,b])).applied,0);
 assert.equal((await sync([dto(3)],'0')).accepted,false);assert.equal((await rpc('cursor_read')).eventId,'2');
 await assert.rejects(sync([dto(4),dto(3)],'2','4'));assert.equal((await rpc('cursor_read')).eventId,'2');
 await assert.rejects(sync([],'2','3'));assert.equal((await rpc('cursor_read')).eventId,'2');
 assert.equal((await rpc('list_due')).length,2);assert.equal(await credits(db),0);
});

test('Census first, address dedupe, shared success projection and completed queue removal',async()=>{
 const a=dto(),b=dto(2,{installation:dto().installation,addressSha256:dto().addressSha256});await sync([a,b]);
 assert.equal((await rpc('list_due')).length,1);assert.equal((await geoReserve(a)).reason,'census_required');
 const id=randomUUID(),r=await claim(a,id);assert.equal(r.claimed,true);assert.equal((await claim(a,id)).reason,'request_replayed');assert.equal((await claim(b)).reason,'duplicate_inflight');
 const saved=await censusFinish(a,r.claimToken,'success',{p_latitude:29,p_longitude:-95,p_matched_address:'1 Main St, Houston, TX 77002'});
 assert.equal(saved.accepted,true);assert.equal(saved.record.provider,'us_census_address_range');assert.equal((await read([a,b])).length,2);
 assert.deepEqual(await rpc('list_due'),[]);assert.equal((await claim(b)).reason,'cache_hit');assert.equal(await credits(db),0);
});

test('imported paid reservation shares Owner budget/cache and uses typed null-audit identity',async()=>{
 const owner=await seed(db,{unit:'Unrelated-Owner'});const b=dto();await sync([b]);await censusNoMatch(b);
 const ownerReservation=await reserve(db,owner);assert.equal(ownerReservation.reserved,true);
 assert.equal((await geoReserve(b)).reason,'duplicate_inflight');await finish(db,owner,ownerReservation.reservationToken);
 assert.equal((await geoReserve(b)).reason,'cache_hit');assert.equal((await read([b]))[0].provider,'geocodio');assert.equal(await credits(db),1);
 const c=dto(2);await sync([c],'1');await censusNoMatch(c);const r=await geoReserve(c);assert.equal(r.reserved,true);
 const row=(await db.query('select job_kind,audit_id,native_binding from app_private.cos_geocodio_reservations where reservation_token=$1',[r.reservationToken])).rows[0];
 assert.equal(row.job_kind,'native_import');assert.equal(row.audit_id,null);assert.deepEqual(row.native_binding,c);
 assert.equal((await finish(db,owner,r.reservationToken)).accepted,false);assert.equal((await geoFinish(c,ownerReservation.reservationToken)).accepted,false);
 assert.equal((await geoFinish(c,r.reservationToken)).accepted,true);assert.equal(await credits(db),2);
});

test('imported-first Geocodio cache is reusable by current Owner address without extra spend',async()=>{
 const b=dto();await sync([b]);await censusNoMatch(b);const r=await geoReserve(b);await geoFinish(b,r.reservationToken);
 const owner=await seed(db,{unit:'Other-Owner'});assert.equal((await reserve(db,owner)).reason,'cache_hit');assert.equal(await credits(db),1);
});

test('new revision and tombstone supersede stale work without fake audits',async()=>{
 const a=dto();await sync([a]);const r=await claim(a);
 const changed={...a,eventId:'2',sourceRevision:randomUUID(),nativeGuardSha256:'c'.repeat(64)};await sync([changed],'1');
 assert.equal((await censusFinish(a,r.claimToken)).accepted,false);assert.deepEqual(await read([a]),[]);
 const tombstone={...event(changed),eventId:'3',sourceRevision:randomUUID(),source:null};
 assert.equal((await rpc('sync',{p_after_event_id:'2',p_next_event_id:'3',p_events:[tombstone]})).accepted,true);
 assert.deepEqual(await read([changed]),[]);assert.deepEqual(await rpc('list_due'),[]);
 assert.equal(Number((await db.query('select count(*) n from public.camera_inventory_audit')).rows[0].n),0);
});

test('native guard change/manual GPS binding and explicit source_current false/null cannot publish',async()=>{
 const a=dto();await sync([a]);await censusNoMatch(a);const r=await geoReserve(a);
 for(const current of [false,null])assert.equal((await geoFinish(a,r.reservationToken,{p_source_current:current})).accepted,false);
 assert.deepEqual(await read([{...a,nativeGuardSha256:'d'.repeat(64)}]),[]);assert.equal(await credits(db),1);
});

test('exact invalidation cannot retire another revision or mutate shared budget/cache/cursor',async()=>{
 const a=dto();await sync([a]);await censusNoMatch(a);const r=await geoReserve(a);await geoFinish(a,r.reservationToken);
 assert.equal((await rpc('invalidate',{p_binding:{...a,sourceRevision:randomUUID()}})).accepted,false);
 assert.equal((await rpc('invalidate',{p_binding:a})).accepted,true);assert.equal((await read([a]))[0].status,'held');assert.equal((await read([a]))[0].reason,'source_changed');
 assert.equal((await claim(a)).claimed,false);assert.equal((await geoReserve(a)).reserved,false);assert.equal(await credits(db),1);
 assert.equal((await rpc('cursor_read')).eventId,'1');
 assert.equal((await db.query('select status from app_private.cos_field_geocode_fallback_cache')).rows[0].status,'success');
});

test('deny-only concern key preserves typed family digits and decimals; variants never assign identity',async()=>{
 const key=async label=>(await db.query('select app_private.cos_imported_concern_key($1) k',[label])).rows[0].k;
 assert.equal(await key('SPOTTER 246HDC2'),await key('SPOTTER 246'));
 assert.notEqual(await key('SNIPER 2 46'),await key('SNIPER 246'));assert.notEqual(await key('SNIPER 4 46'),await key('SNIPER 2 46'));
 assert.equal(await key('RECON II 0046'),await key('RII46'));assert.notEqual(await key('RECON 46'),await key('RECON 2 46'));
 assert.notEqual(await key('SOLAR STAND 72 46'),await key('SOLAR SKID 144 46'));assert.notEqual(await key('SPOTTER 24.6'),await key('SPOTTER 246'));
 assert.notEqual(await key('SPOTTER 24.60'),await key('SPOTTER 24.6'));assert.equal(await key('mystery 246'),'full:MYSTERY 246');
});

test('any related versioned Owner placement overrides newer import, including base/variant and SHOP',async()=>{
 for(const action of ['MOVE_TO_FIELD','MOVE_TO_ROOT']){
  await reset(db);await seed(db,{id:246,unit:'SPOTTER246'});
  await db.query("update public.camera_inventory_audit set action=$1,after_state=jsonb_set(after_state,'{placement}',$2) where id=246",[action,JSON.stringify(action==='MOVE_TO_ROOT'?'SHOP':'FIELD')]);
  const a=dto(1,{unitNumber:'SPOTTER 246HDC2',variant:'HDC2'});await sync([a]);
  assert.deepEqual(await rpc('list_due'),[]);assert.equal((await claim(a)).claimed,false);assert.equal((await read([a]))[0].status,'held');
 }
});

test('later Owner audit/device mutation invalidates in-flight finish and completed read',async()=>{
 const a=dto();await sync([a]);await censusNoMatch(a);const r=await geoReserve(a);
 await seed(db,{id:2,unit:'SPOTTER 1'});assert.equal((await geoFinish(a,r.reservationToken)).accepted,false);assert.equal((await read([a]))[0].reason,'legacy_override');assert.equal(await credits(db),1);
 await reset(db);const b=dto();await sync([b]);await censusNoMatch(b);await geoFinish(b,(await geoReserve(b)).reservationToken);
 await db.exec("insert into public.camera_devices values(99,'SPOTTER1')");const row=(await read([b]))[0];assert.equal(row.status,'held');assert.equal(row.latitude,null);
});

test('cross-device audit relation and multiple device variants suppress imported work',async()=>{
 for(const mode of ['cross','variants']){
  await reset(db);await db.exec("insert into public.camera_devices values(7,'SPOTTER1')");
  if(mode==='cross')await db.query("insert into public.camera_inventory_audit values(8,$1,'OTHER','RANGER 8',array[7::bigint],'{}')",[OWNER]);
  else await db.exec("insert into public.camera_devices values(8,'SPOTTER1HDC2')");
  const a=dto();await sync([a]);assert.equal((await claim(a)).claimed,false);assert.equal((await read([a]))[0].status,'held');
 }
});

test('shared cap and UUID namespace cannot allocate independent imported allowance',async()=>{
 const a=dto(),b=dto(2);await sync([a,b]);await censusNoMatch(a);await censusNoMatch(b);
 await db.exec("insert into app_private.cos_geocodio_daily_budget values((clock_timestamp() at time zone 'America/New_York')::date,2399)");
 const id=randomUUID();const r=await geoReserve(a,id);assert.equal(r.reserved,true);assert.equal((await geoReserve(a,id)).reason,'reservation_replayed');
 assert.equal((await geoReserve(b)).reason,'budget_exhausted');assert.equal(await credits(db),2400);
 const owner=await seed(db,{id:3,unit:'Other'});assert.equal((await reserve(db,owner,id)).reason,'reservation_replayed');assert.equal((await reserve(db,owner)).reason,'budget_exhausted');
});

test('imported timeout consumes credit; expired token cannot publish or authorize resend',async()=>{
 const a=dto();await sync([a]);await censusNoMatch(a);const id=randomUUID(),r=await geoReserve(a,id);
 await late('cos_geocodio_reservations','cos_field_geocode_fallback_cache');
 assert.equal((await geoReserve(a,id)).reason,'reservation_replayed');assert.equal((await geoReserve(a)).reason,'provider_timeout');assert.equal((await geoFinish(a,r.reservationToken)).accepted,false);assert.equal(await credits(db),1);
});

test('Census expired leases recover safely with bounded paid-free retries',async()=>{
 const a=dto();await sync([a]);const id=randomUUID(),r=await claim(a,id);await late('cos_imported_census_requests','cos_imported_census_cache');
 assert.equal((await claim(a,id)).reason,'request_replayed');assert.equal((await claim(a)).reason,'provider_timeout');assert.equal((await censusFinish(a,r.claimToken)).accepted,false);assert.equal(await credits(db),0);
 await db.exec("update app_private.cos_imported_census_cache set next_attempt_at=clock_timestamp()-interval '1 second'");
 assert.equal((await claim(a)).claimed,true);
});

test('auth keeps Owner/approved IT reader and service-only mutations; arbitrary binding/null errors fail closed',async()=>{
 const a=dto();await sync([a]);
 for(const actor of [OWNER,IT])assert.equal((await read([a],'authenticated',actor)).length,1);
 for(const actor of [SERVICE,randomUUID(),''])await assert.rejects(read([a],'authenticated',actor));
 await assert.rejects(read([a],'anon'));await assert.rejects(rpc('invalidate',{p_binding:a},'authenticated'));
 for(const b of [null,{}, {...a,schemaVersion:2},{...a,addressSha256:'0'.repeat(64)},{...a,sourceRevision:null},{...a,sourceFileSha256:'secret'}, {...a,extra:'unexpected'}])await assert.rejects(claim(b));
 for(const b of [null,{},Array(251).fill(a)])await assert.rejects(read(b));
});

test('partial city/ZIP supplied flags and full ZIP+4 hashes are exact',async()=>{
 for(const missing of ['city','zip']){
  await reset(db);const a=dto();a.installation[missing]=null;a.suppliedComponents[missing]=false;
  a.addressSha256=hash([a.installation.street,a.installation.city,[a.installation.state,a.installation.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ').toLowerCase());
  await sync([a]);assert.equal((await claim(a)).claimed,true);
  await assert.rejects(claim({...a,suppliedComponents:{...a.suppliedComponents,[missing]:true}}));
 }
 await reset(db);const a=dto();a.installation.zip='77002-1234';a.addressSha256=hash('1 main st, houston, tx 77002-1234');await sync([a]);assert.equal((await claim(a)).claimed,true);
 await assert.rejects(claim({...a,installation:{...a.installation,city:null,zip:null},suppliedComponents:{street:true,state:true,city:false,zip:false}}));
});

test('same revision cannot be rewritten and imported identity cannot be rebound across kind/product',async()=>{
 const a=dto();await sync([a]);
 await assert.rejects(sync([{...a,eventId:'2',sourceRowSha256:'f'.repeat(64)}],'1'));
 await assert.rejects(sync([{...a,eventId:'2',sourceRevision:randomUUID(),productId:'999'}],'1'));
 await assert.rejects(sync([{...a,eventId:'2',sourceRevision:randomUUID(),entityKind:'tracker'}],'1'));
 await assert.rejects(sync([dto(2,{productId:a.productId})],'1'));
 assert.equal((await rpc('cursor_read')).eventId,'1');assert.deepEqual((await read([a]))[0].binding,a);
});

test('Census failures retry three times per day with no paid fallback or quota spend',async()=>{
 const a=dto();await sync([a]);
 for(let attempt=1;attempt<=3;attempt++){
  const r=await claim(a);assert.equal(r.claimed,true);
  const saved=await censusFinish(a,r.claimToken,'provider_error',{p_reason:'provider_timeout'});
  assert.equal(saved.record.attempts,attempt);assert.equal((await claim(a)).claimed,false);assert.equal((await geoReserve(a)).reason,'census_required');
  if(attempt<3)await db.exec("update app_private.cos_imported_census_cache set next_attempt_at=clock_timestamp()-interval '1 second'");
 }
 const when=(await db.query('select next_attempt_at=app_private.cos_geocodio_next_reset(clock_timestamp()) correct from app_private.cos_imported_census_cache')).rows[0];
 assert.equal(when.correct,true);assert.equal(await credits(db),0);assert.deepEqual(await rpc('list_due'),[]);
});

test('invalid-address Census terminal prevents starvation without spending a paid credit',async()=>{
 const a=dto(),b=dto(2);await sync([a,b]);await censusFinish(a,(await claim(a)).claimToken,'invalid_address');
 assert.deepEqual((await rpc('list_due')).map(r=>r.binding.nativeUnitId),[b.nativeUnitId]);
 assert.equal((await geoReserve(a)).reason,'census_required');assert.equal((await read([a]))[0].status,'invalid_address');assert.equal(await credits(db),0);
});

test('403 and 429 imported responses stop the shared account including Owner reservations',async()=>{
 for(const [reason,delay] of [['provider_forbidden',null],['provider_rate_limited',86400]]){
  await reset(db);const a=dto();await sync([a]);await censusNoMatch(a);const r=await geoReserve(a);
  const saved=await rpc('finish',{p_binding:a,p_reservation_token:r.reservationToken,p_source_current:true,p_status:'provider_error',p_reason:reason,...(delay?{p_retry_after_seconds:delay}:{})});
  assert.equal(saved.record.status,'deferred');const owner=await seed(db,{id:3,unit:'Other'});assert.equal((await reserve(db,owner)).reason,reason);assert.equal(await credits(db),1);
  const c=dto(2);await sync([c],'1');await censusNoMatch(c);assert.equal((await geoReserve(c)).reason,reason);
 }
});

test('source change after reservation still records a genuine 403 account stop without stale coordinates',async()=>{
 const a=dto();await sync([a]);await censusNoMatch(a);const r=await geoReserve(a);
 await rpc('invalidate',{p_binding:a});
 assert.equal((await rpc('finish',{p_binding:a,p_reservation_token:r.reservationToken,p_source_current:false,p_status:'provider_error',p_reason:'provider_forbidden'})).accepted,false);
 assert.equal((await read([a]))[0].latitude,null);
 const owner=await seed(db,{id:3,unit:'Other'});assert.equal((await reserve(db,owner)).reason,'provider_forbidden');assert.equal(await credits(db),1);
});

test('malformed source pages reject nulls, excessive payloads, envelope mismatches and partial updates',async()=>{
 const a=dto();for(const events of [null,{},Array(101).fill(event(a)),[{...event(a),source:undefined}], [{...event(a),nativeUnitId:randomUUID()}], [{...event(a),eventId:1}]]){
  await assert.rejects(rpc('sync',{p_after_event_id:'0',p_next_event_id:'1',p_events:events}));
 }
 await assert.rejects(rpc('sync',{p_after_event_id:'0',p_next_event_id:'2',p_events:[event(a),{eventId:'2'}]}));
 assert.equal((await rpc('cursor_read')).eventId,'0');assert.equal(Number((await db.query('select count(*) n from app_private.cos_imported_geocode_jobs')).rows[0].n),0);
});

test('disabled paid config exposes honest deferred state while imported Census still works',async()=>{
 const a=dto();await sync([a]);await db.exec('update app_private.cos_geocodio_control set enabled=false');
 await censusNoMatch(a);assert.equal((await read([a]))[0].status,'deferred');assert.equal((await read([a]))[0].reason,'configuration_unavailable');
 assert.deepEqual(await rpc('list_due'),[]);assert.equal((await geoReserve(a)).reason,'configuration_unavailable');assert.equal(await credits(db),0);
});

test('imported extension preserves basic Owner RPCs except the scoped retry reserve barrier',async()=>{
 const definitions=(await db.query("select p.proname,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cos_field_geocode_fallback_%' order by p.proname")).rows;
 assert.deepEqual(definitions.filter(x=>x.proname!=='cos_field_geocode_fallback_reserve'),db.fixtureOwnerDefinitions.filter(x=>x.proname!=='cos_field_geocode_fallback_reserve'));
 assert.match(definitions.find(x=>x.proname==='cos_field_geocode_fallback_reserve').body,/Shared-address barrier/);
 const a=dto();await sync([a]);await censusNoMatch(a);const r=await geoReserve(a);
 await assert.rejects(db.query("update app_private.cos_geocodio_reservations set job_kind='owner_audit' where reservation_token=$1",[r.reservationToken]));
 await assert.rejects(db.query('update app_private.cos_geocodio_reservations set audit_id=$1 where reservation_token=$2',['123',r.reservationToken]));
 assert.equal((await geoFinish(a,r.reservationToken)).accepted,true);
});

test('complete roster scan preserves progress over 405 rows/five pages and wraps only at EOF',async()=>{
 const rows=Array.from({length:405},(_,i)=>dto(i+1));const initial=await rpc('cursor_read');
 assert.equal((await rpc('scan_complete',{p_after_event_id:'0',p_scan_generation:initial.scanGeneration})).accepted,false);
 let after='0';for(let start=0;start<rows.length;start+=100){
  const page=rows.slice(start,start+100);const result=await sync(page,after);assert.equal(result.accepted,true);assert.equal(result.applied,page.length);after=page.at(-1).eventId;
  const current=await rpc('cursor_read');assert.equal(current.eventId,after);assert.equal(current.scanGeneration,initial.scanGeneration);
  if(page.length===100)assert.equal((await rpc('scan_complete',{p_after_event_id:after,p_scan_generation:initial.scanGeneration})).accepted,false);
 }
 assert.equal(Number((await db.query('select count(*) n from app_private.cos_imported_geocode_jobs')).rows[0].n),405);
 const done=await rpc('scan_complete',{p_after_event_id:after,p_scan_generation:initial.scanGeneration});assert.equal(done.accepted,true);assert.equal(done.eventId,'0');assert.notEqual(done.scanGeneration,initial.scanGeneration);
 assert.equal((await rpc('scan_complete',{p_after_event_id:after,p_scan_generation:initial.scanGeneration})).accepted,false);
 assert.equal((await rpc('sync',{p_scan_generation:initial.scanGeneration,p_after_event_id:'0',p_next_event_id:'100',p_events:rows.slice(0,100).map(event)})).accepted,false);
 assert.equal((await rpc('cursor_read')).eventId,'0');
});

test('next full scan discovers late lower-sequence commits and older events cannot replace newer source',async()=>{
 const high=dto(200);await sync([high]);const oldGeneration=(await rpc('cursor_read')).scanGeneration;
 await rpc('scan_complete',{p_after_event_id:'200'});
 const late=dto(50);const result=await sync([late,high]);assert.equal(result.applied,1);assert.equal((await read([late]))[0].binding.nativeUnitId,late.nativeUnitId);
 const newer={...late,eventId:'250',sourceRevision:randomUUID(),sourceRowSha256:'e'.repeat(64)};await sync([newer],'200');await rpc('scan_complete',{p_after_event_id:'250'});
 assert.equal((await sync([late,high,newer])).accepted,true);assert.deepEqual(await read([late]),[]);assert.equal((await read([newer]))[0].binding.sourceRevision,newer.sourceRevision);
 assert.equal((await rpc('sync',{p_scan_generation:oldGeneration,p_after_event_id:'0',p_next_event_id:'200',p_events:[event(high)]})).accepted,false);
});

test('same immutable event with repeated null source retires only that revision without conflicts or resurrection',async()=>{
 const a=dto();await sync([a]);await rpc('scan_complete',{p_after_event_id:'1'});
 const snapshot={...event(a),source:null};
 assert.equal((await rpc('sync',{p_after_event_id:'0',p_next_event_id:'1',p_events:[snapshot]})).accepted,true);
 assert.equal((await rpc('sync',{p_after_event_id:'0',p_next_event_id:'1',p_events:[snapshot]})).accepted,true);
 assert.equal((await read([a]))[0].reason,'source_changed');
 const stored=(await db.query('select event from app_private.cos_imported_geocode_events')).rows[0].event;assert.equal(Object.hasOwn(stored,'source'),false);
 await rpc('scan_complete',{p_after_event_id:'1'});assert.equal((await sync([a])).applied,0);assert.equal((await read([a]))[0].reason,'source_changed');
 const newer={...a,eventId:'2',sourceRevision:randomUUID()};await sync([newer],'1');await rpc('scan_complete',{p_after_event_id:'2'});
 assert.equal((await rpc('sync',{p_after_event_id:'0',p_next_event_id:'2',p_events:[snapshot,event(newer)]})).accepted,true);
 assert.equal((await read([newer]))[0].status,'pending');assert.deepEqual(await read([a]),[]);
});

test('an exactly full final page requires a synced empty EOF page before generation rotation',async()=>{
 const rows=Array.from({length:100},(_,i)=>dto(i+1));await sync(rows);
 const cursor=await rpc('cursor_read');assert.equal((await rpc('scan_complete',{p_after_event_id:'100'})).accepted,false);
 await sync([],'100','100');const done=await rpc('scan_complete',{p_after_event_id:'100'});assert.equal(done.accepted,true);assert.notEqual(done.scanGeneration,cursor.scanGeneration);
 await assert.rejects(rpc('sync',{p_scan_generation:null,p_after_event_id:'0',p_next_event_id:'0',p_events:[]}));
});

test('legacy Census success with mismatched ZIP+4 is never promoted into imported validated cache',async()=>{
 const address='1 main st, houston, tx 77002-1234';await seed(db,{unit:'Other',address,status:'success'});
 await db.exec("update app_private.cos_field_geocode_cache set matched_address='1 Main St, Houston, TX 77002-9999'");
 const a=dto();a.installation.zip='77002-1234';a.addressSha256=hash(address);await sync([a]);
 const r=await claim(a);assert.equal(r.claimed,true);assert.equal(r.record.status,'pending');
 const saved=await censusFinish(a,r.claimToken,'success',{p_latitude:29,p_longitude:-95,p_matched_address:'1 Main St, Houston, TX 77002-1234'});
 assert.equal(saved.record.benchmark,'Public_AR_Current');assert.equal((await read([a]))[0].matchedAddress,'1 Main St, Houston, TX 77002-1234');
});

test('legacy lock contention fails closed without changing cursor, consuming credit or showing cached coordinates',async()=>{
 const a=dto();await sync([a]);await censusNoMatch(a);await geoFinish(a,(await geoReserve(a)).reservationToken);
 const original=(await db.query("select pg_get_functiondef('app_private.cos_imported_try_lock_legacy()'::regprocedure) definition")).rows[0].definition;
 // PGlite has one session. Stub the exact contention result to execute each
 // fail-closed branch; a separate full PostgreSQL test must prove NOWAIT locks.
 await db.exec("create or replace function app_private.cos_imported_try_lock_legacy() returns boolean language sql set search_path='' as $$select false$$");
 try{
  const before=await rpc('cursor_read');const next=dto(2);const denied=await sync([next],'1');
  assert.equal(denied.accepted,false);assert.equal(denied.reason,'legacy_busy');assert.deepEqual(await rpc('cursor_read'),before);
  assert.deepEqual(await rpc('list_due'),[]);assert.equal((await claim(a)).claimed,false);assert.equal((await geoReserve(a)).reserved,false);
  const shown=(await read([a]))[0];assert.equal(shown.status,'held');assert.equal(shown.reason,'legacy_busy');assert.equal(shown.latitude,null);assert.match(shown.legacyGuardSha256,/^[a-f0-9]{64}$/);
  assert.equal(await credits(db),1);
 }finally{await db.exec(original);}
 assert.equal((await read([a]))[0].status,'success');
});
