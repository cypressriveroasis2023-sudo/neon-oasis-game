import {manualShopInventory} from '../../supabase/functions/cos-operations-pages/fleetShopProjection';
import {readRecordedRoster} from './fleetRecordedRoster';
import {mhelpFieldHealth} from './mhelpFieldHealth';
import {fleetDashboardRows,type DashboardUnit} from './fleetDashboardModel';
import {buildFleetCommandCenter,type FleetCommandCenterData} from './fleetCommandCenterModel';
import type {Health} from './fieldCameraHealth';
import type {RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';
import type {MhelpAddressMapResult} from './mhelpAddressMapPins';

/** TV uses the same accepted Product-ID accounting as the Fleet headline.
 * Native rows remain diagnostic resources, never additional census members. */
export function tvFieldCensus(source:Record<string,any>|null,inventory:DashboardUnit[],health:Health|null,routers:RouterSnapshot|null,addressMap:MhelpAddressMapResult|null,now:number){
 const rows=fleetDashboardRows(inventory,health,routers?.items||null,null,now);
 const upload=source?manualShopInventory(source.uploadInventory,source.manualPlacementOverrides):null;
 const roster=source?readRecordedRoster(source.fleetRoster,inventory).roster:null;
 const products=mhelpFieldHealth(upload,roster,rows,now,source?.productConnections);
 return {rows,products,board:buildFleetCommandCenter(upload,products,Boolean(health),rows,addressMap,null,now,health?.refreshedAt||null)};
}

/** Expand neither names nor provider resources: one exact row per offline Product ID. */
export function tvCensusOutages<T extends {unit:{id:string};health:{state:string}}>(board:FleetCommandCenterData|null,rows:T[]):Array<T&{productId?:string}>{
 if(!board)return rows.filter(row=>row.health.state==='offline');
 return board.items.filter(product=>product.status==='offline').flatMap(product=>{
  const matches=rows.filter(row=>row.unit.id===product.linked?.unitId&&row.health.state==='offline');
  return matches.length===1?[{...matches[0],productId:product.productId}]:[];
 });
}
