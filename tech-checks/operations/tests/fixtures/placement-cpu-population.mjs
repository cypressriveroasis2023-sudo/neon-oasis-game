export function fixture(count=1001){
 const audits=[],devices=[];
 for(let i=1;i<=count;i++){
  const key='RECON '+i,ids=Array.from({length:4},(_,j)=>String(i*4+j));
  devices.push(...ids.map(id=>({id,unit_key:key,public_ip:'192.0.2.1',source_status:i%2?'online':'offline'})));
  audits.push({id:String(i),unit_key:key,device_ids:ids,contract:'COS_CAMERA_PLACEMENT_V2',placement:i<=284?'FIELD':'SHOP',action:i<=284?'MOVE_TO_FIELD':'MOVE_TO_ROOT',site_label:'Fixture site',street_address:'1 Fixture Street',created_at:'2026-10-26T00:00:00Z',request_id:'00000000-0000-4000-8000-000000000001',control_id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0')});
 }
 return {audits,devices};
}
