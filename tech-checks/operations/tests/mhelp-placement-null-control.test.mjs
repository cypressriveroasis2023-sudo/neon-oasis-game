import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMhelpFieldPlacement} from '../../supabase/functions/cos-operations-pages/mhelpPlacementProjection.ts';
const trackerId='00000000-0000-4000-8000-000000000051';
const nativeId='00000000-0000-4000-8000-000000000052';
const unrelatedId='00000000-0000-4000-8000-000000000999';
const now=Date.parse('2026-10-12T19:00:00Z');
const time=new Date(now).toISOString();
function fixture({state='held',placement='SHOP',native=false,age=0,rowPatch={}}={}){
 const row={id:native?nativeId:trackerId,unitNumber:'Solar Stand 72 051',readOnly:!native,status:'field',currentLocationType:'field',address:'Fixture installation',latitude:null,longitude:null,...rowPatch};
 const receipt={contract:'COS_MHELP_PLACEMENT_V1',enabled:true,lastSuccessAt:time,items:[{trackerId,nativeUnitId:native?nativeId:null,trackerLabel:row.unitNumber,nativeLabel:native?row.unitNumber:null,guardCurrent:true,state,placement:state==='confirmed'?placement:null,customerLabel:'Cameras Onsite',siteLabel:placement==='SHOP'?'SHOP':'Fixture field site',locationReview:false,observedAt:new Date(now-age).toISOString()}]};
 return {snapshot:{items:[row],inventoryItems:[row],summary:{fieldUnits:1,mappedUnits:0,missingGps:1,addressUnits:1}},receipt};
}
const audit=(control_id)=>({id:'999',unit_key:'UNRELATED 999',device_ids:[],control_id});
for(const state of ['held','confirmed'])for(const control of [null,undefined,'',unrelatedId])test(`${state} tracker placement ignores unrelated ${String(control)} control`,()=>{
 const f=fixture({state});const before=JSON.stringify(f);const out=projectMhelpFieldPlacement(f.snapshot,f.receipt,[audit(control)],undefined,now);
 assert.equal(out.items.length,0);assert.equal(out.inventoryItems[0].placement,state==='held'?'UNKNOWN':'SHOP');assert.equal(JSON.stringify(f),before);
});
for(const native of [false,true])test(`matching ${native?'native':'tracker'} UUID preserves manual authority`,()=>{
 const f=fixture({native});const out=projectMhelpFieldPlacement(f.snapshot,f.receipt,[audit(native?nativeId:trackerId)],undefined,now);
 assert.equal(out.items.length,1);assert.deepEqual(out.items[0],f.snapshot.items[0]);
});
test('an actual matching label still preserves manual authority',()=>{
 const f=fixture();const out=projectMhelpFieldPlacement(f.snapshot,f.receipt,[{...audit(null),unit_key:'Solar Stand 72 051'}],undefined,now);
 assert.equal(out.items.length,1);
});
test('verified native device history still preserves manual authority',()=>{
 const f=fixture({native:true});const identity={unitIdentities:[{unitId:nativeId,unitKeys:['OTHER SAVED ALIAS'],deviceIds:['17']}]};
 const out=projectMhelpFieldPlacement(f.snapshot,f.receipt,[{...audit(null),device_ids:['17']}],identity,now);assert.equal(out.items.length,1);
});
for(const rowPatch of [{placementSource:'owner'},{hasUnitGps:true},{installedSiteId:unrelatedId},{placementReviewReason:'Identity review required'}])test(`existing stronger row authority is unchanged: ${Object.keys(rowPatch)[0]}`,()=>{
 const f=fixture({rowPatch});const out=projectMhelpFieldPlacement(f.snapshot,f.receipt,[audit(null)],undefined,now);assert.equal(out.items.length,1);assert.deepEqual(out.items[0],f.snapshot.items[0]);
});
test('a stale confirmed tracker receipt holds rather than resurrecting old FIELD',()=>{
 const f=fixture({state:'confirmed',placement:'FIELD',age:41*60000});const out=projectMhelpFieldPlacement(f.snapshot,f.receipt,[audit(null)],undefined,now);assert.equal(out.items.length,0);assert.equal(out.inventoryItems[0].placement,'UNKNOWN');
});
test('current confirmed FIELD receipt remains available',()=>{
 const f=fixture({state:'confirmed',placement:'FIELD'});const out=projectMhelpFieldPlacement(f.snapshot,f.receipt,[audit(null)],undefined,now);assert.equal(out.items.length,1);assert.equal(out.items[0].placementSource,'mhelpdesk');
});
test('changed installation clears prior estimate eligibility without overwriting source input',()=>{
 const f=fixture({state:'confirmed',placement:'FIELD',rowPatch:{importedInstallation:{old:true},latitude:29,longitude:-95}});f.receipt.items[0].locationReview=true;
 const out=projectMhelpFieldPlacement(f.snapshot,f.receipt,[audit(null)],undefined,now);assert.equal(out.items.length,1);assert.equal(out.items[0].address,null);assert.equal(out.items[0].latitude,null);assert.equal(out.items[0].importedInstallation,null);assert.equal(f.snapshot.items[0].latitude,29);
});
