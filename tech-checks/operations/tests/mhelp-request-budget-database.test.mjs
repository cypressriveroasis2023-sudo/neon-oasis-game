import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const sql=await readFile(new URL('../db/mhelp-request-budget.sql',import.meta.url),'utf8');
async function setup(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema cos_mhelp_placement_private;
 create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 create table cos_mhelp_placement_private.read_backoff(singleton boolean primary key,blocked_until timestamptz,probe_until timestamptz);
 insert into cos_mhelp_placement_private.read_backoff values(true,null,null);`);await db.exec(sql);return db;
}
const call=async(db,when,essential=false)=>(await db.query('select cos_mhelp_placement_private.admit_request_budget($1,$2) r',[essential,when])).rows[0].r;
const date=n=>new Date(Date.parse('2026-10-20T00:00:00Z')+n).toISOString();
test('installation holds unknown prior usage until the next actual UTC day',async()=>{
 const db=await setup();try{const hold=(await db.query('select initial_hold_until from cos_mhelp_placement_private.request_budget_config')).rows[0].initial_hold_until;
 const r=await call(db,new Date(new Date(hold).valueOf()-1).toISOString());assert.equal(r.reason,'usage_not_yet_measured');assert.equal(r.allowed,false);assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.request_budget_day')).rows[0].n,0);
 }finally{await db.close();}
});
test('all workers share pacing, every admitted retry counts and holds never debit',async()=>{
 const db=await setup();try{await db.exec('update cos_mhelp_placement_private.request_budget_config set initial_hold_until=null');
 assert.equal((await call(db,date(0))).allowed,true);assert.equal((await call(db,date(0),true)).reason,'pacing');assert.equal((await call(db,date(399))).allowed,false);assert.equal((await call(db,date(400))).allowed,true);
 const d=(await db.query('select admitted,essential_admitted from cos_mhelp_placement_private.request_budget_day')).rows[0];assert.deepEqual(d,{admitted:2,essential_admitted:0});
 }finally{await db.close();}
});
test('data cannot spend essential reserve; token calls cannot exceed the shared daily cap',async()=>{
 const db=await setup();try{await db.exec('update cos_mhelp_placement_private.request_budget_config set initial_hold_until=null,daily_limit=5,essential_reserve=2');
 for(let n=0;n<3;n++)assert.equal((await call(db,date(n*400))).allowed,true);
 const denied=await call(db,date(1200));assert.equal(denied.reason,'daily_budget');assert.equal(new Date(denied.retryAt).toISOString(),'2026-10-21T00:00:00.000Z');
 assert.equal((await call(db,date(1200),true)).allowed,true);assert.equal((await call(db,date(1600),true)).allowed,true);assert.equal((await call(db,date(2000),true)).reason,'daily_budget');
 assert.deepEqual((await db.query('select admitted,essential_admitted from cos_mhelp_placement_private.request_budget_day')).rows[0],{admitted:5,essential_admitted:2});
 // A real UTC reset starts a new ledger, never resetting the old row.
 assert.equal((await call(db,'2026-10-21T00:00:00Z')).allowed,true);assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.request_budget_day')).rows[0].n,2);
 }finally{await db.close();}
});
test('Retry-After and probe holds survive midnight and apply to reserved token calls too',async()=>{
 const db=await setup();try{await db.exec("update cos_mhelp_placement_private.request_budget_config set initial_hold_until=null;update cos_mhelp_placement_private.read_backoff set blocked_until='2026-10-21T01:00Z',probe_until='2026-10-21T02:00Z'");
 for(const essential of [false,true]){const r=await call(db,'2026-10-21T00:00Z',essential);assert.equal(r.reason,'provider_wait');assert.equal(new Date(r.retryAt).toISOString(),'2026-10-21T02:00:00.000Z');}
 assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.request_budget_day')).rows[0].n,0);
 }finally{await db.close();}
});
test('browser roles cannot call budget, forge clock, or change counters; service wrapper uses actual database time',async()=>{
 const db=await setup();try{
 await db.exec('grant usage on schema cos_mhelp_placement_private to anon,authenticated,service_role');
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role};set request.jwt.claim.role='service_role'`);
  await assert.rejects(db.query('select public.cos_mhelp_request_budget(false)'),/permission denied/);
  await assert.rejects(db.query('select * from cos_mhelp_placement_private.request_budget_day'),/permission denied/);await db.exec('reset role');
 }
 await db.exec("set role service_role;set request.jwt.claim.role='service_role'");
 await assert.rejects(db.query("select cos_mhelp_placement_private.admit_request_budget(false,'2026-10-20T00:00Z')"),/permission denied/);
 assert.equal((await db.query('select public.cos_mhelp_request_budget(false) r')).rows[0].r.reason,'usage_not_yet_measured');
 await assert.rejects(db.query('update cos_mhelp_placement_private.request_budget_config set initial_hold_until=null'),/permission denied/);
 }finally{await db.close();}
});
