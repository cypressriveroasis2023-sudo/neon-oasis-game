import {sniperShopDisplay} from './sniperShopDisplay';
import {recordedAddressText} from './fleetDisplayAddress';
import {cameraTime} from './fieldCameraHealth';
import {recordedSourceLabel,type RecordedEquipment} from './fleetRecordedRoster';
import type {SourceEquipmentLocationPin} from './fleetLocationPins';
const lifecycle={active:'Active record',do_not_use:'Do not use',missing:'Missing',retired:'Retired',decommissioned:'Decommissioned'};
export default function FleetSourceEquipment({record,now,estimate,onSelect}:{record:RecordedEquipment;now:number;estimate?:SourceEquipmentLocationPin['estimate'];onSelect?:()=>void}){
 return <article className='cos-fleet-source-record' data-record-id={record.id}>
  <strong>{record.displayUnitNumber||record.unitNumber}</strong><small>{record.customer||'Customer not supplied'}</small>
  <p className='cos-fleet-recorded-address'>{['owner_supplied_mhelp_export','mhelpdesk_api'].includes(record.source||'')?'MHelp address':'Recorded source address'}: {recordedAddressText(record.sourceAddress)||'Not supplied in this source'}</p>
  <p>{record.placement==='field'?'Recorded FIELD':record.placement==='shop'?(sniperShopDisplay(record.placement,record.unitNumber)?'SHOP':'SHOP / ROOT'):'Placement review'} · {lifecycle[record.lifecycle]}</p>
  {record.recordedSourcePlacement&&<p>Source assignment: {record.recordedSourcePlacement.toUpperCase()} · excluded from confirmed placement totals pending identity review.</p>}
  <span className='cos-fleet-badge cos-signal-unknown'>{record.kind==='identity_review'?'Identity review':'Health unlinked'}</span>
  <small>{recordedSourceLabel(record)} · Recorded {cameraTime(record.observedAt,now)}</small>
  {estimate&&<><p>Estimated address · Unlinked equipment</p><small>Address-based point only. Installation is unverified; this is not live GPS or device health.</small>{onSelect&&<button data-record-id={record.id} onClick={onSelect}>View estimated address →</button>}</>}
  <details><summary>Equipment record details</summary><p>{record.reviewReason||'This equipment record has no verified COS unit link. Camera, router and power evidence are not assigned to it.'}</p><p>{estimate?'An estimated address is shown on the map. Native installation edits require a verified COS unit link.':'No map pin or installation edit is currently available. Address estimates need accepted source evidence; native edits need a verified COS unit link.'}</p>{record.productIds.length>0&&<p>MHelp product record: {record.productIds.join(', ')}</p>}{record.category&&<p>Source category: {record.category}</p>}{Boolean(record.candidatePlacements?.length)&&<ul>{record.candidatePlacements!.map(candidate=><li key={candidate.unitId}>{candidate.unitNumber} · recorded {candidate.placement.toUpperCase()} · {candidate.unitId}<small>{candidate.source} · {cameraTime(candidate.observedAt,now)}</small></li>)}</ul>}</details>
 </article>;
}
