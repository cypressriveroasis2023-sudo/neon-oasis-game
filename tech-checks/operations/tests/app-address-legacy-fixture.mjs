import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {projectAppUnitAddresses} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {addressDigest} from '../../supabase/functions/cos-operations-pages/censusAddress.ts';
const id='11111111-1111-4111-8111-111111111111',control='22222222-2222-4222-8222-222222222222',revision='33333333-3333-4333-8333-333333333333',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export async function appLegacyFixture(placement='INACTIVE',ownerClaim=false,version=1){
 const key='RANGER 001',proof={contract:'COS_APP_UNIT_ADDRESS_V1',legacyUnitKey:key,legacyIdentitySha256:'a'.repeat(64),legacyPlacementSha256:'b'.repeat(64)};
 const authority={...proof,revision},installation=placement==='FIELD'?{street:'123 App St',city:'Houston',state:'TX',zip:'77002'}:null;
 const source={schemaVersion:version,organizationId:org,sourceSystem:version===1?'mhelpdesk_product_import':'google_sheet_tracker',entityKind:'tracker',nativeUnitId:id,...(version===1?{productId:'901'}:{sourceRecordId:'google_sheet:synthetic_sheet_123:12:RANGER|001'}),unitNumber:'Ranger 001',family:'RANGER',variant:null,sourceRevision:revision,eventId:'9',sourceFileSha256:'c'.repeat(64),sourceRowSha256:'d'.repeat(64),nativeGuardSha256:'e'.repeat(64),addressSha256:installation?await addressDigest('123 App St, Houston, TX 77002'):null,installation,suppliedComponents:installation?{street:true,city:true,state:true,zip:true}:null,eligibility:installation?'FIELD':'tombstone',placement,siteLabel:installation?'New app site':null,customerLabel:'Current source customer',addressAuthority:authority};
 const raw={id,unitNumber:'Ranger 001',readOnly:true,modelName:'RANGER',_sourceField:true,status:'field',currentLocationType:'field',site:'Older source site',customer:'Historical customer',address:'10 Source St, Houston, TX 77002',hasUnitGps:false,latitude:null,longitude:null,coordinateSource:null,installedSiteId:null,locationVerification:'address_only'};
 const audit={id:'7',unit_key:key,device_ids:[11],action:'MOVE_TO_FIELD',contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD',request_id:revision,control_id:control,site_label:'Older Owner site',street_address:'777 Older St, Houston, TX 77002',created_at:'2026-10-08T00:00:00Z'};
 const devices=[{id:11,unit_key:key,organization:'Older Owner site',activation_source:'owner_location_override_v2',activation_state:'active'}];
 const identity={identityVersion:1,unitIdentities:ownerClaim?[{kind:'owner_placement',unitId:control,unitNumber:key,unitKeys:[key],deviceIds:['11'],placementAuditId:'7',proof:'f'.repeat(64)}]:[],identityWarnings:[]};
 const initial={items:[raw],inventoryItems:[raw],summary:{fieldUnits:1},generatedAt:new Date().toISOString()};
 const owner=await projectOwnerPlacement(initial,[audit],devices,identity,[]);
 const snapshot=await projectAppUnitAddresses(owner,[source],[audit],devices,{nativeUnits:[],identity,currentSources:[source],confirmedAppAddressBindings:[source]});
 const health={evidenceVersion:2,...identity,rows:[{id:11,unit:key,trackerOnly:false}]};
 const state={unitKey:key,placement:'FIELD',auditId:'7',siteLabel:audit.site_label,streetAddress:audit.street_address,canMove:true};
 return {snapshot,health,state,key,proof,devices};
}
