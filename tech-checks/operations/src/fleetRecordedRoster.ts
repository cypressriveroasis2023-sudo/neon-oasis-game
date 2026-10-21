import {recordedAddressText} from './fleetDisplayAddress';
import {canonicalCameraUnit} from './fieldCameraHealth';
import type {DashboardUnit,FleetFilters} from './fleetDashboardModel';
import {inventoryPlacement} from './fleetSnapshot';

export type RecordedEquipment={id:string;kind:'unit'|'source_equipment'|'identity_review';unitId:string|null;unit:DashboardUnit|null;unitNumber:string;placement:'field'|'shop'|'unknown';lifecycle:'active'|'do_not_use'|'missing'|'retired'|'decommissioned';active:boolean;source:'mhelpdesk_api'|'owner_supplied_mhelp_export'|'current_tracker'|'recorded_inventory'|'owner';observedAt:string|null;productIds:string[];sourceRecordIds:string[];representedUnitIds:string[];customer:string|null;sourceAddress:Record<string,unknown>|null;reviewReason:string|null;family?:string;category?:string|null;displayUnitNumber?:string;recordedSourcePlacement?:'field'|'shop'|'unknown';candidateUnitIds?:string[];candidatePlacements?:{unitId:string;unitNumber:string;placement:'field'|'shop'|'unknown';source:string;observedAt:string|null}[]};
export type RecordedRoster={contract:'COS_COMBINED_FLEET_ROSTER_V1';items:RecordedEquipment[];summary:Record<string,number>;countBasis:'equipment_records_with_reviewed_cross_source_links';physicalDeduplication:'incomplete'};
const text=(value:unknown,max=512)=>typeof value==='string'&&value.length<=max;
const strings=(value:unknown)=>Array.isArray(value)&&value.length<=1001&&value.every(v=>text(v,180));
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
/** Optional for older API deployments. A present malformed roster never supplies counts. */
export function readRecordedRoster(value:unknown,inventory?:DashboardUnit[]):{roster:RecordedRoster|null;error:string|null}{
 if(value===undefined)return {roster:null,error:null};
 const bad=()=>({roster:null,error:'The combined equipment roster could not be verified. Recorded equipment totals are unavailable.'});
 if(!value||typeof value!=='object')return bad();const v=value as RecordedRoster;
 if(v.contract!=='COS_COMBINED_FLEET_ROSTER_V1'||v.countBasis!=='equipment_records_with_reviewed_cross_source_links'||v.physicalDeduplication!=='incomplete'||!Array.isArray(v.items)||v.items.length>10000||!v.summary||typeof v.summary!=='object')return bad();
 const ids=new Set<string>(),unitIds=new Set<string>();
 for(const r of v.items){
  if(!r||!text(r.id,180)||!r.id||ids.has(r.id)||!['unit','source_equipment','identity_review'].includes(r.kind)||!text(r.unitNumber,180)||!r.unitNumber||!['field','shop','unknown'].includes(r.placement)||!['active','do_not_use','missing','retired','decommissioned'].includes(r.lifecycle)||typeof r.active!=='boolean'||!['mhelpdesk_api','owner_supplied_mhelp_export','current_tracker','recorded_inventory','owner'].includes(r.source)||r.observedAt!==null&&(!text(r.observedAt,64)||!Number.isFinite(Date.parse(r.observedAt)))||!strings(r.productIds)||!strings(r.sourceRecordIds)||!strings(r.representedUnitIds)||r.customer!==null&&!text(r.customer)||r.reviewReason!==null&&!text(r.reviewReason,2000)||r.family!==undefined&&!text(r.family,180)||r.category!=null&&!text(r.category,180)||r.displayUnitNumber!==undefined&&!text(r.displayUnitNumber,180))return bad();
  if(r.active&&r.lifecycle!=='active'||r.kind==='identity_review'&&r.placement!=='unknown'||r.kind==='source_equipment'&&r.placement==='unknown')return bad();
  if(r.kind==='unit'&&(r.id!=='cos_unit:'+r.unitId||!uuid(r.unitId)||!r.unit||r.unit.id!==r.unitId||r.unit.unitNumber!==r.unitNumber||inventoryPlacement(r.unit)!==r.placement||typeof r.unit.activeInventoryEligible==='boolean'&&r.unit.activeInventoryEligible!==r.active||unitIds.has(r.unitId!)))return bad();
  if(r.kind!=='unit'&&(r.unitId!==null||r.unit!==null||!r.id.startsWith('mhelp_product:')&&!r.id.startsWith('tracker_row:')))return bad();
  if(r.sourceAddress!==null&&(!r.sourceAddress||typeof r.sourceAddress!=='object'||Array.isArray(r.sourceAddress)))return bad();
  if(r.recordedSourcePlacement!==undefined&&(!['field','shop','unknown'].includes(r.recordedSourcePlacement)||r.kind!=='identity_review'||r.placement!=='unknown'))return bad();
  if(r.candidateUnitIds!==undefined&&(!Array.isArray(r.candidateUnitIds)||r.candidateUnitIds.length>1001||!r.candidateUnitIds.every(uuid)))return bad();
  if(r.candidatePlacements!==undefined&&(!Array.isArray(r.candidatePlacements)||r.candidatePlacements.length>1001||r.candidatePlacements.some(p=>!p||!uuid(p.unitId)||!r.candidateUnitIds?.includes(p.unitId)||!text(p.unitNumber,180)||!['field','shop','unknown'].includes(p.placement)||!text(p.source,180)||p.observedAt!==null&&(!text(p.observedAt,64)||!Number.isFinite(Date.parse(p.observedAt))))))return bad();
  ids.add(r.id);if(r.unitId)unitIds.add(r.unitId);
 }
 for(const key of ['totalRecords','activeRecords','field','shop','review','excludedLifecycle','sourceOnlyRecords','linkedUnitRecords'])if(!Number.isSafeInteger(v.summary[key])||v.summary[key]<0||v.summary[key]>10000)return bad();
 if(v.summary.totalRecords!==v.items.length||v.summary.activeRecords!==v.items.filter(r=>r.active).length||v.summary.field!==v.items.filter(r=>r.active&&r.placement==='field').length||v.summary.shop!==v.items.filter(r=>r.active&&r.placement==='shop').length)return bad();
 if(v.summary.review!==v.items.filter(r=>r.active&&r.placement==='unknown').length||v.summary.excludedLifecycle!==v.items.filter(r=>!r.active).length||v.summary.sourceOnlyRecords!==v.items.filter(r=>r.kind!=='unit').length||v.summary.linkedUnitRecords!==v.items.filter(r=>r.kind==='unit').length)return bad();
 if(inventory&&(inventory.length!==unitIds.size||new Set(inventory.map(row=>row.id)).size!==inventory.length||inventory.some(row=>!v.items.some(item=>item.kind==='unit'&&item.unitId===row.id&&item.unitNumber===row.unitNumber&&item.placement===inventoryPlacement(row)&&(typeof row.activeInventoryEligible!=='boolean'||item.active===row.activeInventoryEligible)))))return bad();
 return {roster:v,error:null};
}
export const recordedFamily=(r:RecordedEquipment)=>canonicalCameraUnit(r.unitNumber)?.split('|')[0]||r.family||r.category||'Other equipment';
export const recordedSourceLabel=(r:RecordedEquipment)=>({mhelpdesk_api:'MHelp API',owner_supplied_mhelp_export:'MHelp export',current_tracker:'2027 tracker',recorded_inventory:'Recorded inventory',owner:'Owner record'}[r.source]);
/** Non-UUID source rows stay outside camera classification and native write actions. */
export function filterSourceEquipment(items:RecordedEquipment[],filters:FleetFilters,view='map'){
 const q=filters.query.trim().toLowerCase();
 return items.filter(r=>r.kind!=='unit'&&(view!=='setup'||r.active&&r.placement==='field')&&(filters.retired||r.active)&&(filters.placement==='all'||r.placement===filters.placement)&&(filters.family==='all'||recordedFamily(r)===filters.family)&&(filters.provider==='all'||filters.provider==='Unlinked equipment')
  &&(!q||[r.unitNumber,r.displayUnitNumber,r.customer,recordedAddressText(r.sourceAddress),r.category,...r.productIds].filter(Boolean).join(' ').toLowerCase().includes(q))
  &&['all','unknown'].includes(filters.status)&&!filters.nearbyId&&(!filters.installationStatus||filters.installationStatus==='all')&&view!=='verify');
}
