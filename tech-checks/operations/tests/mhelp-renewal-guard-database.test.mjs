import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../db/mhelp-renewal-guard.sql',import.meta.url),'utf8');
const lease='00000000-0000-4000-8000-000000000001';
async function fixture(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema cos_mhelp_placement_private;create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;create table public.cos_mhelp_token_state(singleton boolean primary key,revision bigint,lease_id uuid,lease_revision bigint,lease_kind text,lease_until timestamptz);insert into public.cos_mhelp_token_state values(true,9,'${lease}',9,'renew',clock_timestamp()+interval '2 minutes');set request.jwt.claim.role='service_role';`);await db.exec(sql);return db;}
const call=async(db,action,id=null)=>(await db.query('select public.cos_mhelp_renewal_guard($1,$2::uuid) r',[action,id])).rows[0].r;
test('rejection is durable/idempotent for this exact revision and a later secure revision is independent',async()=>{
 const db=await fixture();try{assert.deepEqual(await call(db,'check'),{allowed:true,revision:9});assert.deepEqual(await call(db,'reject',lease),{allowed:false,revision:9});assert.deepEqual(await call(db,'reject',lease),{allowed:false,revision:9});assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.rejected_refresh_grant')).rows[0].n,1);await db.exec('update public.cos_mhelp_token_state set revision=10');assert.deepEqual(await call(db,'check'),{allowed:true,revision:10});}finally{await db.close();}
});
test('expired, replaced, reconnect and missing leases cannot reject a newer stored pair',async()=>{
 const db=await fixture();try{for(const change of ["lease_id=null","lease_until=null","lease_until=clock_timestamp()-interval '1 second'","lease_kind='reconnect'","lease_revision=8"]){await db.exec(`update public.cos_mhelp_token_state set lease_id='${lease}',lease_until=clock_timestamp()+interval '2 minutes',lease_kind='renew',lease_revision=9;update public.cos_mhelp_token_state set ${change}`);await assert.rejects(call(db,'reject',lease),/lease changed/);}assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.rejected_refresh_grant')).rows[0].n,0);}finally{await db.close();}
});
test('browser roles cannot fake rejection or inspect guard history even with forged JWT settings',async()=>{
 const db=await fixture();try{for(const role of ['anon','authenticated']){await db.exec(`set role ${role};set request.jwt.claim.role='service_role'`);await assert.rejects(call(db,'reject',lease),/permission denied/);await db.exec('reset role');}await db.exec("set role service_role;set request.jwt.claim.role='service_role'");assert.equal((await call(db,'check')).allowed,true);await assert.rejects(db.query('select * from cos_mhelp_placement_private.rejected_refresh_grant'),/permission denied/);}finally{await db.close();}
});
