import { records, type Row } from './directoryData.js';
import { checkedFieldMap } from './gpsPersistence';
import { readTicketDirectory } from './ticketDirectoryData';
import { ticketTypes, type TicketType } from './ticketTypes';
export type TicketUnitContext = {
  unitId:string; unitNumber:string; modelName:string; source:'native'|'tracker';
  state:'linked'|'unresolved'; message:string; siteId?:string; siteName?:string; customerId?:string; customerName?:string;
};
export const isTicketUnitId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** Use saved identifiers only. Labels, similar names and tracker rows never establish a site/customer relationship. */
export function resolveTicketUnitContext(unitId:string,equipmentData:unknown,mapData:unknown,customerData:unknown,siteData:unknown):TicketUnitContext {
  if(!isTicketUnitId(unitId))throw new Error('Select a valid unit before opening its ticket context.');
  const equipment=records(equipmentData,'Equipment','unitNumber');
  const map=checkedFieldMap(mapData);
  const {customers,sites}=readTicketDirectory(customerData,siteData);
  const matches=equipment.filter(row=>row.id===unitId);
  if(matches.length>1)throw new Error('The selected equipment identity is ambiguous. Return to Field View and refresh.');
  const mapped:Row|undefined=map.items.find((row:Row)=>row.id===unitId);
  if(!matches.length){
    if(!mapped||mapped.readOnly!==true)throw new Error('The selected unit is no longer available in the current equipment or tracker records. Return to Field View and refresh.');
    return {unitId,unitNumber:mapped.unitNumber,modelName:String(mapped.modelName||''),source:'tracker',state:'unresolved',message:'This is a read-only tracker reference. Its customer and site are not linked by verified record IDs. Choose the real customer and site below.'};
  }
  const unit=matches[0];
  if(mapped?.readOnly===true)throw new Error('This unit identity conflicts with a read-only tracker record. Refresh Field View before creating a ticket.');
  const base={unitId,unitNumber:String(unit.unitNumber),modelName:String(unit.modelName||''),source:'native' as const};
  if(unit.status!=='installed'||!['site','field'].includes(String(unit.currentLocationType||''))||!isTicketUnitId(unit.installedSiteId))return {...base,state:'unresolved',message:'This unit does not have a verified current installed site. Choose the real customer and site below; no location was guessed.'};
  const site=sites.find(row=>row.id===unit.installedSiteId),customer=customers.find(row=>row.id===site?.customerId);
  if(!site||!customer)return {...base,state:'unresolved',message:'The unit’s recorded site or customer is not active in the current directory. Choose the real customer and site below.'};
  if(mapped&&mapped.installedSiteId!==unit.installedSiteId)return {...base,state:'unresolved',message:'Field View and the equipment registry disagree about this unit’s installed site. Choose the real customer and site after reviewing the records.'};
  return {...base,state:'linked',siteId:site.id,siteName:site.name,customerId:customer.id,customerName:customer.name,message:'Customer and site were verified from this equipment record’s installed-site and customer IDs. Review them before saving.'};
}
export async function loadTicketUnitContext(client:{get:(path:string)=>Promise<{data:unknown}>},unitId:string) {
  const [equipment,map,customers,sites]=await Promise.all(['/api/equipment','/api/field-map','/api/customers','/api/sites'].map(path=>client.get(path)));
  return resolveTicketUnitContext(unitId,equipment.data,map.data,customers.data,sites.data);
}
export function ticketContextTitle(type:TicketType,context:TicketUnitContext) {
  return (ticketTypes.find(item=>item.value===type)?.label||type)+' · '+context.unitNumber;
}
export function ticketContextInstructions(context:TicketUnitContext) {
  return 'Unit reference: '+context.unitNumber+(context.modelName?' ('+context.modelName+')':'')+'.\n'+
    (context.source==='tracker'?'Read-only tracker record: ':'Equipment record: ')+context.unitId+'.\n'+
    'Opened from Camera Health. This reference does not assign equipment or select a replacement unit.';
}
