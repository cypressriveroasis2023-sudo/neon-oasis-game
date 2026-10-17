// Disposable loopback PostgreSQL only. No production URL or credentials accepted.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fixture,actor,org,hash,it} from './fixtures/owner-identity-upload-fixture.mjs';
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));
const {Client}=require('pg');
const url=new URL(process.env.COS_SOURCE_TRANSITION_TEST_DATABASE_URL??'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)
 || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
 || !/^\/cos_source_transition_test_[a-z0-9_]+$/.test(url.pathname)
 || url.search||url.hash)throw Error('Disposable loopback cos_source_transition_test_* database required.');
const database=url.pathname.slice(1)+'_case';
const adminUrl=new URL(url);adminUrl.pathname='/postgres';
const caseUrl=new URL(url);caseUrl.pathname='/'+database;
const admin=new Client({connectionString:adminUrl.href});await admin.connect();
const clients=[];
const jsonValues=vals=>vals?.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
const readSql=async(name)=>readFile(new URL('../db/'+name,import.meta.url),'utf8');
async function blocked(observer,client){
 const deadline=Date.now()+3500;
 while(Date.now()<deadline){
  const r=await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID]);
  if(r.rows[0]?.wait_event_type==='Lock')return;
  await new Promise(resolve=>setTimeout(resolve,30));
 }
 throw Error('Expected independent PostgreSQL transaction blocked on active-source head lock.');
}
try {
 await admin.query('create database '+database);
 for(let i=0;i<4;i++){
  const c=new Client({connectionString:caseUrl.href});await c.connect();
  await c.query("set statement_timeout='8s';set lock_timeout='6s'");
  clients.push(c);
 }
 const [db,left,right,observer]=clients;
 assert.equal(new Set(clients.map(x=>x.processID)).size,4);
 const adapter={
  exec:sql=>db.query(sql.replace(/create role (anon|authenticated|service_role);/g,(_,role)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$;`)),
  query:(sql,values)=>db.query(sql,jsonValues(values))
 };
 const f=await fixture({database:adapter,recordCount:1001});
 await db.query('create table app_private.cos_archived_representation_revocations (id uuid)');
 const original=await f.snapshot(),preserved=await f.preserved();
 const continuity=await readSql('mhelp-source-continuity.sql');
 await db.query(continuity.slice(continuity.indexOf('-- Same complete graph'),continuity.indexOf('create function cos_mhelp_placement_private.continuity_unchanged')));
 await db.query(await readSql('cos_source_transition_continuity_20261017.sql'));
 assert.deepEqual(await f.snapshot(),original);
 assert.deepEqual(await f.preserved(),preserved);
 assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.source_transition_receipts')).rows[0].n,0);
 for(const role of ['anon','authenticated','service_role']){
  await db.query('set role '+role);
  await assert.rejects(()=>db.query('select * from cos_mhelp_placement_private.source_transition_receipts'),e=>e.code==='42501');
  await assert.rejects(()=>db.query('select cos_mhelp_placement_private.source_transition_review($1,$2,$3,$4)',[hash,hash,hash,'2258987']),e=>e.code==='42501');
  await db.query('reset role');
 }
 await assert.rejects(()=>db.query('delete from cos_mhelp_placement_private.source_transition_receipts'),e=>e.code==='42501');
 await assert.rejects(()=>db.query('truncate cos_mhelp_placement_private.source_transition_receipts'),e=>e.code==='42501');
 await db.query("set role service_role");
 await assert.rejects(()=>db.query('select cos_mhelp_placement_private.admit_source_transition($1,$2,$3,$4,$5,$6,$7,$8,$9)',[actor,org,hash,hash,'b'.repeat(64),'2258987','c'.repeat(64),'77777777-7777-4777-8777-777777777777',true]),e=>e.code==='42501');
 await db.query('reset role');
 await left.query('begin');
 await left.query('select * from cos_mhelp_placement_private.upload_control where singleton for update');
 const pending=right.query('select cos_mhelp_placement_private.admit_source_transition($1,$2,$3,$4,$5,$6,$7,$8,$9)',[actor,org,hash,hash,'b'.repeat(64),'2258987','c'.repeat(64),'88888888-8888-4888-8888-888888888888',true]).then(()=>({ok:true}),e=>({code:e.code,message:e.message}));
 await blocked(observer,right);
 await left.query('commit');
 const denied=await pending;
 assert.equal(denied.code,'40001',JSON.stringify(denied));
 assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.source_transition_receipts')).rows[0].n,0);
 assert.deepEqual(await f.snapshot(),original);
 assert.deepEqual(await f.preserved(),preserved);
 console.log('PASS real PostgreSQL 17.11: isolation, source-head contention, private roles, immutable receipts, complete 1001 / 287 / 714 preservation, no unauthorized transition');
}finally{
 for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
 await admin.query('drop database if exists '+database).catch(()=>{});
 await admin.end();
}
