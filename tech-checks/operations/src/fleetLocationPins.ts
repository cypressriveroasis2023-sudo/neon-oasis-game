import {checkedAddressEstimate} from './fieldAddressEstimates';
import type {FleetDashboardRow} from './fleetDashboardModel';

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
