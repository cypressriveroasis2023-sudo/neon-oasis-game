import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
import {schema} from './fixtures/mhelp-placement-schema.mjs';
import {mhelpUnitIdentity} from '../shared/mhelpUnitIdentity.ts';
import {collectFleetLocations} from '../../supabase/functions/cos-mhelp-placement-sync/fleetLocations.ts';
import {createFleetLocationReader} from '../../supabase/functions/cos-mhelp-placement-sync/locationReader.ts';
import {projectMhelpFleetLocations} from '../../supabase/functions/cos-operations-pages/mhelpFleetLocationProjection.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',id='11111111-1111-4111-8111-111111111111',at='2026-10-12T18:00:00Z',now=Date.parse(at);
const location={state:'confirmed',equipmentId:'44',placement:'FIELD',customer:'Synthetic builder',site:'Job',address:'123 Main St, Houston, TX 77002',point:[29.76,-95.37],coordinateSource:'mHelpDesk service location'};
test('full family, tag, decimal and variant identities are preserved; notes and lifecycle labels never qualify',()=>{
 assert.equal(mhelpUnitIdentity('Recon II 010').key,mhelpUnitIdentity('RII 10').key);assert.notEqual(mhelpUnitIdentity('Sniper 2 010').key,mhelpUnitIdentity('Sniper 2010').key);
 assert.notEqual(mhelpUnitIdentity('Spotter 023.1').key,mhelpUnitIdentity('Spotter 023').key);assert.notEqual(mhelpUnitIdentity('Spotter 023HD4').key,mhelpUnitIdentity('Spotter 023').key);
 for(const value of ['Helios 010 notes','Helios 010 / 011','Helios 010 DO NOT USE','<script>Helios 010</script>','Helios 000'])assert.equal(mhelpUnitIdentity(value),null);
});
test('all-unit source collection retains missing and duplicate reasons instead of guessing placement',async()=>{
 const units=['Helios 010','Recon II 010','Sniper 010','Spotter 023.1'].map((unitNumber,i)=>({unitId:String(i),kind:'equipment_unit',unitNumber,guard:'a'.repeat(64)}));
 const equipment=units.slice(0,3).map((u,i)=>({equipmentId:String(i+1),name:u.unitNumber,active:true}));equipment.push({...equipment[2],equipmentId:'4'});
 const rows=await collectFleetLocations(units,equipment,async()=>location);assert.equal(rows[0].placement,'FIELD');assert.equal(rows[1].placement,'FIELD');assert.equal(rows[2].reason,'duplicate_mhelp_identity');assert.equal(rows[3].reason,'mhelp_equipment_not_found');
});
test('service membership qualifies addresses, billing records do not; identical reads reuse only safe data',async()=>{
 const calls=[];const read=async path=>{calls.push(path);if(path.includes('servicelocations'))return {totalRows:1,results:[{customerId:'3',portalId:'224643',name:'Job',address1:'123 Main St',city:'Houston',state:'TX',zip:'77002',countryId:'US',latitude:29.76,longitude:-95.37}]};return {customerId:'2',portalId:'224643',name:'Synthetic builder',isServiceLocation:false,address1:'Private billing address'};};
 const reader=createFleetLocationReader(read,async()=>{throw Error('Unexpected geocoder');});const row={customerId:'2',serviceLocationId:'3'};
 const a=await reader(row,null),b=await reader(row,null);assert.deepEqual(a,b);assert.equal(calls.length,2);assert.equal(a.address,location.address);assert(!JSON.stringify(a).includes('billing'));
 await assert.rejects(reader({customerId:'2',serviceLocationId:'4'},null),/membership/);
});
test('the same current service evidence populates field details and unverified pins while Shop clears active locations',async()=>{
 const snapshot={items:[],inventoryItems:[{id,unitNumber:'Helios 010',status:'available',address:'Old address',latitude:30,longitude:-95}],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0}};
 const receipt={contract:'COS_MHELP_FLEET_LOCATIONS_V1',items:[{...location,unitId:id,unitNumber:'Helios 010',observedAt:at,guardCurrent:true}],lastSuccessAt:at};
 const result=projectMhelpFleetLocations(snapshot,receipt,now);assert.equal(result.items.length,1);assert.equal(result.items[0].address,location.address);assert.equal(result.items[0].latitude,null);assert.equal(result.items[0].historicalLatitude,30);
 const point=await checkedAddressEstimate(result.items[0],now);assert.equal(point.confidence,'mhelp_service_unverified');assert.equal(point.latitude,29.76);
 const shop=projectMhelpFleetLocations(snapshot,{...receipt,items:[{...receipt.items[0],placement:'SHOP',customer:'Cameras Onsite',site:'Shop / ROOT',address:null,point:null,coordinateSource:null}]},now);assert.equal(shop.items.length,0);assert.equal(shop.inventoryItems[0].placement,'SHOP');
 const stale=projectMhelpFleetLocations(snapshot,{...receipt,items:[{...receipt.items[0],observedAt:'2026-10-12T16:00:00Z'}]},now);assert.equal(stale.items.length,0);assert(stale.inventoryItems[0].mhelpLocationReviewReason);
 for(const protectedValue of [{hasUnitGps:true},{placementSource:'owner'},{installedSiteId:id},{placementAuditId:'1'}]){const guarded=projectMhelpFleetLocations({...snapshot,inventoryItems:[{...snapshot.inventoryItems[0],...protectedValue}]},receipt,now);assert.equal(guarded.inventoryItems[0].address,'Old address');assert.equal(guarded.inventoryItems[0].mhelpLocation.address,location.address);}
 assert.equal(snapshot.inventoryItems[0].address,'Old address');
});
test('database receipts protect source guards, retain last good evidence and deny public access without changing inventory',async()=>{
 const db=new PGlite();try{await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(schema);await db.exec(await readFile(new URL('../db/20261012173408_cos_mhelp_placement_sync.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../db/20261012215500_cos_mhelp_fleet_locations.sql',import.meta.url),'utf8'));
 await db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'Helios 010','available')",[id,org]);
 const before=(await db.query('select to_jsonb(u) value from public.equipment_units u')).rows;
 const target=(await db.query('select public.cos_mhelp_location_target($1,$2,$1) value',[id,org])).rows[0].value;
 await db.query('select public.cos_mhelp_location_record($1,$2,$1,$3,$4)',[id,org,target.guard,location]);
 let snap=(await db.query('select public.cos_mhelp_location_snapshot($1,$2) value',[id,org])).rows[0].value;assert.equal(snap.items[0].guardCurrent,true);assert.equal(snap.items[0].address,location.address);
 await db.query('select public.cos_mhelp_location_record($1,$2,$1,$3,$4)',[id,org,target.guard,{state:'held',reason:'mhelp_location_read_unavailable'}]);assert.equal((await db.query('select last_good->>\'address\' value from cos_mhelp_placement_private.locations')).rows[0].value,location.address);
 assert.deepEqual((await db.query('select to_jsonb(u) value from public.equipment_units u')).rows,before);
 await db.exec("update public.equipment_units set unit_number='Helios 011'");await assert.rejects(db.query('select public.cos_mhelp_location_record($1,$2,$1,$3,$4)',[id,org,target.guard,location]),/changed/);
 snap=(await db.query('select public.cos_mhelp_location_snapshot($1,$2) value',[id,org])).rows[0].value;assert.equal(snap.items[0].guardCurrent,false);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select public.cos_mhelp_location_candidates()'));await assert.rejects(db.query('select * from cos_mhelp_placement_private.locations'));await db.exec('reset role');}
 }finally{await db.close();}
});
