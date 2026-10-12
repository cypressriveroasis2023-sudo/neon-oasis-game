import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {schema} from './fixtures/mhelp-placement-schema.mjs';
const tracker='22222222-2222-4222-8222-222222222222',revision='33333333-3333-4333-8333-333333333333',ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const cell=s=>({entered:{stringValue:s},validation:null,rich:false});
const baseline=['Spotter 023.1','FIELD','Synthetic Builder','Synthetic Job'].map(cell);
const observation={equipmentId:'123',state:'confirmed',customerId:'4',serviceLocationId:null,placement:'SHOP',customerLabel:'Cameras Onsite LLC',siteLabel:'SHOP'};
const intended=['Spotter 023.1','SHOP','Cameras Onsite LLC','SHOP'].map(cell);
async function fixture(){
 const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(schema);
 for(const file of ['20261012173408_cos_mhelp_placement_sync.sql','20261012184453_cos_sheets_placement_publisher.sql'])await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
 await db.query(`insert into app_private.vision_tracker_locations values($1,$2,'Spotter 023.1','spotter0231','SPOTTERS','FIELD','Synthetic Builder','Synthetic Job','Historical address',30,-95)`,[tracker,ORG]);
 await db.query(`insert into app_private.cos_geocode_sources values($1,'tracker',$1,'123','mhelpdesk_product_import',$2,'Spotter 023.1','Spotter 023.1',true)`,[tracker,revision]);
 const guard=(await db.query('select cos_mhelp_placement_private.guard($1,null) value',[tracker])).rows[0].value;
 const link={equipmentId:'123',trackerId:tracker,nativeUnitId:null,trackerLabel:'Spotter 023.1',nativeLabel:null,fullLabel:'Spotter 023.1',model:null,sourceRevision:revision,expectedGuard:guard,customerId:'2',serviceLocationId:'3',placement:'FIELD',customerLabel:'Synthetic Builder',siteLabel:'Synthetic Job'};
 await db.query('select cos_mhelp_placement_private.admit($1,$2)',[[link],'a'.repeat(64)]);
 await db.query('update cos_mhelp_placement_private.links set observation=$1,observed_at=clock_timestamp()',[observation]);await db.exec('update cos_mhelp_placement_private.control set enabled=true,last_success_at=clock_timestamp()');
 const binding={equipmentId:'123',sheetId:2017346590,row:2,label:'Spotter 023.1',cells:baseline};
 await db.query('select cos_sheets_placement_private.admit($1,$2)',[[binding],'b'.repeat(64)]);
 return db;
}
const begin=async db=>(await db.query('select public.cos_sheets_placement_begin() value')).rows[0].value;
const stage=async(db,lease,cells=intended)=>(await db.query('select public.cos_sheets_placement_stage($1,$2) value',[lease,[{equipmentId:'123',observation,cells}]])).rows[0].value;
test('publisher is default-off, private to service RPCs, serialized, and cannot change operational data',async()=>{
 const db=await fixture();try{
  assert.equal((await begin(db)).leaseId,null);await db.exec('update cos_sheets_placement_private.control set enabled=true');
  const operational=(await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t')).rows;
  const first=await begin(db);assert(first.leaseId);assert.equal(first.bindings[0].sourceCurrent,true);assert.equal((await begin(db)).leaseId,null);
  assert.equal((await stage(db,first.leaseId)).committed,true);
  await assert.rejects(()=>db.query('select public.cos_sheets_placement_finish($1,$2)',[first.leaseId,[{equipmentId:'123',state:'published',cells:baseline}]]),/readback/);
  const result=(await db.query('select public.cos_sheets_placement_finish($1,$2) value',[first.leaseId,[{equipmentId:'123',state:'published',cells:intended}]])).rows[0].value;
  assert.deepEqual(result,{committed:true,published:1,recovered:0,unchanged:0,held:0,sheetsPublisher:true});
  assert.deepEqual((await db.query('select baseline_cells,pending_cells from cos_sheets_placement_private.bindings')).rows[0],{baseline_cells:intended,pending_cells:null});
  assert.deepEqual((await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t')).rows,operational);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select public.cos_sheets_placement_begin()'));await assert.rejects(()=>db.query('select * from cos_sheets_placement_private.bindings'));await db.exec('reset role');}
  assert.equal((await db.query('select public.cos_sheets_placement_finish($1,$2) value',[first.leaseId,[]])).rows[0].value.committed,false);
 }finally{await db.close();}
});
test('source edits, stale receipts, forged customer/site values, changed validation and expired leases cannot stage',async()=>{
 const db=await fixture();try{
  await db.exec('update cos_sheets_placement_private.control set enabled=true');const lease=(await begin(db)).leaseId;
  for(const cells of [intended.map((c,i)=>i===2?cell('Wrong builder'):c),intended.map((c,i)=>i===3?cell('Wrong job'):c),intended.map((c,i)=>i===0?cell('Spotter 023'):c),intended.map((c,i)=>i===1?{...c,validation:{condition:{type:'BOOLEAN'}}}:c)])await assert.rejects(()=>stage(db,lease,cells));
  await db.exec("update app_private.vision_tracker_locations set site='New technician job'");await assert.rejects(()=>stage(db,lease),/changed/);
  await db.exec("update app_private.vision_tracker_locations set site='Synthetic Job';update cos_mhelp_placement_private.links set observed_at=clock_timestamp()-interval '21 minutes'");await assert.rejects(()=>stage(db,lease),/changed/);
  await db.exec("update cos_sheets_placement_private.control set lease_until=clock_timestamp()-interval '1 second'");assert.equal((await stage(db,lease)).committed,false);
  assert.equal((await db.query('select pending_cells from cos_sheets_placement_private.bindings')).rows[0].pending_cells,null);
 }finally{await db.close();}
});
test('failure preserves the exact pending intent for recovery; held results never acknowledge readback',async()=>{
 const db=await fixture();try{
  await db.exec('update cos_sheets_placement_private.control set enabled=true');const lease=(await begin(db)).leaseId;await stage(db,lease);
  await db.query('select public.cos_sheets_placement_fail($1)',[lease]);assert.deepEqual((await db.query('select pending_cells from cos_sheets_placement_private.bindings')).rows[0].pending_cells,intended);
  await db.exec('update cos_sheets_placement_private.control set last_attempt_at=null');const next=(await begin(db)).leaseId;
  await db.query('select public.cos_sheets_placement_finish($1,$2)',[next,[{equipmentId:'123',state:'held',reason:'manual_sheet_change'}]]);
  assert.deepEqual((await db.query('select baseline_cells,pending_cells from cos_sheets_placement_private.bindings')).rows[0],{baseline_cells:baseline,pending_cells:intended});
  await db.exec('update cos_sheets_placement_private.control set last_attempt_at=null');const recover=(await begin(db)).leaseId;
  const done=(await db.query('select public.cos_sheets_placement_finish($1,$2) value',[recover,[{equipmentId:'123',state:'recovered',cells:intended}]])).rows[0].value;assert.equal(done.recovered,1);
 }finally{await db.close();}
});
