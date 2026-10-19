import test from 'node:test';
import assert from 'node:assert/strict';
import {mhelpProviderFamily,mhelpProviderFleet} from '../src/mhelpProviderFleet.ts';

const now=Date.parse('2026-10-19T16:00:00Z');
const rows=[
 ['Solar Spotter 001','Solar Spotter','FIELD'],
 ['Spotter 002','Spotter HDC2','FIELD'],
 ['Ranger 003','RANGER 1 CAM.','FIELD'],
 ['Sniper 148','Sniper 2','FIELD'],
 ['Recon II 005','Recon II','FIELD'],
 ['WA 100','Wall-E','FIELD'],
 ['ST 001','Stand','FIELD'],
 ['Sniper 137','Sniper 2','SHOP']
];
function fixture(){
 const records=rows.map(([unitNumber,category,placement],i)=>({
  productId:String(2000000+i),recordId:'mhelp_product:'+(2000000+i),
  unitNumber,category,placement,customer:placement==='SHOP'?'Cameras OnSite':'Customer '+i,
  uploadLifecycle:'UNFLAGGED'
 }));
 return {contract:'COS_MHELP_UPLOAD_INVENTORY_V1',
  countBasis:'mhelp_product_records_not_unique_physical_units',source:'owner_supplied_mhelp_export',
  sourceSha256:'a'.repeat(64),receivedAt:new Date(now).toISOString(),
  summary:{totalRecords:8,fieldRecords:7,shopRecords:1,unflaggedFieldRecords:7,doNotUseRecords:0,missingRecords:0},
  records};
}
const fieldStates=['online','offline','unverified','online','offline','unlinked','support'];
const health=()=>{
 const f=fixture();return {total:7,items:f.records.filter(x=>x.placement==='FIELD').map((x,i)=>({
  productId:x.productId,unitNumber:x.unitNumber,state:fieldStates[i],
  reason:'Saved observation for '+x.unitNumber,unitId:i<5?'00000000-0000-0000-0000-000000000001':null,recordId:null
 }))};
};
test('mHelp categories classify expected provider families without treating placement as online',()=>{
 assert.equal(mhelpProviderFamily('Spotter HDC2','Spotter 004'),'star4live');
 assert.equal(mhelpProviderFamily('Solar Spotter','Solar Spotter 001'),'star4live');
 assert.equal(mhelpProviderFamily('RANGER 1 CAM.','Ranger 003'),'star4live');
 assert.equal(mhelpProviderFamily('Helios Solar Tower','Helios 001'),'star4live');
 assert.equal(mhelpProviderFamily('Sniper ES','Sniper 148'),'avigilon');
 assert.equal(mhelpProviderFamily('Sniper 4','Sniper 4 100'),'avigilon');
 assert.equal(mhelpProviderFamily('CAM-V','CAMV 014'),'avigilon');
 assert.equal(mhelpProviderFamily('RSU','RSU 002'),'avigilon');
 assert.equal(mhelpProviderFamily('Recon II','Recon II 005'),'reconeyez');
 assert.equal(mhelpProviderFamily('Wall-E','WA 100'),'walle');
 assert.equal(mhelpProviderFamily('Solar Stand 72','ST 001'),'support');
 assert.equal(mhelpProviderFamily('Solar Pole 72','Solar Pole 001'),'support');
});
test('each Field Product ID appears in exactly one provider group and health counts sum',()=>{
 const result=mhelpProviderFleet(fixture(),health(),true,now);
 assert.ok(result?.healthVerified);
 assert.equal(result.total,7);
 assert.deepEqual(result.groups.map(g=>[g.provider,g.count]),[
  ['star4live',3],['avigilon',1],['reconeyez',1],['walle',1],['support',1],['other',0]]);
 assert.deepEqual(result.groups[0].counts,{online:1,offline:1,unverified:1,not_applicable:0});
 assert.deepEqual(result.groups[1].counts,{online:1,offline:0,unverified:0,not_applicable:0});
 assert.deepEqual(result.groups[4].counts,{online:0,offline:0,unverified:0,not_applicable:1});
 assert.equal(new Set(result.groups.flatMap(g=>g.items.map(i=>i.productId))).size,7);
});
test('failed health read never marks a Field product Offline or Online, support stays N/A',()=>{
 const result=mhelpProviderFleet(fixture(),health(),false,now);
 assert.equal(result?.healthVerified,false);
 assert.equal(result?.groups[0].counts.unverified,3);
 assert.equal(result?.groups[1].counts.unverified,1);
 assert.equal(result?.groups[4].counts.not_applicable,1);
 assert.equal(result?.groups.flatMap(g=>g.items).filter(i=>i.healthStatus==='offline').length,0);
});
test('partial or mismatched health Product IDs are rejected instead of fabricating status',()=>{
 const source=fixture(),saved=health();
 saved.items[0].productId='9999999';
 const result=mhelpProviderFleet(source,saved,true,now);
 assert.equal(result?.healthVerified,false);
 assert.equal(result?.groups[0].counts.unverified,3);
});
