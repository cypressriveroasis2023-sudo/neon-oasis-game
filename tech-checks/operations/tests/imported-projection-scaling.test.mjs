import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectImportedSourceAddresses,projectImportedGeocodes} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
const sha='a'.repeat(64),uuid=i=>'11111111-1111-4111-8111-'+String(i).padStart(12,'0');
function fleet(size=400){
 let reads=0;
 const rows=Array.from({length:size},(_,i)=>({id:uuid(i+1),readOnly:true,unitNumber:'SNIPER '+(i+1),status:'field',currentLocationType:'field',_sourceField:true}));
 const sources=rows.map((r,i)=>({entityKind:'tracker',nativeUnitId:r.id,unitNumber:r.unitNumber,placement:'SHOP',sourceRevision:uuid(1000+i),productId:String(1000+i),eventId:String(i+1),nativeGuardSha256:sha,sourceFileSha256:sha,sourceRowSha256:sha}));
 const devices=rows.map((r,i)=>({id:i+1,get unit_key(){reads++;return r.unitNumber;}}));
 return {rows,sources,devices,reads:()=>reads};
}
test('fleet source presentation scans legacy labels per roster, not per unit, and fresh reads honor new audits',async()=>{
 const f=fleet(),snapshot={items:f.rows,inventoryItems:f.rows,summary:{}};
 const first=await projectImportedSourceAddresses(snapshot,f.sources,[],f.devices);
 assert.equal(first.items.length,0);assert.equal(first.inventoryItems.filter(r=>r.importedPlacement==='SHOP').length,400);
 assert.ok(f.reads()<=1200,'legacy label reads must stay linear in roster size');
 const audited={id:'1',unit_key:f.rows[0].unitNumber,action:'MOVE_TO_FIELD',contract:'COS_CAMERA_PLACEMENT_V2',device_ids:[1]};
 const second=await projectImportedSourceAddresses(snapshot,f.sources,[audited],f.devices);
 assert.deepEqual(second.inventoryItems[0],f.rows[0]);assert.equal(second.inventoryItems.filter(r=>r.importedPlacement==='SHOP').length,399);
});
test('both map collections share one legacy scan while every row keeps its own validation',async()=>{
 const f=fleet(),snapshot={items:f.rows,inventoryItems:f.rows,summary:{}};
 const shown=await projectImportedGeocodes(snapshot,[],[],f.devices);
 assert.deepEqual(shown,snapshot);assert.ok(f.reads()<=1200,'two collections must not multiply legacy label reads');
 f.devices[0].id=9999;
 const audited={id:'2',unit_key:'UNRELATED SYNTHETIC',action:'MOVE_TO_FIELD',device_ids:[9999]};
 const after=await projectImportedGeocodes(snapshot,[],[audited],f.devices);
 assert.deepEqual(after,snapshot);
});
