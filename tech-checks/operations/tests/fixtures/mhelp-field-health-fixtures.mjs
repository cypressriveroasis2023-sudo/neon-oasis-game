import {resource,snapshot,now,fresh,withStatus} from './camera-evidence-fixtures.mjs';
import {fleetDashboardRows} from '../../src/fleetDashboardModel.ts';
export function fieldProductFixture(){
 const units=[['Helios 1','Helios'],['Spotter 1','Spotter'],['Spotter 2','Spotter'],['ST 001','STANDS']].map(([unitNumber,modelName],i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,unitNumber,modelName,currentLocationType:'field',placement:'FIELD',status:'field',activeInventoryEligible:true,readOnly:false,site:'Synthetic job',customer:'Synthetic customer',address:'100 Synthetic Road',latitude:null,longitude:null,locationVerification:'address_only'}));
 const health=snapshot([resource(1,'Helios 1'),withStatus(resource(2,'Spotter 1'),'offline'),resource(3,'Spotter 2',{evidence:{...resource(3).evidence,observedAt:'2026-10-01T00:00:00Z'}})]);
 // Positives require the same additive durable identity contract as production.
 Object.assign(health,{identityVersion:1,unitIdentities:units.slice(0,3).map((unit,i)=>({unitId:unit.id,unitNumber:unit.unitNumber,kind:'native_provider',deviceIds:[String(i+1)],unitKeys:[unit.unitNumber],proof:'a'.repeat(64)})),identityWarnings:[]});
 const records=[...units.map((unit,i)=>({recordId:'mhelp_product:'+String(1001+i),productId:String(1001+i),unitNumber:unit.unitNumber,category:unit.modelName,placement:'FIELD',uploadLifecycle:'UNFLAGGED',binding:{state:'linked',unitIds:[unit.id],candidateUnitIds:[],placementHeld:false}})),...['FIELD','FIELD','FIELD','SHOP'].map((placement,i)=>({recordId:'mhelp_product:'+String(1005+i),productId:String(1005+i),unitNumber:'Ranger '+(901+i),category:'Ranger',placement,uploadLifecycle:i===2?'DO_NOT_USE':'UNFLAGGED',binding:{state:i===1?'held':'unlinked',unitIds:[],candidateUnitIds:[],placementHeld:i===1}}))];
 const upload={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',sourceSha256:'a'.repeat(64),receivedAt:fresh,records,summary:{totalRecords:8,fieldRecords:7,shopRecords:1,unflaggedFieldRecords:6,unflaggedShopRecords:1,doNotUseRecords:1,missingRecords:0}};
 const items=records.map((product,i)=>({id:i<4?'cos_unit:'+units[i].id:product.recordId,kind:i<4?'unit':i===5?'identity_review':'source_equipment',unitId:i<4?units[i].id:null,unit:i<4?units[i]:null,unitNumber:product.unitNumber,placement:i===5?'unknown':product.placement.toLowerCase(),lifecycle:i===6?'do_not_use':'active',active:i!==6,source:'owner_supplied_mhelp_export',observedAt:fresh,productIds:[product.productId],sourceRecordIds:[product.recordId],representedUnitIds:i<4?[units[i].id]:[],customer:'Synthetic customer',sourceAddress:null,reviewReason:i===5?'Protected identity hold.':null,...(i===5?{recordedSourcePlacement:'field'}:{})}));
 const roster={contract:'COS_COMBINED_FLEET_ROSTER_V1',countBasis:'equipment_records_with_reviewed_cross_source_links',physicalDeduplication:'incomplete',items,summary:{totalRecords:8,activeRecords:7,field:5,shop:1,review:1,excludedLifecycle:1,sourceOnlyRecords:4,linkedUnitRecords:4}};
 const field={items:units,inventoryItems:units,summary:{fieldUnits:4,mappedUnits:0,unitGps:0,missingGps:4},generatedAt:fresh,uploadInventory:upload,fleetRoster:roster};
 return {units,health,upload,roster,field,connections:fieldProductConnectionFixture(upload,fresh),rows:fleetDashboardRows(units,health,[],null,now),now,fresh};
}

/** Explicit synthetic saved TCP observations, not a projection from provider
 * labels, health or names. Tests opt into this independently mocked endpoint. */
export function fieldProductConnectionFixture(upload,observedAt=fresh,states={'1001':'online','1002':'offline'}){
 return {contract:'COS_EXACT_PRODUCT_CONNECTIONS_V2',sourceSha256:upload.sourceSha256,trackerVerifiedAt:observedAt,
  items:upload.records.filter(r=>r.placement==='FIELD').map(p=>{
   const status=states[p.productId]||'unknown';
   return {productId:p.productId,status,basis:'tcp_service_port',
    checkedAt:status==='unknown'?null:observedAt,resourceId:status==='unknown'?null:String(9000+Number(p.productId)),
    reason:status==='unknown'?'No fresh completed synthetic TCP check.':'Completed synthetic saved TCP/service-port check; video not verified.'};
  })};
}
