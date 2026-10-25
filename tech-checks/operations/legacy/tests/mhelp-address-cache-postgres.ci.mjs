/** Synthetic, fixed-loopback hosted PostgreSQL proof; never contacts production. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from '../../tests/mhelp-address-automation-fixture.mjs';
import {assertCiContext,validateIsolatedServer,parameters,openPsql} from './mhelp-postgres-concurrency.ci.mjs';
assertCiContext();
const exec=sql=>openPsql(sql).done;
const query=async(sql,args=[])=>{args=args.map(value=>value!==null&&typeof value==='object'?JSON.stringify(value):value);if(!/^\s*(select|with)\b/i.test(sql)){await exec(parameters(sql,args));return {rows:[]};}const raw=await exec("select coalesce(json_agg(row_to_json(x)),'[]'::json) from ("+parameters(sql,args).replace(/;\s*$/,'')+")x;");return {rows:JSON.parse(raw.trim().split(/\r?\n/).at(-1))};};
validateIsolatedServer((await query('select current_database() database,current_user account,inet_server_port() port')).rows[0]);
const db={exec,query,close:async()=>{}};
const f=await fixture({database:db,indexedCache:false});
const definition=async()=>(await query("select pg_get_functiondef(p.oid) definition,md5(pg_get_functiondef(p.oid)) md5,proacl::text acl,prosecdef,proconfig from pg_proc p where oid='cos_mhelp_placement_private.address_automation_sync_v1()'::regprocedure")).rows[0];
const before=await definition();assert.equal(before.md5,'01b92cbebfd923130a4985696310684e');
const migration=await readFile(new URL('../../db/mhelp-address-cache-lookup.sql',import.meta.url),'utf8');
const lookup=JSON.parse(await readFile(new URL('../../tests/fixtures/mhelp-address-cache-lookup.json',import.meta.url),'utf8'));
assert(migration.includes(lookup.helper)&&migration.includes('$old$'+lookup.old+'$old$')&&migration.includes('$new$'+lookup.new+'$new$'));
await exec(before.definition.replace('n:=n+1;','n:=n+1; -- synthetic definition drift'));
await assert.rejects(exec(migration),/Address worker definition changed/);
assert.equal((await query("select count(*)::integer n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='cos_mhelp_placement_private' and p.proname='address_cache_json_key_v1'")).rows[0].n,0,'failed upgrade rolls back helper/index creation');
await exec(before.definition);await exec(migration);
const after=await definition();assert.deepEqual({...after,md5:before.md5,definition:before.definition},{...before},'ACL, security and config are unchanged');
assert.equal(after.definition,before.definition.replace(lookup.old,lookup.new));
const address={street:'123 Main Road',city:'Houston',state:'TX',zip:'77002'};
const rec=(id,placement='FIELD')=>({productId:String(id),unitNumber:'Synthetic '+id,category:'Other',customerId:placement==='SHOP'?'11':'12',customer:'Synthetic private site',placement,lifecycle:'UNFLAGGED',sourceAddress:address});
await f.activate([rec(1),rec(2)]);await f.tick();await f.respond();await f.tick();
const protectedBefore=(await query('select to_jsonb(t) v from public.equipment_units t')).rows;
await f.activate([rec(1),rec(2,'SHOP')],'c'.repeat(64),'d'.repeat(64));
const holder=openPsql('begin;select pg_advisory_xact_lock(20261018,287);',{held:true,application:'mhelp-address-ci-holder'});
try{await holder.ready;assert.equal((await f.tick()).state,'already_running');}finally{await holder.rollback();}
assert.equal((await f.tick()).sent,0);const map=await f.read();assert.equal(map.fieldProducts,1);assert.equal(map.shopProducts,1);assert.equal(map.items[0].latitude,29.7);assert.equal(map.items[0].verified,false);
assert.deepEqual((await query('select to_jsonb(t) v from public.equipment_units t')).rows,protectedBefore);
for(const role of ['anon','authenticated','service_role'])for(const call of ["select cos_mhelp_placement_private.address_automation_sync_v1()","select cos_mhelp_placement_private.address_cache_lookup_key_v1('a','b','c','d')","select cos_mhelp_placement_private.address_cache_json_key_v1('{}')"]){await assert.rejects(exec('begin;set local role '+role+';'+call+';commit;'),e=>e.sqlstate==='42501');}
console.log('PASS actual PostgreSQL guarded migration/readback/ACL/config, exact-address reuse, Shop return, denied roles, advisory single-worker contention and protected data preservation');
