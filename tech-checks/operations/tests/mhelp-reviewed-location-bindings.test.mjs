import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
import {schema} from './fixtures/mhelp-placement-schema.mjs';
import {collectFleetLocations} from '../../supabase/functions/cos-mhelp-placement-sync/fleetLocations.ts';
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',tracker='22222222-2222-4222-8222-222222222222',revision='33333333-3333-4333-8333-333333333333';
const proof={equipmentId:'123',fullLabel:'Solar Pole 002 72 (Hybrid solar stand)',model:null,guardCurrent:true};
const candidate={kind:'tracker',unitId:tracker,unitNumber:'Solar Pole 72 002',guard:'a'.repeat(64),reviewedEquipment:proof};
const equipment={equipmentId:'123',name:proof.fullLabel,model:null,active:true};
const location={placement:'FIELD',customer:'Synthetic Builder',site:'Synthetic Job',address:'123 Synthetic St, Houston, TX 77002',point:[30,-95],coordinateSource:'mHelpDesk service location'};
test('reviewed ID resolves a formatting alias without establishing an unreviewed name match',async()=>{
 const known=await collectFleetLocations([candidate],[equipment],async()=>location);assert.equal(known[0].state,'confirmed');assert.equal(known[0].equipmentId,'123');
 const unknown=await collectFleetLocations([{...candidate,reviewedEquipment:null}],[equipment],async()=>{throw Error('No unreviewed read');});assert.equal(unknown[0].reason,'not_numbered_field_equipment');
 for(const changed of [{...equipment,name:'Different unit'},{...equipment,model:'Changed hardware'},{...equipment,active:false},{...equipment,equipmentId:'124'}]){
  let reads=0;const result=await collectFleetLocations([candidate],[changed],async()=>{reads++;return location;});assert.equal(result[0].state,'held');assert.equal(reads,0);
 }
 for(const reviewedEquipment of [{...proof,guardCurrent:false},{...proof,equipmentId:'../123'},{...proof,fullLabel:'<unsafe>'}])assert.equal((await collectFleetLocations([{...candidate,reviewedEquipment}],[equipment],async()=>location))[0].state,'held');
});
test('current reviewed aliases preserve ACLs and become unavailable when their source binding changes',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(schema);
  for(const file of ['20261012173408_cos_mhelp_placement_sync.sql','20261012215500_cos_mhelp_fleet_locations.sql'])await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
  await db.query("insert into app_private.vision_tracker_locations values($1,$2,'Solar Pole 72 002','solarpole72002','SOLAR POLES & SKIDS','FIELD','Synthetic Builder','Synthetic Job','Old address',30,-95)",[tracker,org]);
  await db.query("insert into app_private.cos_geocode_sources values($1,'tracker',$1,'123','mhelpdesk_product_import',$2,'Solar Pole 72 002','Solar Pole 72 002',true)",[tracker,revision]);
  const expectedGuard=(await db.query('select cos_mhelp_placement_private.guard($1,null) value',[tracker])).rows[0].value;
  await db.query('select cos_mhelp_placement_private.admit($1,$2)',[[{equipmentId:'123',trackerId:tracker,nativeUnitId:null,trackerLabel:candidate.unitNumber,nativeLabel:null,fullLabel:proof.fullLabel,model:null,sourceRevision:revision,expectedGuard,customerId:'2',serviceLocationId:'3',placement:'FIELD',customerLabel:location.customer,siteLabel:location.site}],'a'.repeat(64)]);
  const acl=()=>db.query("select proname,proacl::text from pg_proc where proname in('cos_mhelp_location_candidates','cos_mhelp_location_snapshot') order by proname");
  const before=(await acl()).rows,inventory=(await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t')).rows;
  await db.exec(await readFile(new URL('../../database-maintenance/cos-mhelp-reviewed-location-bindings.sql',import.meta.url),'utf8'));
  assert.deepEqual((await acl()).rows,before);
  const rows=(await db.query('select public.cos_mhelp_location_candidates() value')).rows[0].value;assert.deepEqual(rows[0].reviewedEquipment,proof);
  await db.query('select cos_mhelp_placement_private.store_location($1)',[{...rows[0],reviewedEquipment:undefined,previous:undefined,inactive:undefined,state:'confirmed',equipmentId:'123',...location}]);
  let snap=(await db.query('select public.cos_mhelp_location_snapshot($1,$2) value',[tracker,org])).rows[0].value;assert.equal(snap.items[0].guardCurrent,true);
  await db.exec('update app_private.cos_geocode_sources set active=false');
  snap=(await db.query('select public.cos_mhelp_location_snapshot($1,$2) value',[tracker,org])).rows[0].value;assert.equal(snap.items[0].guardCurrent,false);
  assert.equal((await db.query('select public.cos_mhelp_location_candidates() value')).rows[0].value[0].reviewedEquipment,null);
  assert.deepEqual((await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t')).rows,inventory);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select public.cos_mhelp_location_candidates()'));await assert.rejects(db.query('select * from cos_mhelp_placement_private.locations'));await db.exec('reset role');}
 }finally{await db.close();}
});
