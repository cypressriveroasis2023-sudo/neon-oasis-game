import type {RecordedEquipment} from './fleetRecordedRoster';
import type {DashboardUnit} from './fleetDashboardModel';

export type FleetDisplayAddress={text:string;label:'MHelp address'|'Installation address';recordedAt:string|null};
/** Presentation only. This address must never replace the unit's installation/pin evidence. */
export function recordedAddressText(value:unknown):string{
 if(!value||typeof value!=='object'||Array.isArray(value))return '';
 const address=value as Record<string,unknown>,part=(key:string)=>typeof address[key]==='string'&&address[key].length<=600?address[key].trim():'';
 return [part('street'),part('city'),[part('state'),part('zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
export function fleetDisplayAddress(unit:DashboardUnit,record?:RecordedEquipment):FleetDisplayAddress{
 const linked=record?.kind==='unit'&&record.unitId===unit.id&&record.unitNumber===unit.unitNumber&&['owner_supplied_mhelp_export','mhelpdesk_api'].includes(record.source||'')&&record.productIds.length>0;
 return linked?{text:recordedAddressText(record.sourceAddress),label:'MHelp address',recordedAt:record.observedAt}:{text:typeof unit.address==='string'?unit.address:'',label:'Installation address',recordedAt:null};
}
