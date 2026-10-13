import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {schema} from './fixtures/mhelp-placement-schema.mjs';
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',tracker='22222222-2222-4222-8222-222222222222',revision='33333333-3333-4333-8333-333333333333';
async function fixture(){
 const db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(schema);
 await db.exec(await readFile(new URL('../db/20261012173408_cos_mhelp_placement_sync.sql',import.meta.url),'utf8'));
 await db.query(`insert into app_private.vision_tracker_locations values($1,$2,'Solar Pole 72 002','solarpole72002','SOLAR POLES & SKIDS','FIELD','Synthetic Builder','Synthetic Job','Historical address',30,-95)`,[tracker,ORG]);
 await db.query(`insert into app_private.cos_geocode_sources values($1,'tracker',$1,'123','mhelpdesk_product_import',$2,'Solar Pole 72 002','Solar Pole 72 002',true)`,[tracker,revision]);
 return db;
}
async function admission(db){
 const guard=(await db.query('select cos_mhelp_placement_private.guard($1,null) value',[tracker])).rows[0].value;
 return {equipmentId:'123',trackerId:tracker,nativeUnitId:null,trackerLabel:'Solar Pole 72 002',nativeLabel:null,fullLabel:'Solar Pole 002 72 (Hybrid solar stand)',model:null,sourceRevision:revision,expectedGuard:guard,customerId:'2',serviceLocationId:'3',placement:'FIELD',customerLabel:'Synthetic Builder',siteLabel:'Synthetic Job'};
}
const confirmed={equipmentId:'123',state:'confirmed',customerId:'4',serviceLocationId:'5',placement:'FIELD',customerLabel:'New Builder',siteLabel:'New Job'};
test('reviewed receipt workflow preserves every operational row, detects manual edits and denies public access',async()=>{
 const db=await fixture();try{
 const link=await admission(db),before=(await db.query('select to_jsonb(t) as row from app_private.vision_tracker_locations t')).rows;
 assert.equal((await db.query('select cos_mhelp_placement_private.admit($1,$2) value',[[link],'a'.repeat(64)])).rows[0].value,1);
 await db.exec('update cos_mhelp_placement_private.control set enabled=true');
 const begin=(await db.query('select public.cos_mhelp_placement_begin() value')).rows[0].value;
 assert.equal((await db.query('select public.cos_mhelp_placement_begin() value')).rows[0].value.leaseId,null);
 const finish=(await db.query('select public.cos_mhelp_placement_finish($1,$2) value',[begin.leaseId,[confirmed]])).rows[0].value;
 assert.deepEqual(finish,{committed:true,confirmed:1,held:0,sheetsPublisher:false});
 assert.deepEqual((await db.query('select to_jsonb(t) as row from app_private.vision_tracker_locations t')).rows,before);
 let snap=(await db.query('select public.cos_mhelp_placement_snapshot($1,$2) value',[tracker,ORG])).rows[0].value;
 assert.equal(snap.items[0].state,'confirmed');assert.equal(snap.items[0].locationReview,true);
 await db.exec("update app_private.vision_tracker_locations set site='Technician correction'");
 snap=(await db.query('select public.cos_mhelp_placement_snapshot($1,$2) value',[tracker,ORG])).rows[0].value;assert.equal(snap.items[0].state,'held');
 assert.equal((await db.query('select public.cos_mhelp_placement_finish($1,$2) value',[begin.leaseId,[confirmed]])).rows[0].value.committed,false);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select public.cos_mhelp_placement_begin()'));await assert.rejects(()=>db.query('select * from cos_mhelp_placement_private.links'));await db.exec('reset role');}
 }finally{await db.close();}
});
test('stale admission and forged assignment fail atomically; partial observations cannot finish a lease',async()=>{
 const db=await fixture();try{
 const link=await admission(db);await db.exec("update app_private.vision_tracker_locations set address='Newer edit'");
 await assert.rejects(()=>db.query('select cos_mhelp_placement_private.admit($1,$2)',[[link],'a'.repeat(64)]),/changed/);
 assert.equal((await db.query('select count(*) n from cos_mhelp_placement_private.links')).rows[0].n,0);
 await db.query('select cos_mhelp_placement_private.admit($1,$2)',[[await admission(db)],'a'.repeat(64)]);
 await db.exec('update cos_mhelp_placement_private.control set enabled=true');const lease=(await db.query('select public.cos_mhelp_placement_begin() value')).rows[0].value.leaseId;
 await assert.rejects(()=>db.query('select public.cos_mhelp_placement_finish($1,$2)',[lease,[]]),/Incomplete/);
 await assert.rejects(()=>db.query('select public.cos_mhelp_placement_finish($1,$2)',[lease,[{...confirmed,placement:'SHOP'}]]),/Invalid assignment/);
 assert.equal((await db.query('select observation from cos_mhelp_placement_private.links')).rows[0].observation,null);
 }finally{await db.close();}
});
test('additive receipt exposes held reason without changing guards, rows, actor checks or grants',async()=>{
 const db=await fixture();try{
  await db.query('select cos_mhelp_placement_private.admit($1,$2)',[[await admission(db)],'a'.repeat(64)]);
  await db.exec("update cos_mhelp_placement_private.links set observation='{"+'"state":"held","reason":"service_location_unverified"'+"}'::jsonb,observed_at=clock_timestamp()");
  const before=(await db.query('select to_jsonb(t) row from app_private.vision_tracker_locations t')).rows;
  const acl=(await db.query("select proacl::text acl from pg_proc where oid='public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure")).rows;
  await db.exec(await readFile(new URL('../db/mhelp_placement_reason_projection.sql',import.meta.url),'utf8'));
  const snap=(await db.query('select public.cos_mhelp_placement_snapshot($1,$2) value',[tracker,ORG])).rows[0].value;
  assert.equal(snap.items[0].reason,'service_location_unverified');assert.equal(snap.items[0].guardCurrent,true);assert.equal(snap.items[0].state,'held');
  assert.deepEqual((await db.query('select to_jsonb(t) row from app_private.vision_tracker_locations t')).rows,before);
  assert.deepEqual((await db.query("select proacl::text acl from pg_proc where oid='public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure")).rows,acl);
  await db.exec("update app_private.vision_tracker_locations set site='Newer changed installation'");
  const changed=(await db.query('select public.cos_mhelp_placement_snapshot($1,$2) value',[tracker,ORG])).rows[0].value;assert.equal(changed.items[0].guardCurrent,false);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select public.cos_mhelp_placement_snapshot($1,$2)',[tracker,ORG]));await db.exec('reset role');}
 }finally{await db.close();}
});
