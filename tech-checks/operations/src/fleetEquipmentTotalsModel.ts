import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {mhelpProviderFamily} from './mhelpProviderFleet';
import {canonicalCameraUnit} from './fieldCameraHealth';
import type {FleetCommandCenterData,FleetCommandProduct} from './fleetCommandCenterModel';
export type EquipmentGroup='cameras'|'helios'|'stands';
export type EquipmentTotal={key:EquipmentGroup;total:number;field:number;shop:number;online:number;offline:number;unverified:number;products:FleetCommandProduct[]};
/** Counts unique accepted Product IDs, including unlinked records. Health is Field-only. */
export function fleetEquipmentTotals(upload:unknown,data:FleetCommandCenterData|null,now:number):EquipmentTotal[]|null {
 const authority=readMhelpInventoryAuthority(upload,now);
 if(!authority)return null;
 const records=(upload as {records:{productId:string;unitNumber?:string;category?:string;placement:string}[]}).records;
 const fieldIds=new Set(records.filter(r=>r.placement==='FIELD').map(r=>r.productId));
 const trusted=Boolean(data&&data.total===authority.total&&data.field===authority.field&&data.shop===authority.shop&&data.items.length===fieldIds.size&&new Set(data.items.map(p=>p.productId)).size===fieldIds.size&&data.items.every(p=>fieldIds.has(p.productId)));
 return (['cameras','helios','stands'] as const).map(key=>{
  const members=records.filter(r=>key==='stands'?mhelpProviderFamily(r.category,r.unitNumber)==='support':key==='helios'?Boolean(canonicalCameraUnit(r.unitNumber||'')?.startsWith('HELIOS|'))||/^HELIOS/.test(String(r.category||'').trim().toUpperCase()):mhelpProviderFamily(r.category,r.unitNumber)!=='support');
  const ids=new Set(members.map(r=>r.productId)),field=members.filter(r=>r.placement==='FIELD').length;
  const products=trusted?data!.items.filter(p=>ids.has(p.productId)):[];
  const online=key==='stands'?0:products.filter(p=>p.status==='online').length,offline=key==='stands'?0:products.filter(p=>p.status==='offline').length;
  return {key,total:members.length,field,shop:members.length-field,online,offline,unverified:key==='stands'?0:field-online-offline,products};
 });
}
