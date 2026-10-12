import {projectServiceLocation} from '../cos-operations-pages/mhelpUnitLocation.ts';
import {censusAddress} from '../camera-field-geocode/censusAddress.ts';
type Row=Record<string,any>;
/** Reads service-location membership and safe address fields. Billing addresses never qualify. */
export function createFleetLocationReader(read:(path:string)=>Promise<any>,fetcher:typeof fetch,portal='224643'){
 let geocodeAttempts=0;
 const customers=new Map<string,Promise<Row>>(),services=new Map<string,Promise<Row[]>>(),geocodes=new Map<string,Promise<any>>();
 const customer=(id:string)=>{if(!customers.has(id))customers.set(id,read('/customers/'+id+'?Fields=customerId,portalId,name,isServiceLocation,isActive,address1,address2,city,state,zip,countryId,latitude,longitude').then(r=>{if(String(r.customerId)!==id||String(r.portalId)!==portal||r.isActive===false)throw Error('Customer identity changed');return r;}));return customers.get(id)!;};
 const serviceList=(id:string)=>{if(!services.has(id))services.set(id,(async()=>{const all:Row[]=[];let total:number|null=null;for(let page=0;page<25;page++){
  const value=await read('/customers/'+id+'/servicelocations?pageSize=200&rowIndex='+page*200+'&Fields=customerId,portalId,name,isActive,address1,address2,city,state,zip,countryId,latitude,longitude');
  const rows=value.data??value.results;if(!Array.isArray(rows)||!Number.isSafeInteger(value.totalRows)||value.totalRows<0||value.totalRows>5000||total!==null&&total!==value.totalRows)throw Error('Service inventory incomplete');total=value.totalRows;
  if(rows.length!==Math.min(200,total-all.length))throw Error('Service page incomplete');all.push(...rows);if(all.length===total){if(new Set(all.map(r=>String(r.customerId))).size!==all.length)throw Error('Duplicate service identity');return all;}
 }throw Error('Service inventory incomplete');})());return services.get(id)!;};
 return async(equipment:Row,previous:Row|null)=>{
  if(!equipment.customerId)throw Error('Customer assignment unavailable');
  const parent=await customer(equipment.customerId),customerName=String(parent.name||'').trim(),shop=['cameras onsite','cameras onsite llc'].includes(customerName.toLowerCase());
  if(shop)return {placement:'SHOP',customer:customerName,site:'Shop / ROOT',address:null,point:null,coordinateSource:null};
  const locationId=equipment.serviceLocationId|| (parent.isServiceLocation===true?equipment.customerId:null);
  if(!locationId)throw Error('Service location unavailable');
  const matches=parent.isServiceLocation===true&&equipment.customerId===locationId?[parent]:(await serviceList(equipment.customerId)).filter(r=>String(r.customerId)===locationId);
  if(matches.length!==1)throw Error('Service membership unverified');
  const location=projectServiceLocation(matches[0],portal,locationId);let coordinateSource=location.point?'mHelpDesk service location':null;
  if(!location.point&&previous?.address===location.address&&previous?.coordinateSource==='Census address estimate'&&Array.isArray(previous.point)){location.point=previous.point;coordinateSource=previous.coordinateSource;}
  if(!location.point){
   const bucket=Array.from(location.address).reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,0)%16,slot=Math.floor(Date.now()/(15*60*1000))%16;
   if(!geocodes.has(location.address)&&geocodeAttempts<6&&bucket===slot){geocodeAttempts++;geocodes.set(location.address,censusAddress(location.address,fetcher));}
   const geo=await geocodes.get(location.address);if(geo?.status==='success'){location.point=[geo.latitude,geo.longitude];coordinateSource='Census address estimate';}
  }
  return {placement:'FIELD',customer:customerName,...location,coordinateSource};
 };
}
