import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture,reset,ORG,OWNER,IT,SERVICE,hash} from './fixtures/geocodio-database-fixture.mjs';

const sql=name=>readFile(new URL('../db/'+name,import.meta.url),'utf8');
let db,migration,baseline;
before(async()=>{
 db=await fixture({imported:true});
 await db.exec('alter table public.camera_inventory_audit add column created_at timestamptz,add column request_id uuid');
 for(const name of ['geocodio-tracker-source-v2.sql','source-precedence-contract.sql','geocodio-source-precedence.sql'])await db.exec(await sql(name));
 baseline=(await db.query("select pg_get_functiondef('public.cos_imported_geocode_read_many(uuid,jsonb)'::regprocedure) definition")).rows[0].definition;
 migration=await sql('geocodio-imported-lookup-batch.sql');
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('reset role;truncate app_private.cos_imported_precedence_reviews');
 await db.exec(baseline);
 await db.exec('drop function if exists app_private.cos_imported_legacy_guards_many(text[])');
 await reset(db);
});
function binding(n,overrides={}){
 return {schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:randomUUID(),productId:String(n),unitNumber:`SPOTTER ${n}`,family:'SPOTTER',variant:null,sourceRevision:randomUUID(),sourceFileSha256:'a'.repeat(64),sourceRowSha256:hash(String(n)),addressSha256:hash(`${n} main st, houston, tx 77002`),nativeGuardSha256:'b'.repeat(64),installation:{street:`${n} Main St`,city:'Houston',state:'TX',zip:'77002'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:String(n),...overrides};
}
async function rpc(name,args={},role='service_role',actor=OWNER){
 await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role '+role);
 const params={p_organization_id:ORG,...args};
 try{return (await db.query('select public.'+name+'('+Object.keys(params).map((key,i)=>key+'=>$'+(i+1)).join(',')+') v',Object.values(params))).rows[0].v;}
 finally{await db.exec('reset role');}
}
async function sync(bindings){
 const cursor=await rpc('cos_imported_geocode_cursor_read');
 return rpc('cos_imported_geocode_sync',{p_scan_generation:cursor.scanGeneration,p_after_event_id:cursor.eventId,p_events:bindings.map(b=>({eventId:b.eventId,entityKind:b.entityKind,nativeUnitId:b.nativeUnitId,productId:b.productId,sourceRevision:b.sourceRevision,source:b})),p_next_event_id:bindings.at(-1).eventId});
}
const read=(bindings,role='service_role',actor=OWNER)=>rpc('cos_imported_geocode_read_many',{p_bindings:bindings},role,actor);
const guard=async label=>(await db.query('select app_private.cos_imported_legacy_guard($1) v',[label])).rows[0].v;
async function audit(id,label,ids,{action='OTHER',state={}}={}){
 await db.query('insert into public.camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state,created_at) values($1,$2,$3,$4,$5,$6,$7)',[id,OWNER,action,label,ids,state,'2026-01-01T00:00:00Z']);
}
async function install(){await db.exec('drop function if exists app_private.cos_imported_legacy_guards_many(text[])');await db.exec(migration);}

async function parity(readSnapshot){
 await db.exec(baseline);
 const before=await readSnapshot();await install();
 assert.deepEqual(await readSnapshot(),before);
 return before;
}
async function success(b){
 const claim=await rpc('cos_imported_geocode_census_claim',{p_binding:b,p_request_id:randomUUID()});assert.equal(claim.claimed,true);
 assert.equal((await rpc('cos_imported_geocode_census_finish',{p_binding:b,p_claim_token:claim.claimToken,p_source_current:true,p_status:'success',p_latitude:29,p_longitude:-95,p_matched_address:`${b.productId} Main St, Houston, TX 77002`})).accepted,true);
}
async function reviewed(){
 const b=binding(991,{unitNumber:'RANGER 991',family:'RANGER'});
 await db.exec("insert into public.camera_devices values(9001,'RANGER 991')");
 await audit(901,'RANGER 991',[9001],{action:'MOVE_TO_ROOT',state:{organization:'root',privateFixture:'historical'}});
 const digests=(await db.query("select app_private.cos_source_precedence_audit_sha(a) semantic,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') full from public.camera_inventory_audit a where id=901")).rows[0];
 b.sourcePrecedence={contract:'COS_REVIEWED_SOURCE_PRECEDENCE_V1',decisionId:randomUUID(),reviewedSourceRevision:randomUUID(),sourceRevision:b.sourceRevision,unitKey:'RANGER 991',deviceIds:['9001'],legacyAuditId:'901',legacyAuditSha256:digests.semantic,legacyAuditRowSha256:digests.full,reviewedAt:'2026-01-02T00:00:00Z',reviewKind:'administrator_import_review'};
 await db.query('select app_private.cos_imported_precedence_admin_review($1,$2,$3)',[b,'Synthetic administrator',hash('synthetic authorization')]);
 return b;
}

test('batched read preserves exact guard JSON and hashes for aliases, typed families, OR overlap and suppression',async()=>{
 await db.exec("insert into public.camera_devices values(1,'SPOTTER1'),(2,'SPOTTER2'),(3,'SPOTTER2HDC2'),(4,'SPOTTER3'),(5,'SNIPER 2 46'),(6,'SNIPER246'),(7,'SPOTTER4'),(8,'RANGER5'),(9,'RANGER6'),(10,null)");
 await audit(1,'SPOTTER1',[1]); // Same audit matches both OR branches, once only.
 await audit(2,'UNRELATED',[4]); // Device overlap cannot be narrowed to label equality.
 await audit(3,'SPOTTER4',[7],{action:'MOVE_TO_FIELD',state:{placement_contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD'}});
 await audit(4,'RANGER5',[8],{action:'MOVE_TO_ROOT'});
 await audit(5,'RANGER6',[9],{state:{placement:'SHOP'}});
 const labels=['SPOTTER 1','SPOTTER 2','SPOTTER 3','SNIPER 2 46','SNIPER246','SPOTTER 4','RANGER 5','RANGER 6','missing'];
 const bindings=labels.map((unitNumber,i)=>binding(100+i,{unitNumber}));await sync(bindings);
 const expectedGuards=await Promise.all(labels.map(guard));
 const rows=await parity(()=>read(bindings));
 const values=expectedGuards;
 assert.deepEqual(rows.map(r=>r.legacyGuardSha256),values.map(g=>g.sha256));
 assert.deepEqual(rows.map(r=>r.status),values.map(g=>g.allowed?'pending':'held'));
 assert.deepEqual(values.map(g=>g.allowed),[true,false,false,true,true,false,false,false,true]);
 assert.notEqual(values[3].sha256,values[4].sha256);
 for(const g of values)assert.match(g.sha256,/^[a-f0-9]{64}$/);
 const expected=(await db.query(`select encode(sha256(convert_to(jsonb_build_object('concern','typed:SPOTTER|1','devices',jsonb_build_array(jsonb_build_array('1','SPOTTER1')),'audits',jsonb_build_array(jsonb_build_array('1','SPOTTER1','OTHER',null,null,array[1]::bigint[])))::text,'UTF8')),'hex') digest`)).rows[0].digest;
 assert.equal(values[0].sha256,expected,'one audit matching both branches must be included once');
});

test('current, held, invalidated and absent imported jobs retain exact serialized records',async()=>{
 const current=binding(1),held=binding(2),invalidated=binding(3),missing=binding(4);
 await sync([current,held,invalidated]);await success(current);
 await db.exec("insert into public.camera_devices values(2,'SPOTTER2')");
 await audit(2,'SPOTTER2',[2],{action:'MOVE_TO_ROOT'});
 await rpc('cos_imported_geocode_invalidate',{p_binding:invalidated});
 const rows=await parity(()=>read([current,held,invalidated,missing]));
 assert.deepEqual(rows.map(r=>[r.binding.productId,r.status]),[['1','success'],['2','held'],['3','held']]);
 assert.equal(rows[0].verified,false);assert.equal(rows[0].liveGps,false);assert.equal(rows[1].latitude,null);assert.equal(rows[2].reason,'source_changed');
 assert.equal((await db.query('select coalesce(sum(credits),0)::integer n from app_private.cos_geocodio_daily_budget')).rows[0].n,0);
});

test('registered precedence, lost registration, private audit changes and roster drift stay fail-closed',async()=>{
 const ordinary=binding(1),b=await reviewed();await sync([ordinary,b]);
 const snapshot=async()=>({guard:(await db.query('select app_private.cos_imported_precedence_guard($1) v',[b])).rows[0].v,current:await rpc('cos_imported_precedence_read_current',{p_bindings:[b]}),read:await read([ordinary,b])});
 const current=await parity(snapshot);assert.equal(current.guard.allowed,true);assert.deepEqual(current.current,[b]);
 const registered=(await db.query('select * from app_private.cos_imported_precedence_reviews')).rows[0];
 await db.exec('delete from app_private.cos_imported_precedence_reviews');
 const lost=await parity(snapshot);assert.equal(lost.guard.allowed,false);assert.deepEqual(lost.current,[]);assert.equal(lost.read[0].status,'pending');assert.equal(lost.read[1].status,'held');
 await db.query('insert into app_private.cos_imported_precedence_reviews(decision_id,binding,reviewed_by,authorization_sha256,recorded_at) values($1,$2,$3,$4,$5)',[registered.decision_id,registered.binding,registered.reviewed_by,registered.authorization_sha256,registered.recorded_at]);
 await db.exec("update public.camera_inventory_audit set after_state=after_state||'{\"privateChange\":true}'::jsonb where id=901");
 const changed=await parity(snapshot);assert.equal(changed.guard.allowed,false);assert.deepEqual(changed.current,[]);
 await db.exec("update public.camera_inventory_audit set after_state=after_state-'privateChange' where id=901;update public.camera_devices set unit_key='OTHER UNIT' where id=9001");
 assert.equal((await parity(snapshot)).guard.allowed,false);
 await db.exec("update public.camera_devices set unit_key='RANGER 991' where id=9001;insert into public.camera_devices values(9002,'RANGER991')");
 assert.equal((await parity(snapshot)).guard.allowed,false);
});

test('verified Owner and IT reads, denied Service and anon reads, and service-only mutations are unchanged',async()=>{
 const b=binding(1);await sync([b]);
 const access=async()=>{
  const results=[];for(const actor of [OWNER,IT])results.push(await read([b],'authenticated',actor));
  results.push(await read([b]));
  for(const actor of [SERVICE,randomUUID(),''])await assert.rejects(read([b],'authenticated',actor),{code:'42501'});
  await assert.rejects(read([b],'anon'),{code:'42501'});
  await assert.rejects(rpc('cos_imported_geocode_invalidate',{p_binding:b},'authenticated'),{code:'42501'});
  return results;
 };
 await parity(access);
});

test('each batch freshly reflects roster inserts, relabels and deletes without stale guard results',async()=>{
 const b=binding(1);await sync([b]);await install();
 const check=async()=>{const expected=await guard('SPOTTER 1');const row=(await read([b]))[0];assert.equal(row.legacyGuardSha256,expected.sha256);return expected;};
 const original=await check();
 await db.exec("insert into public.camera_devices values(1,'SPOTTER1')");
 const inserted=await check();assert.notEqual(inserted.sha256,original.sha256);
 await db.exec("insert into public.camera_devices values(2,'SPOTTER1HDC2')");assert.equal((await check()).allowed,false);
 await db.exec("update public.camera_devices set unit_key='RANGER2' where id=2");assert.deepEqual(await check(),inserted);
 await db.exec('delete from public.camera_devices where id=1');assert.deepEqual(await check(),original);
});

test('migration leaves existing function ACLs, table grants and unrelated function bodies unchanged',async()=>{
 const metadata=async()=>(await db.query("select oid::regprocedure::text signature,proowner,prosecdef,provolatile,proisstrict,proconfig,proacl::text acl from pg_proc where pronamespace in ('public'::regnamespace,'app_private'::regnamespace) order by oid")).rows;
 const bodies=async()=>(await db.query("select oid::regprocedure::text signature,prosrc from pg_proc where pronamespace in ('public'::regnamespace,'app_private'::regnamespace) and oid<>'public.cos_imported_geocode_read_many(uuid,jsonb)'::regprocedure order by oid")).rows;
 const permissions=async()=>(await db.query("select c.oid::regclass::text relation,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity from pg_class c where c.relnamespace in ('public'::regnamespace,'app_private'::regnamespace) and c.relkind='r' order by c.oid")).rows;
 const beforeMetadata=await metadata(),beforeBodies=await bodies(),beforePermissions=await permissions();
 await install();
 const existing=new Set(beforeMetadata.map(f=>f.signature));
 assert.deepEqual((await metadata()).filter(f=>existing.has(f.signature)),beforeMetadata);
 assert.deepEqual((await bodies()).filter(f=>existing.has(f.signature)),beforeBodies);assert.deepEqual(await permissions(),beforePermissions);
 for(const role of ['anon','authenticated']){
  assert.equal((await db.query("select has_schema_privilege($1,'app_private','USAGE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege($1,'app_private.cos_imported_concern_key(text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 }
});

test('legacy lock contention still returns held with saved hash, no coordinates or writes',async()=>{
 const b=binding(1);await sync([b]);await success(b);
 const original=(await db.query("select pg_get_functiondef('app_private.cos_imported_try_lock_legacy()'::regprocedure) definition")).rows[0].definition;
 // PGlite is single-session: exercise the exact contention result, not a
 // claim that real multi-session lock behavior has been established here.
 await db.exec("create or replace function app_private.cos_imported_try_lock_legacy() returns boolean language sql set search_path='' as $$select false$$");
 try{
  const rows=await parity(()=>read([b]));assert.equal(rows[0].status,'held');assert.equal(rows[0].reason,'legacy_busy');assert.equal(rows[0].latitude,null);assert.match(rows[0].legacyGuardSha256,/^[a-f0-9]{64}$/);
 }finally{await db.exec(original);}
 assert.equal((await read([b]))[0].status,'success');
});

test('invalid input and repeated bindings retain fail-closed validation and input order',async()=>{
 const one=binding(1),two=binding(2);await sync([one,two]);
 for(const input of [null,{},Array(251).fill(one),[null],[{}],[{...one,addressSha256:'0'.repeat(64)}]]){
  await db.exec(baseline);await assert.rejects(read(input));await install();await assert.rejects(read(input));
 }
 const rows=await parity(()=>read([two,one,two]));assert.deepEqual(rows.map(r=>r.binding.productId),['2','1','2']);
 assert.deepEqual(await parity(()=>read([])),[]);
});


test('batch helper matches scalar guards and remains inaccessible to every application role',async()=>{
 await db.exec("insert into public.camera_devices values(1,'SPOTTER1'),(2,'SPOTTER1HDC2'),(3,null)");await audit(1,null,[1]);await audit(2,'SPOTTER2',null);
 await install();
 const labels=['SPOTTER1','SPOTTER1HDC2','SPOTTER2','missing'];
 const many=(await db.query('select app_private.cos_imported_legacy_guards_many($1) v',[labels])).rows[0].v;
 for(const label of labels){const key=(await db.query('select app_private.cos_imported_concern_key($1) k',[label])).rows[0].k;assert.deepEqual(many[key],await guard(label));}
 assert.deepEqual((await db.query('select app_private.cos_imported_legacy_guards_many($1) v',[[]])).rows[0].v,{});
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await db.query("select has_function_privilege($1,'app_private.cos_imported_legacy_guards_many(text[])','EXECUTE') allowed",[role])).rows[0].allowed,false);
  await db.exec('set role '+role);try{await assert.rejects(db.query('select app_private.cos_imported_legacy_guards_many($1)',[labels]),{code:'42501'});}finally{await db.exec('reset role');}
 }
});

test('device normalization is once per batch as requested bindings grow',async t=>{
 await db.exec("insert into public.camera_devices select n,'LEGACY DEVICE '||n from generate_series(1,739) n");
 const bindings=Array.from({length:80},(_,i)=>binding(i+1000));await sync(bindings);
 const original=(await db.query("select pg_get_functiondef('app_private.cos_imported_concern_key(text)'::regprocedure) definition")).rows[0].definition;
 await db.exec(original.replace('app_private.cos_imported_concern_key','app_private.test_original_concern_key'));
 await db.exec(`create table public.test_lookup_key_calls(label text);
 create or replace function app_private.cos_imported_concern_key(p_label text) returns text language plpgsql volatile strict set search_path='' as $$
 begin insert into public.test_lookup_key_calls values(p_label);return app_private.test_original_concern_key(p_label);end $$;`);
 const calls=async bindings=>{await db.exec('truncate public.test_lookup_key_calls');await read(bindings);return (await db.query("select count(*)::integer n from public.test_lookup_key_calls where label like 'LEGACY DEVICE %'")).rows[0].n;};
 try{
  await db.exec(baseline);assert.equal(await calls(bindings.slice(0,1)),739);assert.equal(await calls(bindings.slice(0,5)),739*5);
  await install();assert.equal(await calls(bindings.slice(0,1)),739);assert.equal(await calls(bindings),739);
  t.diagnostic('739 synthetic device normalizations for 80 bindings, versus 3,695 for only five baseline bindings.');
 }finally{await db.exec(original);await db.exec('drop function app_private.test_original_concern_key(text);drop table public.test_lookup_key_calls');}
});

test('existing permitted authenticated roster writes survive without helper or schema permission changes',async()=>{
 await db.exec('grant insert,update,select on public.camera_devices to authenticated');
 const write=async id=>{await db.exec('set role authenticated');try{await db.query('insert into public.camera_devices values($1,$2)',[id,'SPOTTER '+id]);await db.query('update public.camera_devices set unit_key=$1 where id=$2',['RANGER '+id,id]);}finally{await db.exec('reset role');}};
 try{await write(1);await install();await write(2);assert.deepEqual((await db.query('select unit_key from public.camera_devices order by id')).rows.map(r=>r.unit_key),['RANGER 1','RANGER 2']);}
 finally{await db.exec('revoke insert,update,select on public.camera_devices from authenticated');}
 assert.equal((await db.query("select has_function_privilege('authenticated','app_private.cos_imported_concern_key(text)','EXECUTE') allowed")).rows[0].allowed,false);
});

test('rollback exactly restores prior reader body and ACL without touching stored jobs',async()=>{
 const b=binding(1);await sync([b]);await success(b);
 const state=async()=>({definition:(await db.query("select pg_get_functiondef('public.cos_imported_geocode_read_many(uuid,jsonb)'::regprocedure) definition")).rows[0].definition,acl:(await db.query("select proacl::text acl from pg_proc where oid='public.cos_imported_geocode_read_many(uuid,jsonb)'::regprocedure")).rows[0].acl,jobs:(await db.query('select to_jsonb(j) j from app_private.cos_imported_geocode_jobs j order by native_unit_id')).rows,records:await read([b])});
 const before=await state();await install();await db.exec(await sql('geocodio-imported-lookup-batch-rollback.sql'));assert.deepEqual(await state(),before);
 assert.equal((await db.query("select to_regprocedure('app_private.cos_imported_legacy_guards_many(text[])') helper")).rows[0].helper,null);
});
