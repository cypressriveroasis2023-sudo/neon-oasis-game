const PORTAL='224643';
const fields='customerId,portalId,name,isServiceLocation,isActive,address1,address2,city,state,zip,countryId,latitude,longitude';
type Row=Record<string,unknown>;
/** Same-run verified parents need no second GET. Service-location addresses always use their full read. */
export function createPlacementParentReadCache(){
 const parents=new Map<string,Row>();
 return {
  remember(id:string,value:unknown){
   if(!value||typeof value!=='object'||Array.isArray(value))return;
   const r=value as Row;
   if(!/^[1-9]\d{0,14}$/.test(id)||String(r.customerId)!==id||String(r.portalId)!==PORTAL||r.isServiceLocation!==false||typeof r.name!=='string'||!r.name.trim()||r.name.length>180||/[\x00-\x1f\x7f<>]/.test(r.name))return;
   parents.set(id,{customerId:id,portalId:PORTAL,name:r.name,isServiceLocation:false,...(typeof r.isActive==='boolean'?{isActive:r.isActive}:{})});
  },
  read(path:string){
   const match=/^\/customers\/([1-9]\d{0,14})\?Fields=(.*)$/.exec(path);
   if(!match||match[2]!==fields)return null;
   const row=parents.get(match[1]);return row?{...row}:null;
  },
 };
}
