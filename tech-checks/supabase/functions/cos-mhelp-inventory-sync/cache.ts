/** Only the inventory reader's fixed, projected customer/service/category paths
 * can enter this cache. Observation times survive reuse; no stale fallback. */
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const identity=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v)?v:null;
const safe=(v:unknown)=>v==null||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v)||typeof v==='string'&&v.length<=600&&!/[\x00-\x1f\x7f<>]/.test(v)&&!/(password|token|secret|gate[ -]*code)\s*[:=]/i.test(v);
const customerFields=['customerId','portalId','name','isServiceLocation','isActive','address1','city','state','zip','countryId'];
function spec(path:string){
 let m=path.match(/^\/customers\/([1-9][0-9]{0,14})\?Fields=customerId,portalId,name,isServiceLocation,isActive,address1,city,state,zip,countryId$/);
 if(m)return {kind:'customer',id:m[1],page:0};
 m=path.match(/^\/customers\/([1-9][0-9]{0,14})\/servicelocations\?pageSize=200&rowIndex=([0-9]+)&Fields=serviceLocationId,customerId,portalId,name,isActive,address1,city,state,zip,countryId$/);
 if(m&&Number(m[2])<=4800&&Number(m[2])%200===0)return {kind:'services',id:m[1],page:Number(m[2])};
 if(path==='/equipmentTypes?pageSize=200&rowIndex=0&Fields=equipmentTypeId,portalId,category')return {kind:'categories',id:'all',page:0};
 throw Error('Unsupported inventory cache path');
}
/** Drop every unrequested field before storage, even if the provider ignores Fields. */
export function projectInventoryCache(path:string,value:unknown):unknown{
 const s=spec(path);
 const project=(r:unknown,fields:string[])=>{if(!object(r)||identity(r.portalId)!=='224643'||fields.some(k=>!safe(r[k])))throw Error('Invalid inventory cache response');return Object.fromEntries(fields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));};
 if(s.kind==='customer'){
  const r=project(value,customerFields);if(identity(r.customerId)!==s.id||typeof r.isServiceLocation!=='boolean'||typeof r.name!=='string'||!r.name.trim())throw Error('Invalid cached customer identity');return r;
 }
 if(s.kind==='categories'){
  const rows=Array.isArray(value)?value:object(value)?value.results??value.data:null;
  if(!Array.isArray(rows)||rows.length>10000)throw Error('Invalid cached categories');
  const result=rows.map(r=>project(r,['equipmentTypeId','portalId','category']));
  if(result.some(r=>!identity(r.equipmentTypeId)||typeof r.category!=='string'||!r.category.trim())||new Set(result.map(r=>identity(r.equipmentTypeId))).size!==result.length)throw Error('Invalid cached categories');return result;
 }
 const rows=object(value)?value.results??value.data:null;
 if(!object(value)||!Array.isArray(rows)||rows.length>200||!Number.isSafeInteger(value.totalRows)||value.totalRows<0||value.totalRows>5000||rows.length!==Math.min(200,Math.max(0,value.totalRows-s.page)))throw Error('Incomplete cached service page');
 const result=rows.map(r=>project(r,['serviceLocationId',...customerFields.filter(k=>k!=='isServiceLocation')]));
 if(result.some(r=>!identity(r.serviceLocationId??r.customerId)||(r.serviceLocationId!=null&&identity(r.customerId)!==s.id))||new Set(result.map(r=>identity(r.serviceLocationId??r.customerId))).size!==result.length)throw Error('Invalid cached service membership');
 return {totalRows:value.totalRows,results:result};
}
export const MHELP_RESOURCE_CACHE_TTL_MS=3*60*60*1000;
export function createInventoryCache(options:{read:(path:string)=>Promise<unknown>;cache:(action:'read'|'write',key:string,payload?:unknown,observedAt?:string)=>Promise<unknown>;now?:()=>number}){
 const now=options.now||Date.now,times=new Map<string,string>(),pending=new Map<string,Promise<any>>();let hits=0,misses=0;
 const read=async(path:string,refresh=false):Promise<any>=>{
  spec(path);const key='224643:'+path;
  const operation=async()=>{
   if(!refresh){const cached=await options.cache('read',key);if(!object(cached)||typeof cached.hit!=='boolean')throw Error('Inventory cache unavailable');
    if(cached.hit){const stamp=typeof cached.observedAt==='string'?Date.parse(cached.observedAt):NaN;
     if(!Number.isFinite(stamp)||stamp>now()+30000||now()-stamp>=MHELP_RESOURCE_CACHE_TTL_MS)throw Error('Invalid resource observation');
     const value=projectInventoryCache(path,cached.payload);hits++;times.set(path,cached.observedAt);return value;
    }
   }
   const observedAt=new Date(now()).toISOString();misses++;
   const value=projectInventoryCache(path,await options.read(path));
   const receipt=await options.cache('write',key,value,observedAt);
   if(!object(receipt)||receipt.saved!==true)throw Error('Inventory cache save is unconfirmed');
   times.set(path,observedAt);return value;
  };
  if(refresh){const replacement=operation().catch(e=>{pending.delete(key);throw e;});pending.set(key,replacement);return replacement;}
  if(!pending.has(key))pending.set(key,operation().catch(e=>{pending.delete(key);throw e;}));return pending.get(key)!;
 };
 return {read,observedAt:(path:string)=>times.get(path),counts:()=>({hits,misses}),stats:()=>({cacheHits:hits,resourceCacheMisses:misses})};
}
