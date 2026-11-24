export const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',unitId='11111111-1111-4111-8111-111111111111',unitKey='SYNTHETIC GROUP',now=Date.parse('2026-10-26T00:00:00Z');
export function mappedFixture(){
 const sources={units:[{id:unitId,organization_id:org,unit_number:'Synthetic unit',status:'available'}],matches:[],providers:[],devices:[],audits:[],ownerCrosswalk:{revision:'a'.repeat(64),claims:[],nativeEpochs:[{unitId,epoch:'b'.repeat(64)}]},ownerEpochs:[{unitKey,epoch:'c'.repeat(64),deviceIds:['1','2','3','4']}]};
 for(let i=1;i<=4;i++){
  const provider={id:`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`,organization_id:org,external_device_id:`synthetic-external-${i}`,device_name:`Synthetic resource ${i}`,device_type:'IPC',source:'vigilant_control_center'};
  sources.providers.push(provider);
  sources.matches.push({id:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,organization_id:org,equipment_unit_id:unitId,vigilant_device_id:provider.id,camera_key:`cam${i}`,match_method:'existing_mapping',confidence:'exact'});
  sources.devices.push({id:i,external_device_id:provider.external_device_id,device_serial:`synthetic-serial-${i}`,device_type:'IPC',source:provider.source,unit_key:unitKey,source_status:'online',source_last_seen_at:'2026-10-25T23:59:00Z'});
 }
 const upload={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:'d'.repeat(64),payloadSha256:'e'.repeat(64),receivedAt:'2026-10-25T23:00:00Z',receivedAtPrecision:'second',exportAsOf:null,records:[{productId:'101',unitNumber:'Synthetic product',category:'Camera',customerId:'12',customer:'Synthetic customer',placement:'FIELD',lifecycle:'UNFLAGGED',sourceAddress:{},sourceRow:2,holdReason:null,binding:{productId:'101',nativeUnitId:unitId,trackerId:null,nativeLabel:'Synthetic unit',trackerLabel:null,fullLabel:'Synthetic product',matchMethod:'reviewed_product_id',evidenceSha256:'f'.repeat(64),expectedGuard:'0'.repeat(64),guardCurrent:true}}]};
 return {sources,upload};
}
