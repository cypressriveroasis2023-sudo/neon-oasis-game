import {identityDigest,nativeIdentityKey,nativeIdentityTuple,healthResourceKey,healthSourceUnitKey} from '../../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
import {TRACKER_CONNECTION_CENSUS_V2,TRACKER_IP_WORKBOOK} from '../../src/exactProductConnection.ts';
export const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export async function productSource({channels=4,now=Date.now(),family='Solar Spotter'}={}){
 const at=new Date(now-1000).toISOString(),sha='a'.repeat(64),unit={id:uuid(1),organization_id:org,unit_number:'Synthetic exact unit',status:'available'};
 const source={complete:true,verifiedAt:new Date(now).toISOString(),upload:{contract:'COS_MHELP_API_V1',reviewed:true,origin:'mhelpdesk_api',portalId:'224643',complete:true,recordCount:2,apiMissingRecords:[],apiSync:{lastSuccessAt:at},sourceSha256:sha,payloadSha256:'b'.repeat(64),receivedAt:at,receivedAtPrecision:'second',exportAsOf:null,
 records:[{productId:'101',unitNumber:unit.unit_number,category:family,customerId:'12',customer:'Synthetic customer',placement:'FIELD',lifecycle:'UNFLAGGED',sourceAddress:{street:'Synthetic'},sourceRow:2,
 binding:{productId:'101',trackerId:null,trackerLabel:null,nativeUnitId:unit.id,nativeLabel:unit.unit_number,fullLabel:unit.unit_number,matchMethod:'reviewed_product_id',evidenceSha256:'c'.repeat(64),expectedGuard:'d'.repeat(64),guardCurrent:true}},
 {productId:'102',unitNumber:'Synthetic support',category:'Support',customerId:'11',customer:'Company',placement:'SHOP',lifecycle:'UNFLAGGED',sourceAddress:{},sourceRow:3,binding:null}]},
 map:{items:[{id:unit.id,unitNumber:unit.unit_number,placement:'FIELD'}],inventoryItems:[{id:unit.id,unitNumber:unit.unit_number,placement:'FIELD',currentLocationType:'field'}]},
 tracker:{contract:TRACKER_CONNECTION_CENSUS_V2,workbookId:TRACKER_IP_WORKBOOK,expectedMhelpSourceSha256:sha,trackerSourceSha256:'e'.repeat(64),sourceExport:'ServiceItem_List_20261028183000.csv',verifiedAt:new Date(now).toISOString(),records:[{productId:'101',recordId:'mhelp_product:101',placement:'FIELD',publicIp:[11,22,33,44].join('.'),sourceRow:2,reviewReasons:[]},{productId:'102',recordId:'mhelp_product:102',placement:'SHOP',publicIp:null,sourceRow:3,reviewReasons:[]}]},
 identitySources:{units:[unit],devices:[],matches:[],providers:[],audits:[],ownerCrosswalk:{revision:'f'.repeat(64),claims:[],nativeEpochs:[]},ownerEpochs:[]}};
 const associations=[];
 for(let i=1;i<=channels;i++){
  const provider={id:uuid(100+i),organization_id:org,external_device_id:'synthetic-external-'+i,device_name:'Synthetic camera '+i,device_type:channels>1?'IPC':'NVR',source:'vigilant_control_center'};
  const match={id:uuid(200+i),organization_id:org,equipment_unit_id:unit.id,vigilant_device_id:provider.id,camera_key:'cam'+i,match_method:'normalized_device_name',confidence:'exact'};
  const device={id:i,external_device_id:provider.external_device_id,device_serial:'synthetic-serial-'+i,device_name:provider.device_name,device_type:provider.device_type,unit_key:'Synthetic group',organization:'Synthetic',source:provider.source,activation_state:'active',public_ip:source.tracker.records[0].publicIp,expected_ports:[80,443],connection_revision:0,monitoring_enabled:true,monitoring_profile:({'Solar Spotter':'solar_spotter',Spotter:'spotter',Ranger:'ranger'})[family]};
  source.identitySources.providers.push(provider);source.identitySources.matches.push(match);source.identitySources.devices.push(device);associations.push({provider,match,device});
 }
 source.identitySources.ownerEpochs=[{unitKey:'Synthetic group',epoch:'6'.repeat(64),deviceIds:source.identitySources.devices.map(d=>String(d.id))}];
 const key=await nativeIdentityKey(unit.id),proof=await identityDigest(nativeIdentityTuple(unit,associations));
 const review={native:{[key]:proof},nativeResources:{[key]:{deviceIds:await Promise.all(associations.map(({device})=>healthResourceKey(String(device.id)))),unitKeys:[await healthSourceUnitKey('Synthetic group')]}},owner:new Set(),ownerResources:{},ownerPhysical:{}};
 return {source,review,now};
}
export const positive={online:true,attempted:true,latency_ms:1};
export const negative={online:false,attempted:true,latency_ms:null,error:'timeout'};
