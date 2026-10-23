import {manualShopInventory} from '../../supabase/functions/cos-operations-pages/fleetShopProjection';
import {readRecordedRoster} from './fleetRecordedRoster';
import {mhelpFieldHealth} from './mhelpFieldHealth';
import {fleetDashboardRows} from './fleetDashboardModel';
import {buildFleetCommandCenter} from './fleetCommandCenterModel';
import type {Health,FieldHealthUnit} from './fieldCameraHealth';
import type {RouterSnapshot} from '../../supabase/functions/cos-operations-pages/routers';
import type {MhelpAddressMapResult} from './mhelpAddressMapPins';

/** TV and Fleet share the same Product-ID census and current camera evidence.
 * Native rows supply verified detail only; they cannot add equipment to Field. */
export function tvFleetCensus(source:Record<string,any>|null,inventory:FieldHealthUnit[],health:Health|null,routers:RouterSnapshot|null,addressMap:MhelpAddressMapResult|null,now:number){
 const upload=source?manualShopInventory(source.uploadInventory,source.manualPlacementOverrides):null;
 const roster=source?readRecordedRoster(source.fleetRoster,inventory).roster:null;
 const dashboard=fleetDashboardRows(inventory,health,routers?.items||null,null,now);
 const products=mhelpFieldHealth(upload,roster,dashboard,now);
 const census=buildFleetCommandCenter(upload,products,Boolean(health),dashboard,addressMap,null,now,health?.refreshedAt||null);
 if(!census)return null;
 const locations=new Map((products?.items||[]).map(p=>[p.productId,p.unitId]));
 return {...census,items:census.items.map(p=>({...p,locationUnitId:locations.get(p.productId)||null}))};
}
