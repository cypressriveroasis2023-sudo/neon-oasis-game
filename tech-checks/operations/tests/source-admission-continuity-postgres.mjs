// Hosted PostgreSQL service only, synthetic data only. No provider HTTP or project credentials.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {writeFile} from 'node:fs/promises';
import {fixture,org,sha,auth,request,n} from './fixtures/source-admission-continuity.mjs';
const raw=process.env.COS_CONTINUITY_TEST_DATABASE_URL;
if(process.env.COS_CONTINUITY_POSTGRES_CI!=='1'||!raw)throw Error('Explicit synthetic PostgreSQL CI opt-in required.');
const url=new URL(raw);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname!=='/cos_upload_continuity_test_ci'||url.username!=='postgres'||url.password!=='synthetic-ci-only')throw Error('Only the dedicated disposable loopback PostgreSQL service is allowed.');
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));const {Client}=require('pg');
const clients=[],passes=[];let f;
const connect=async name=>{const c=new Client({connectionString:url.href,application_name:'cos_continuity_test_'+name});await c.connect();clients.push(c);await c.query("set statement_timeout='12s';set lock_timeout='8s';set time zone 'UTC'");return c;};
const params=values=>values?.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
const adapter=c=>({exec:sql=>c.query(sql),query:(sql,values)=>c.query(sql,params(values)),close:async()=>{}});
const admit=c=>c.query('select cos_mhelp_placement_private.admit_sources_continuity($1,$2,$3,$4,$5,$6,$7) result',params([request,org,sha,f.payload,f.admissions,f.expected,auth]));
const rollback=c=>c.query('select cos_mhelp_placement_private.rollback_sources_continuity($1,$2,$3,$4) result',[request,sha,f.payload,auth]);
const test=async(name,fn)=>{await fn();passes.push(name);console.log('PASS '+name);};
const settle=p=>p.then(value=>({value}),error=>({error}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let a,b,observer;
async function waitBlocked(client){const until=Date.now()+5000;while(Date.now()<until){const r=(await observer.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[client.processID])).rows[0];if(r?.wait_event_type==='Lock')return r;await delay(15);}throw Error('Expected a real PostgreSQL lock wait.');}
try{
 a=await connect('left');b=await connect('right');observer=await connect('observer');
 assert.equal((await a.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private'")).rows[0].n,0,'Refuse a pre-populated application database');
 f=await fixture(2,adapter(a));
 await test('uncommitted admission blocks a concurrent Owner-history phantom until rollback',async()=>{
  await a.query('begin');await admit(a);await b.query('begin');const pending=settle(b.query("insert into public.equipment_unit_location_history values($1,'Synthetic concurrent Owner move')",[n(1)]));await waitBlocked(b);await a.query('rollback');const result=await pending;assert.ifError(result.error);await b.query('rollback');assert.equal((await f.counts()).sources,0);
 });
 await test('an existing phantom writer makes admission fail NOWAIT without partial writes',async()=>{
  await b.query('begin');await b.query("insert into app_private.cos_owner_identity_claims values($1,'Synthetic in-flight claim')",[n(1)]);
  await assert.rejects(()=>admit(a),e=>e.code==='55P03');await b.query('rollback');assert.equal((await f.counts()).sources,0);
 });
 await test('sorted try-advisory acquisition refuses a preexisting native writer immediately',async()=>{
  await b.query('begin');await b.query('select pg_advisory_xact_lock(hashtextextended($1,701006))',[n(1)]);const started=Date.now();await assert.rejects(()=>admit(a),e=>e.code==='55P03');assert.ok(Date.now()-started<2500);await b.query('rollback');assert.equal((await f.counts()).sources,0);
 });
 await test('Owner history committed before admission invalidates the reviewed whole-graph head',async()=>{
  await b.query("insert into public.equipment_unit_location_history values($1,'Synthetic newer committed move')",[n(1)]);await assert.rejects(()=>admit(a),/membership or graph changed/);
  await b.query('delete from public.equipment_unit_location_history where equipment_unit_id=$1',[n(1)]);
 });
 await test('an old repeatable-read snapshot cannot miss a later committed Owner phantom',async()=>{
  await a.query('begin isolation level repeatable read');await a.query('select count(*) from public.equipment_unit_location_history');await b.query("insert into public.equipment_unit_location_history values($1,'Synthetic stale-snapshot race')",[n(1)]);
  await assert.rejects(()=>admit(a),/Read committed/);await a.query('rollback');await b.query('delete from public.equipment_unit_location_history where equipment_unit_id=$1',[n(1)]);
 });
 await test('two real clients admit exactly once and the waiting identical replay is idempotent',async()=>{
  await a.query('begin');const first=(await admit(a)).rows[0].result;const pending=settle(admit(b));await waitBlocked(b);await a.query('commit');const second=await pending;assert.ifError(second.error);assert.equal(first.idempotent,false);assert.equal(second.value.rows[0].result.idempotent,true);assert.deepEqual(await f.counts(),{sources:2,events:2,admissions:1,transitions:2});
 });
 await test('rollback refuses an in-flight then committed Owner change',async()=>{
  await b.query('begin');await b.query("insert into public.equipment_unit_location_history values($1,'Synthetic post-admission Owner move')",[n(1)]);await assert.rejects(()=>rollback(a),e=>e.code==='55P03');await b.query('commit');await assert.rejects(()=>rollback(a),/graph head changed/);
  await b.query('delete from public.equipment_unit_location_history where equipment_unit_id=$1',[n(1)]);
 });
 await test('two real clients tombstone once, preserve events and keep both reader bindings current',async()=>{
  await a.query('begin');const first=(await rollback(a)).rows[0].result;const pending=settle(rollback(b));await waitBlocked(b);await a.query('commit');const second=await pending;assert.ifError(second.error);assert.equal(first.idempotent,false);assert.equal(second.value.rows[0].result.idempotent,true);
  assert.deepEqual(await f.counts(),{sources:2,events:4,admissions:1,transitions:4});const snapshot=await f.snapshot();assert.ok(snapshot.records.every(r=>r.binding.guardCurrent===true));assert.ok(snapshot.trackerRecords.every(r=>r.binding.guardCurrent===true));
 });
 await writeFile('source-admission-continuity-postgres-results.json',JSON.stringify({syntheticOnly:true,productionWrites:0,providerCalls:0,postgresVersion:(await a.query('show server_version')).rows[0].server_version,passed:passes,counts:await f.counts()},null,2)+'\n');
}finally{for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}}
