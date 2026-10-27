import {manualShopInventory} from '../../supabase/functions/cos-operations-pages/fleetShopProjection';
import {readRecordedRoster} from './fleetRecordedRoster';
import {fleetDashboardRows} from './fleetDashboardModel';
import {mhelpFieldHealth} from './mhelpFieldHealth';
import {buildFleetCommandCenter} from './fleetCommandCenterModel';
import type {Health} from './fieldCameraHealth';

/** The same reviewed Product-ID census and health gates used by Fleet. Legacy
 * provider groups remain diagnostics; they cannot supply this denominator. */
export function cameraFieldProducts(map:any,health:Health,now:number,readSucceeded=true){
 if(!map)return null;
 const inventory=map.inventoryItems||map.items||[];
 const roster=readRecordedRoster(map.fleetRoster,inventory).roster;
 const upload=manualShopInventory(map.uploadInventory,map.manualPlacementOverrides);
 const rows=fleetDashboardRows(inventory,health,null,null,now).map(row=>{
  const item=roster?.items.find(item=>item.unitId===row.id);
  return {...row,retired:item?!item.active:row.retired};
 });
 const field=mhelpFieldHealth(upload,roster,rows,now,map.productConnections);
 return buildFleetCommandCenter(upload,field,readSucceeded,rows,null,null,now,health.refreshedAt||null);
}
