import {projectServiceLocation} from '../cos-operations-pages/mhelpUnitLocation.ts';
import {censusAddress} from '../camera-field-geocode/censusAddress.ts';
import {projectCustomer} from '../cos-mhelp-assignments/index.ts';
type Row=Record<string,any>;
/** Reads service-location membership and safe address fields. Billing addresses never qualify. */
export function createFleetLocationReader(read:(path:string)=>Promise<any>,fetcher:typeof fetch,portal='224643',onReview?:(reason:'customer_identity'|'service_inventory'|'service_membership'|'address_validation')=>void){
 let geocodeAttempts=0;
 const review=(code:'service_inventory'|'service_membership',message:string):never=>{onReview?.(code);throw Error(message);};
 const customers=new Map<string,Promise<Row>>(),services=new Map<string,Promise<Row[]>>(),geocodes=new Map<string,Promise<any>>();
 const customer=(id:string)=>{if(!customers.has(id))customers.set(id,read('/customers/'+id+'?Fields=customerId,portalId,name,isServiceLocation,isActive,address1,address2,city,state,zip,countryId,latitude,longitude').then(r=>{if(String(r.customerId)!==id||String(r.portalId)!==portal||r.isActive===false){onReview?.('customer_identity');throw Error('Customer identity changed');}return r;}));return customers.get(id)!;};
 const serviceList=(id:string)=>{if(!services.has(id))services.set(id,(async()=>{const all:Row[]=[];let total:number|null=null;for(let page=0;page<25;page++){
  const value=await read('/customers/'+id+'/servicelocations?pageSize=200&rowIndex='+page*200+'&Fields=serviceLocationId,customerId,portalId,name,isActive,address1,address2,city,state,zip,countryId,latitude,longitude');
  const rows=value.data??value.results;if(!Array.isArray(rows)||!Number.isSafeInteger(value.totalRows)||value.totalRows<0||value.totalRows>5000||total!==null&&total!==value.totalRows)review('service_inventory','Service inventory incomplete');total=Number(value.totalRows);
  if(rows.length!==Math.min(200,total-all.length))review('service_inventory','Service page incomplete');all.push(...rows);if(all.length===total){if(new Set(all.map(r=>String(r.serviceLocationId??r.customerId))).size!==all.length)review('service_inventory','Duplicate service identity');return all;}
 }return review('service_inventory','Service inventory incomplete');})());return services.get(id)!;};
 const serviceRecord=async(parentId:string,siteId:string)=>{
  if(!/^[1-9]\d{0,14}$/.test(parentId)||!/^[1-9]\d{0,14}$/.test(siteId))review('service_membership','Service identity unverified');
  const matches=(await serviceList(parentId)).filter(r=>String(r.serviceLocationId??r.customerId)===siteId&&(r.serviceLocationId==null||String(r.customerId)===parentId));
  if(matches.length!==1||String(matches[0].portalId)!==portal||matches[0].isActive===false||matches[0].isServiceLocation===false)review('service_membership','Service membership unverified');
  return matches[0];
 };
 const placementService=async(parentId:string,siteId:string)=>{
  const row=await serviceRecord(parentId,siteId);
  // Complete parent service membership establishes kind; address completeness
  // remains a separate check and cannot erase a verified Field assignment.
  return projectCustomer({...row,customerId:siteId,isServiceLocation:true},siteId,portal);
 };
 const locationReader=async(equipment:Row,previous:Row|null)=>{
  if(!equipment.customerId)throw Error('Customer assignment unavailable');
  const parent=await customer(equipment.customerId),customerName=String(parent.name||'').trim(),shop=['cameras onsite','cameras onsite llc'].includes(customerName.toLowerCase());
  if(shop)return {placement:'SHOP',customer:customerName,site:'Shop / ROOT',address:null,point:null,coordinateSource:null};
  const locationId=equipment.serviceLocationId|| (parent.isServiceLocation===true?equipment.customerId:null);
  if(!locationId)throw Error('Service location unavailable');
  const service=parent.isServiceLocation===true&&equipment.customerId===locationId?parent:await serviceRecord(equipment.customerId,locationId);
  let location:ReturnType<typeof projectServiceLocation>;
  try{location=projectServiceLocation(service,portal,locationId,equipment.customerId);}catch(cause){onReview?.('address_validation');throw cause;}
  let coordinateSource=location.point?'mHelpDesk service location':null;
  if(!location.point&&previous?.address===location.address&&previous?.coordinateSource==='Census address estimate'&&Array.isArray(previous.point)){location.point=previous.point;coordinateSource=previous.coordinateSource;}
  if(!location.point){
   const bucket=Array.from(location.address).reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,0)%16,slot=Math.floor(Date.now()/(15*60*1000))%16;
   if(!geocodes.has(location.address)&&geocodeAttempts<6&&bucket===slot){geocodeAttempts++;geocodes.set(location.address,censusAddress(location.address,fetcher));}
   const geo=await geocodes.get(location.address);if(geo?.status==='success'){location.point=[geo.latitude,geo.longitude];coordinateSource='Census address estimate';}
  }
  return {placement:'FIELD',customer:customerName,...location,coordinateSource};
 };
 return Object.assign(locationReader,{placementService});
}
