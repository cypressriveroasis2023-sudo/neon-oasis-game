import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFleetCommandCenter} from '../src/fleetCommandCenterModel.ts';

const now=Date.parse('2026-10-19T18:30:00Z'),time=new Date(now).toISOString();
const tuples=[
 ['Spotter 001','Spotter','FIELD','online'],
 ['Sniper 002','Sniper 2','FIELD','offline'],
 ['Recon II 005','Recon II','FIELD','unverified'],
 ['Helios 003','Helios','FIELD','unverified'],
 ['ST 001','Stand','FIELD','support'],
 ['WA 003','Wall-E','FIELD','unlinked'],
 ['Ranger 001','Ranger','FIELD','online'],
 ['Sniper 999','Sniper 4','SHOP','unverified'],
];
const productId=i=>String(2000000+i);
function fixture(){
 const records=tuples.map(([unitNumber,category,placement],i)=>({
  productId:productId(i),recordId:'mhelp_product:'+productId(i),unitNumber,category,placement,
  customer:placement==='SHOP'?'Cameras Onsite':'Customer '+i,uploadLifecycle:'UNFLAGGED',
  sourceAddress:{street:(i+1)+' Example Road',city:'Houston',state:'TX',zip:'77001'},
 }));
 return {contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',
  source:'owner_supplied_mhelp_export',sourceSha256:'b'.repeat(64),receivedAt:time,summary:{
   totalRecords:8,fieldRecords:7,shopRecords:1,unflaggedFieldRecords:7,doNotUseRecords:0,missingRecords:0},records};
}
const saved=()=>({total:7,items:tuples.slice(0,7).map(([unitNumber,, ,state],i)=>({
 productId:productId(i),unitNumber,state,
 evidence:{association:'synthetic-reviewed-association',basis:'camera',observations:[{kind:'camera',observedAt:time,currentState:state}]},
 reason:'Verified synthetic observation',unitId:i===3?'11111111-1111-1111-1111-111111111111':null,recordId:null
}))});
function addressMap(){
 const f=fixture(),field=f.records.filter(p=>p.placement==='FIELD');
 const common=p=>({id:'mhelp_product:'+p.productId,productId:p.productId,
  unitNumber:p.unitNumber,customer:p.customer,category:p.category,
  address:p.sourceAddress.street+', Houston TX',lifecycle:'UNFLAGGED',placementHeld:false});
 return {sourceSha256:f.sourceSha256,payloadSha256:'c'.repeat(64),totalField:7,matched:5,addressReview:0,unlocated:2,
  pins:field.slice(0,5).map(p=>({...common(p),state:'matched',point:[29,-95],
   matchedAddress:'Houston TX',provider:'us_census_address_range',geocodedAt:time,lookupAddress:'',verified:false,liveGps:false})),
  reviews:field.slice(5).map(p=>({...common(p),state:'no_match',reason:'Address requires lookup'}))};
}
test('counts all Field Product IDs once, preserves Shop and support separate from camera health',()=>{
 const data=buildFleetCommandCenter(fixture(),saved(),true,[],addressMap(),null,now,time);
 assert.ok(data);assert.equal(data.field,7);assert.equal(data.shop,1);assert.equal(data.total,8);
 assert.equal(data.items.length,7);assert.equal(new Set(data.items.map(p=>p.productId)).size,7);
 assert.deepEqual(data.counts,{online:2,offline:1,unverified:3,support:1,attention:5,unmapped:2});
 assert.equal(data.panels.find(p=>p.key==='star4live')?.count,3);
 assert.equal(data.panels.find(p=>p.key==='avigilon')?.count,1);
 assert.equal(data.panels.find(p=>p.key==='reconeyez')?.count,1);
 assert.equal(data.panels.find(p=>p.key==='victron')?.count,null);
 assert.equal(data.items.filter(p=>p.mappingIssue).length,2);
 assert.ok(data.items.find(p=>p.unitNumber==='Spotter 001')?.address.includes('1 Example Road'));
});
test('failed camera health never fabricates online or offline devices, retaining all Field records',()=>{
 const data=buildFleetCommandCenter(fixture(),saved(),false,[],null,null,now,time);
 assert.ok(data);assert.equal(data.healthVerified,false);
 assert.equal(data.counts.online,0);assert.equal(data.counts.offline,0);
 assert.equal(data.counts.unverified,6);assert.equal(data.counts.support,1);
 assert.equal(data.addressCoverage,null);assert.equal(data.field,7);
});
test('a mismatched address map is not misrepresented as current coverage',()=>{
 const map=addressMap();map.sourceSha256='d'.repeat(64);
 const data=buildFleetCommandCenter(fixture(),saved(),true,[],map,null,now,time);
 assert.ok(data);assert.equal(data.addressCoverage,null);
 assert.ok(data.items.every(p=>!p.mappingIssue));
});
test('Victron is an overlapping Helios support system; current telemetry is not a battery outage',()=>{
 const uid='11111111-1111-1111-1111-111111111111';
 const vrm={items:[{name:'Helios 003',installationId:1000099,
   portalUrl:'https://vrm.victronenergy.com/installation/1000099/dashboard',embedUrl:null}],
   sync:{state:'current',lastAttemptAt:time,lastSuccessAt:time,nextSyncAt:null,
    error:null,scheduleActive:true,connectionConfigured:true}};
 const rows=[{id:uid,power:{installationId:1000099,name:'Helios 003',errorCode:null,
   lastAttemptAt:time,measurements:[{metric:'battery_soc',value:12,unit:'%',source:'battery',instance:0,observedAt:time}]}}];
 const data=buildFleetCommandCenter(fixture(),saved(),true,rows,null,vrm,now,time);
 const panel=data?.panels.find(p=>p.key==='victron');
 assert.ok(panel);assert.equal(panel.count,1);
 assert.deepEqual(panel.counts,{online:1,offline:0,unverified:0,not_applicable:0});
 assert.equal(data.field,7);assert.equal(data.counts.offline,1);
});
test('source count discrepancy cannot be normalized into an invented 287 record summary',()=>{
 const f=fixture();f.records.pop();
 assert.equal(buildFleetCommandCenter(f,saved(),true,[],null,null,now,time),null);
});
