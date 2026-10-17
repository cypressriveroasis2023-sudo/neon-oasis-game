export const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',actor='05bf20fe-19f7-4db7-ac05-5b2a5f681fdf',native='00000000-0000-4000-8000-000000000011',tracker='00000000-0000-4000-8000-000000000012',request='00000000-0000-4000-8000-000000000013';
export const now=Date.parse('2026-10-17T08:00:00Z'),at='2026-10-17T07:59:00Z',secret='12'.repeat(32);
export const context={legacyId:actor,actorId:null,department:'it',legacyOwner:false,fleetRead:true};
export const body={request_id:request,purpose:'checkout',items:[{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001'}]};
export function locationRead({time=now,who=actor,requestBody=body}={}){const observed=new Date(time-60000).toISOString();return {
 equipment:[{equipment_key:'sniper:001',canonical_family:'Sniper',unit_tag:'001',tracker_state:'shop',updated_at:observed}],audits:[],devices:[],
 attestation:{contract:'COS_TECHCHECK_SHOP_ATTESTATION_V1',organization_id:org,legacy_actor_id:who,request_id:requestBody.request_id,purpose:requestBody.purpose,checked_at:new Date(time).toISOString(),valid_until:new Date(time+30000).toISOString(),items:[{...requestBody.items[0],representation_id:native,representation_kind:'native',native_unit_id:native,tracker_id:tracker,placement:'SHOP',observed_at:observed,source_success_at:observed,authority_sha256:'a'.repeat(64)}]}
};}
export function ownerRoot(read=locationRead()){
 read.devices=[{id:1,unit_key:'SNIPER 001'}];
 read.audits=[{id:'1',unit_key:'SNIPER 001',device_ids:['1'],contract:'COS_CAMERA_PLACEMENT_V2',placement:'SHOP',action:'MOVE_TO_ROOT',created_at:at,request_id:request,control_id:native}];return read;
}
