// Synthetic IDs, reviewed tuples, source records and addresses only.
import {identityDigest,nativeIdentityKey,nativeIdentityTuple,healthResourceKey,healthSourceUnitKey,verifiedHealthIdentities} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
export const key='SPOTTER 987654',label='Spotter987654HDC2';
export const unitId='11111111-1111-4111-8111-111111111111',controlId='22222222-2222-4222-8222-222222222222',historyId='33333333-3333-4333-8333-333333333333';
export const stamp='2026-10-08T11:00:00.000Z',address='100 Synthetic Fixture Rd, Testville, TX 77001';
export const row=(patch={})=>({id:unitId,unitNumber:label,readOnly:false,_sourceField:true,recordSource:'Native equipment',status:'installed',currentLocationType:'site',installedSiteId:'44444444-4444-4444-8444-444444444444',activeJobNumber:null,site:'Synthetic site',address,addressSource:'Current installation address',latitude:30,longitude:-95,coordinateSource:'unit',hasUnitGps:true,gpsRecordedAt:stamp,locationVerification:'owner_verified',locationVerifiedAt:stamp,locationHistoryId:historyId,historicalLatitude:30,historicalLongitude:-95,historicalCoordinateSource:'unit',historicalRecordedAt:stamp,...patch});
export const snapshot=(rows=[row()])=>({items:rows.filter(r=>r._sourceField),inventoryItems:rows,summary:{fieldUnits:rows.filter(r=>r._sourceField).length},generatedAt:stamp});
export const audit=(patch={})=>({id:'100',unit_key:key,device_ids:['9101'],contract:'COS_CAMERA_PLACEMENT_V2',control_id:controlId,request_id:'55555555-5555-4555-8555-555555555555',placement:'FIELD',action:'MOVE_TO_FIELD',site_label:'Synthetic new site',street_address:'200 Synthetic Fixture Rd, Testville, TX 77002',created_at:'2026-10-08T12:00:00.000Z',...patch});
export async function fixture(unitLabel=label){
 const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 const unit={id:unitId,unit_number:unitLabel,organization_id:org};
 const provider={id:'66666666-6666-4666-8666-666666666666',organization_id:org,source:'vigilant_control_center',external_device_id:'synthetic-external-9101',device_name:'Synthetic fixture camera',device_type:'IPC'};
 const match={id:'77777777-7777-4777-8777-777777777777',organization_id:org,equipment_unit_id:unitId,vigilant_device_id:provider.id,camera_key:'cam1',match_method:'reviewed_fixture',confidence:'exact'};
 const device={id:9101,unit_key:key,source:provider.source,device_type:'IPC',external_device_id:provider.external_device_id,device_serial:'synthetic-serial-9101',organization:'Synthetic site',source_status:'offline',activation_state:'active'};
 const hash=await nativeIdentityKey(unitId),proof=await identityDigest(nativeIdentityTuple(unit,[{match,provider,device}]));
 const sources={units:[unit],matches:[match],providers:[provider],devices:[device],audits:[]};
 const review={native:{[hash]:proof},owner:new Set(),nativeResources:{[hash]:{deviceIds:[await healthResourceKey('9101')],unitKeys:[await healthSourceUnitKey(key)]}},ownerResources:{},ownerPhysical:{}};
 return {sources,review,snapshot:snapshot([row({unitNumber:unitLabel})]),identity:()=>verifiedHealthIdentities(sources,review)};
}
