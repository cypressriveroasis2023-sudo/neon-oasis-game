// Synthetic complete projection inputs; no production captures or credentials.
export const uuid=i=>'11111111-1111-4111-8111-'+String(i).padStart(12,'0');
export function aliasPopulation(count=434){
 const inventoryItems=Array.from({length:count},(_,i)=>({id:uuid(i+1),unitNumber:'Spotter'+(i+1)+'HDC2',readOnly:false,_sourceField:true,status:'installed',currentLocationType:'site',address:'100 Synthetic Rd',latitude:30,longitude:-95,hasUnitGps:true}));
 const devices=inventoryItems.flatMap((r,i)=>Array.from({length:4},(_,j)=>({id:String(i*4+j+1),unit_key:'SPOTTER '+(i+1)})));
 const identity={identityVersion:1,identityWarnings:[],unitIdentities:inventoryItems.map((r,i)=>({kind:'native_provider',unitId:r.id,unitNumber:r.unitNumber,unitKeys:['SPOTTER '+(i+1)],deviceIds:devices.slice(i*4,i*4+4).map(d=>d.id),proof:'a'.repeat(64)}))};
 return {snapshot:{items:inventoryItems,inventoryItems,summary:{fieldUnits:count}},audits:[],devices,identity,units:inventoryItems.map(r=>({id:r.id,unit_number:r.unitNumber}))};
}
export function markedAudit(i=0,patch={}){return {id:String(i+1),unit_key:'SPOTTER '+(i+1),device_ids:Array.from({length:4},(_,j)=>String(i*4+j+1)),contract:'COS_CAMERA_PLACEMENT_V2',control_id:uuid(50000+i),request_id:uuid(60000+i),placement:'FIELD',action:'MOVE_TO_FIELD',site_label:'Synthetic site',street_address:'200 Synthetic Rd',created_at:'2026-10-28T12:00:00Z',...patch};}
export const run=(fn,f)=>fn(f.snapshot,f.audits,f.devices,f.identity,f.units);
