import {createHash} from 'node:crypto';
// Synthetic public DTOs only. Hashes are derived from test strings, never production uploads.
const sha=value=>createHash('sha256').update(value).digest('hex');
export const sourceReceipt={sourceSha256:sha('synthetic source-equipment export'),payloadSha256:sha('synthetic source-equipment reviewed payload')};
export function sourceEquipmentRecord(productId='910001',patch={}){
 const id='mhelp_product:'+productId;
 return {id,kind:'source_equipment',unitId:null,unit:null,unitNumber:'Ranger 901',placement:'field',lifecycle:'active',active:true,source:'owner_supplied_mhelp_export',observedAt:'2026-10-06T17:45:00Z',productIds:[productId],sourceRecordIds:[id],representedUnitIds:[],customer:'Synthetic source customer',sourceAddress:{street:'100 Example Road',city:'Test City',state:'TX',zip:'77001'},reviewReason:null,family:'RANGER',category:'Synthetic equipment',...patch};
}
export function sourceEquipmentEstimate(record,patch={}){
 const a=record.sourceAddress,address=[a.street,a.city,[a.state,a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
 return {contract:'COS_SOURCE_EQUIPMENT_ADDRESS_ESTIMATE_V1',recordId:record.id,productId:record.productIds[0],unitNumber:record.unitNumber,customer:record.customer,...sourceReceipt,sourceAddress:{...a},receiptId:'00000000-0000-4000-8000-'+record.productIds[0].padStart(12,'0'),uploadRecordSha256:sha(JSON.stringify({syntheticReviewedRecord:true,productId:record.productIds[0],unitNumber:record.unitNumber,customer:record.customer,sourceAddress:a})),address,addressSha256:sha(address.trim().replace(/\s+/g,' ').toLowerCase()),latitude:30,longitude:-95,matchedAddress:'100 EXAMPLE RD, TEST CITY, TX, 77001',geocodedAt:'2026-10-06T17:50:00Z',provider:'geocodio',confidence:'automatic_address_estimate',accuracyType:'rooftop',accuracy:1,matchType:null,benchmark:null,verified:false,liveGps:false,...patch};
}
export const sourceEquipmentEnvelope=items=>({contract:'COS_SOURCE_EQUIPMENT_ESTIMATES_V1',...sourceReceipt,items});
export function combinedSourcePinFixture(field){
 const result=structuredClone(field),records=[sourceEquipmentRecord(),sourceEquipmentRecord('910002',{unitNumber:'Solar Stand 902',family:'Stand',category:'Solar stand'}),sourceEquipmentRecord('910003',{unitNumber:'Ranger 903'}),sourceEquipmentRecord('910004',{unitNumber:'Ranger 904',placement:'shop'}),sourceEquipmentRecord('910005',{unitNumber:'Ranger 905',active:false,lifecycle:'do_not_use'}),sourceEquipmentRecord('910006',{unitNumber:'Ranger 906',kind:'identity_review',placement:'unknown',reviewReason:'Synthetic identity hold'})];
 const linked=result.inventoryItems.map(unit=>({id:'cos_unit:'+unit.id,kind:'unit',unitId:unit.id,unit,unitNumber:unit.unitNumber,placement:unit.currentLocationType,lifecycle:'active',active:true,source:'owner',observedAt:'2026-10-06T17:45:00Z',productIds:[],sourceRecordIds:[],representedUnitIds:[unit.id],customer:unit.customer||null,sourceAddress:null,reviewReason:null}));
 const items=[...linked,...records],active=items.filter(r=>r.active);
 result.fleetRoster={contract:'COS_COMBINED_FLEET_ROSTER_V1',items,summary:{totalRecords:items.length,activeRecords:active.length,field:active.filter(r=>r.placement==='field').length,shop:active.filter(r=>r.placement==='shop').length,review:active.filter(r=>r.placement==='unknown').length,excludedLifecycle:items.length-active.length,sourceOnlyRecords:records.length,linkedUnitRecords:linked.length},countBasis:'equipment_records_with_reviewed_cross_source_links',physicalDeduplication:'incomplete'};
 result.uploadInventory={...sourceReceipt};result.sourceEquipmentEstimates=sourceEquipmentEnvelope(records.filter(r=>r.productIds[0]!=='910003').map(r=>sourceEquipmentEstimate(r)));
 return result;
}
