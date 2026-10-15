import {checkedAddressEstimate} from './fieldAddressEstimates';
import type {FleetDashboardRow} from './fleetDashboardModel';
import type {RecordedEquipment} from './fleetRecordedRoster';
import {checkedSourceEquipmentEstimate} from '../../supabase/functions/cos-operations-pages/sourceEquipmentAddressEstimates';

export type FleetLocationPin={row:FleetDashboardRow;point:[number,number];kind:'current'|'estimate'|'recorded'};
/** The map and location queues use the same validated points, never raw coordinates. */
export async function fleetLocationPins(rows:FleetDashboardRow[]):Promise<FleetLocationPin[]>{
 const values=await Promise.all(rows.filter(row=>row.placement==='field'&&!row.retired).map(async row=>{
  if(row.locationVerified)return {row,point:[Number(row.unit.latitude),Number(row.unit.longitude)] as [number,number],kind:'current' as const};
  const estimate=await checkedAddressEstimate(row.unit).catch(()=>null);
  return estimate?{row,point:[estimate.latitude,estimate.longitude] as [number,number],kind:estimate.confidence==='source_recorded_unverified'?'recorded' as const:'estimate' as const}:null;
 }));
 return values.filter((value):value is FleetLocationPin=>value!==null);
}

export type SourceEquipmentLocationPin={record:RecordedEquipment;point:[number,number];kind:'source_equipment_estimate';estimate:NonNullable<Awaited<ReturnType<typeof checkedSourceEquipmentEstimate>>>};
export type FleetMapPin=FleetLocationPin|SourceEquipmentLocationPin;
export const fleetLocationPinId=(pin:FleetMapPin)=>pin.kind==='source_equipment_estimate'?pin.record.id:pin.row.id;
/** Source records retain their own identities and never become native equipment units. */
export async function sourceEquipmentLocationPins(records:RecordedEquipment[],envelope:unknown,receiptBinding:unknown,now=Date.now()):Promise<SourceEquipmentLocationPin[]>{
 const ids=new Map<string,number>();for(const record of records)ids.set(record.id,(ids.get(record.id)||0)+1);
 const values=await Promise.all(records.filter(record=>ids.get(record.id)===1&&record.kind==='source_equipment'&&record.active&&record.lifecycle==='active'&&record.placement==='field').map(async record=>{
  const estimate=await checkedSourceEquipmentEstimate(record,envelope,receiptBinding,now).catch(()=>null);
  return estimate?{record,point:[estimate.latitude,estimate.longitude] as [number,number],kind:'source_equipment_estimate' as const,estimate}:null;
 }));
 return values.filter((value):value is SourceEquipmentLocationPin=>value!==null);
}
/** Both location queues count exactly the accepted map population, once per equipment identity. */
export function fleetLocationCoverage(rows:FleetDashboardRow[],records:RecordedEquipment[],pins:FleetMapPin[]){
 const fieldIds=new Set([...rows.filter(row=>row.placement==='field'&&!row.retired).map(row=>row.id),...records.filter(record=>record.kind==='source_equipment'&&record.active&&record.lifecycle==='active'&&record.placement==='field').map(record=>record.id)]);
 const mappedIds=new Set(pins.map(fleetLocationPinId).filter(id=>fieldIds.has(id)));
 const estimatedIds=new Set(pins.filter(pin=>pin.kind!=='current').map(fleetLocationPinId).filter(id=>fieldIds.has(id)));
 return {missing:[...fieldIds].filter(id=>!mappedIds.has(id)).length,estimated:estimatedIds.size};
}
