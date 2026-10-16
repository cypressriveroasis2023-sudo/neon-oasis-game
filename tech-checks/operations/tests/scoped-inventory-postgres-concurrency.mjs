// Synthetic, disposable loopback PostgreSQL only. Uses the existing pinned pg package.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fixture,actor,org,hash,tracker} from './fixtures/scoped-inventory-fixture.mjs';
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));
const {Client}=require('pg');
const url=new URL(process.env.COS_SCOPED_TEST_DATABASE_URL??'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/cos_scoped_test_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('Use a disposable loopback cos_scoped_test_* database without connection overrides.');
const database=url.pathname.slice(1),adminUrl=new URL(url);adminUrl.pathname='/postgres';
const admin=new Client({connectionString:adminUrl.href}),clients=[];
let created=false;
const originalSql=execFileSync('git',['show','916129fcc09049cffdd2c519f67b2ef95e5d3587:tech-checks/operations/db/scoped_inventory_overlay.sql'],{encoding:'utf8'});
const candidate=await readFile(new URL('../db/scoped_inventory_overlay.sql',import.meta.url),'utf8');
const upgrade=candidate.slice(candidate.indexOf('create or replace function cos_mhelp_placement_private.review_scoped_inventory('),candidate.indexOf('create function cos_mhelp_placement_private.rollback_scoped_inventory('))+candidate.slice(candidate.indexOf('create or replace function cos_mhelp_placement_private.upload_snapshot()'),candidate.lastIndexOf('revoke all on function'));
const query='select cos_mhelp_placement_private.review_scoped_inventory($1,$2,$3,$4,$5,$6,$7,$8) v';
const connect=async()=>{const c=new Client({connectionString:url.href});await c.connect();clients.push(c);await c.query("set statement_timeout='8s';set lock_timeout='6s'");return c;};
const jsonParams=values=>values?.map(v=>typeof v==='object'&&v!==null?JSON.stringify(v):v);
const metadata=async c=>(await c.query("select oid,proowner,proacl,prosecdef,proconfig from pg_proc where oid in ('cos_mhelp_placement_private.review_scoped_inventory(uuid,uuid,text,bigint,uuid,jsonb,jsonb,boolean)'::regprocedure,'cos_mhelp_placement_private.upload_snapshot()'::regprocedure) order by oid")).rows;
const saved=async c=>(await c.query("select jsonb_build_object('batches',(select jsonb_agg(to_jsonb(b) order by id) from cos_mhelp_placement_private.scoped_batches b),'control',(select jsonb_agg(to_jsonb(c)) from cos_mhelp_placement_private.scoped_control c),'audit',(select jsonb_agg(to_jsonb(a) order by id) from cos_mhelp_placement_private.scoped_audit a)) v")).rows[0].v;
async function blocked(observer,c){
 const until=Date.now()+4000;
 while(Date.now()<until){const row=(await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[c.processID])).rows[0];if(row?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}
 throw Error('Expected a real PostgreSQL lock wait');
}
try{
 await admin.connect();await admin.query('create database '+database);created=true;
 const db=await connect(),left=await connect(),right=await connect(),observer=await connect();
 assert.equal(new Set(clients.map(c=>c.processID)).size,4);
 const adapter={exec:sql=>db.query(sql.replace(/create role (anon|authenticated|service_role);/g,(_,role)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$;`)),query:(sql,values)=>db.query(sql,jsonParams(values))};
 const f=await fixture({database:adapter,overlaySql:originalSql});
 await f.call({apply:true});const security=await metadata(db),state=await saved(db),snapshot=await f.snapshot(),preserved=await f.preserved();
 await db.query('begin');await db.query(upgrade);await db.query('commit');
 assert.deepEqual(await metadata(db),security);assert.deepEqual(await saved(db),state);assert.deepEqual(await f.snapshot(),snapshot);assert.deepEqual(await f.preserved(),preserved);
 console.log('PASS actual PR176 revision-one upgrade preserves function OIDs, owners, ACL, security/config and all saved state');
 const record=async()=>(await db.query('select cos_mhelp_placement_private.scoped_records($1) v',[hash])).rows[0].v[0];
 const op={mode:'assignment',expectedRecord:await record(),after:{...f.op.after,customer:'Synthetic next customer'}};
 const params=(id,revision=1,operation=op)=>jsonParams([actor,org,hash,revision,id,f.evidence,[operation],true]);
 const id='44444444-4444-4444-8444-444444444444';
 await left.query('begin');await left.query(query,params(id));
 const competing=right.query(query,params('55555555-5555-4555-8555-555555555555')).then(()=>({ok:true}),e=>({code:e.code}));
 await blocked(observer,right);await left.query('commit');assert.equal((await competing).code,'40001');assert.equal((await f.snapshot()).scopedRevision,2);
 assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.scoped_batches')).rows[0].n,2);
 console.log('PASS independent scoped writers serialize; stale revision loses without a batch');
 const rollback='select cos_mhelp_placement_private.rollback_scoped_inventory($1,$2,$3,2,$4,$5)';
 await left.query('begin');await left.query(rollback,[actor,org,hash,id,hash]);
 const losingRollback=right.query(rollback,[actor,org,hash,id,hash]).then(()=>({ok:true}),e=>({code:e.code}));
 await blocked(observer,right);await left.query('commit');assert.equal((await losingRollback).code,'40001');assert.equal((await f.snapshot()).scopedRevision,3);
 console.log('PASS concurrent rollback loses on current head/revision and retains immutable batches');
 const current=await record(),next={...op,expectedRecord:current};
 const nextParams=params('66666666-6666-4666-8666-666666666666',3,next);
 await left.query('begin');await left.query("update app_private.vision_tracker_locations set customer='Uncommitted Owner change' where id=$1",[tracker]);
 await assert.rejects(()=>right.query(query,nextParams),e=>e.code==='55P03');await left.query('rollback');
 assert.equal((await right.query(query,[...nextParams.slice(0,7),false])).rows[0].v.applied,false);
 console.log('PASS active identity writer causes NOWAIT rejection with no partial writes');
 await left.query('begin');await left.query(query,[...nextParams.slice(0,7),false]);
 const writer=right.query("update app_private.vision_tracker_locations set customer='Committed Owner change' where id=$1",[tracker]);
 await blocked(observer,right);await left.query('commit');await writer;
 await assert.rejects(()=>db.query(query,nextParams),e=>e.code==='40001'&&/Identity graph changed/.test(e.message));
 assert.equal((await f.snapshot()).records[0].binding.guardCurrent,false);
 assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.scoped_batches')).rows[0].n,2);
 console.log('PASS review holds identity writers; committed drift rejects subsequent admission and holds projection');
 const beforeBaseRace=await saved(db);
 await left.query('begin');await left.query('update cos_mhelp_placement_private.upload_control set active_sha256=null where singleton');
 const baseRace=right.query(query,nextParams).then(()=>({ok:true}),e=>({code:e.code}));
 await blocked(observer,right);await left.query('commit');assert.equal((await baseRace).code,'40001');assert.deepEqual(await saved(db),beforeBaseRace);
 console.log('PASS base upload change serializes and invalidates waiting scoped request');
 console.log('6/6 PostgreSQL upgrade/contention scenarios passed');
}finally{
 for(const c of clients){await c.query('rollback').catch(()=>{});await c.end();}
 if(created)await admin.query('drop database '+database);
 await admin.end();
}
