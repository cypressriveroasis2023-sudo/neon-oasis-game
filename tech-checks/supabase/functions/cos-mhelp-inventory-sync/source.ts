/** Authenticated, complete API source. Only service addresses are admitted. */
import {compareInventoryEquipment} from './index.ts';
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v)?v:null;
const text=(v:unknown,max=600)=>v==null?'':typeof v==='number'&&Number.isSafeInteger(v)?String(v):typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v)&&!/(?:password|passwd|token|secret|credential|gate[ -]*code|access[ -]*code)\s*[:=]/i.test(v)?v.trim():(()=>{throw Error('Unsafe source field');})();
const same=(a:Row,b:Row)=>['equipmentId','name','model','equipmentTypeId','customerId','serviceLocationId','active','updatedAt'].every(k=>a[k]===b[k]);
export async function readInventorySource(options:{review:Row;baseline:Row;read:(path:string)=>Promise<any>;verifyEquipment:()=>Promise<any>;now?:()=>string}){
 const {review,baseline,read}=options;const comparison=compareInventoryEquipment(review,baseline);
 const companyIds=baseline.companyCustomerIds;if(!Array.isArray(companyIds)||!companyIds.length||companyIds.some(v=>!id(v)))throw Error('Shop identities unavailable');
 const companies=new Set(companyIds),parents=new Map<string,Promise<Row>>(),services=new Map<string,Promise<Row[]>>();
 const parent=(key:string)=>{if(!parents.has(key))parents.set(key,(async()=>{const r=await read('/customers/'+key+'?Fields=customerId,portalId,name,isServiceLocation,isActive,address1,city,state,zip,countryId');if(!object(r)||id(r.customerId)!==key||id(r.portalId)!=='224643'||typeof r.isServiceLocation!=='boolean'||!text(r.name,250))throw Error('Customer identity unavailable');return r;})());return parents.get(key)!;};
 const serviceList=(key:string)=>{if(!services.has(key))services.set(key,(async()=>{const rows:Row[]=[];let total:number|null=null;for(let n=0;n<25;n++){
  const p=await read('/customers/'+key+'/servicelocations?pageSize=200&rowIndex='+n*200+'&Fields=serviceLocationId,customerId,portalId,name,isActive,address1,city,state,zip,countryId');const batch=p?.results??p?.data;
  if(!Array.isArray(batch)||!Number.isSafeInteger(p.totalRows)||p.totalRows<0||p.totalRows>5000||total!==null&&total!==p.totalRows)throw Error('Incomplete service inventory');total=p.totalRows;
  if(batch.length!==Math.min(200,total!-rows.length))throw Error('Incomplete service page');rows.push(...batch);if(rows.length===total){if(new Set(rows.map(r=>id(r.serviceLocationId??r.customerId))).size!==rows.length)throw Error('Duplicate service identity');return rows;}
 }throw Error('Incomplete service inventory');})());return services.get(key)!;};
 const prior=new Map<string,Row>([...(baseline.apiMissingRecords||[]),...baseline.records].map((r:Row)=>[r.productId,r]));
 const catalog=await read('/equipmentTypes?pageSize=200&rowIndex=0&Fields=equipmentTypeId,portalId,category');
 const categoryRows=Array.isArray(catalog)?catalog:catalog?.results??catalog?.data;
 if(!Array.isArray(categoryRows)||categoryRows.length>10000)throw Error('Incomplete equipment categories');
 // Only the categories referenced by this complete equipment list are needed.
 // Every used type must have one explicit portal/type/category record; global
 // catalog paging metadata cannot be used to infer an unseen category.
 const categories=new Map<string,string>();for(const c of categoryRows){const key=id(c.equipmentTypeId);if(!key||categories.has(key)||id(c.portalId)!=='224643'||!text(c.category,250))throw Error('Invalid equipment category');categories.set(key,text(c.category,250));}
 if(review.items.some((r:Row)=>!categories.has(r.equipmentTypeId)))throw Error('Equipment category needs review');
 const records:Row[]=new Array(review.items.length);let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<review.items.length){const index=next++,e=review.items[index],old=prior.get(e.equipmentId);if(!id(e.customerId))throw Error('Equipment customer unavailable');const p=await parent(e.customerId);
  const shop=companies.has(e.customerId);let site:Row|null=null,addressReview:string|null=null;
  if(!shop){const siteId=e.serviceLocationId||(p.isServiceLocation===true?e.customerId:null);
   if(!siteId)addressReview='service_location_not_assigned';
   // An explicit self-reference is mHelpDesk's customer/default service record.
   // This is not a fallback from a missing or different service-location ID.
   else if(e.customerId===siteId)site=p;
   else{const found=(await serviceList(e.customerId)).filter(s=>id(s.serviceLocationId??s.customerId)===siteId&&(s.serviceLocationId==null||id(s.customerId)===e.customerId));if(found.length!==1)addressReview=found.length?'ambiguous_service_membership':'service_membership_unavailable';else site=found[0];}
   if(site&&(id(site.portalId)!=='224643'||site.countryId!=null&&!['US','USA'].includes(String(site.countryId))))throw Error('Service portal unavailable');
  }
  const category=categories.get(e.equipmentTypeId);if(!category)throw Error('Equipment category needs review');
  const customer=text(p.name,250),siteName=site?text(site.name,250):'';
  const composite=siteName&&siteName!==customer&&!customer.includes(':')?customer+': '+siteName:customer;
  const unitNumber=e.name.trim(),exactPrior=old?.unitNumber===unitNumber;
  const typeChanged=!!old&&(String(old.category).toLowerCase().replace(/\s/g,'')!==category.toLowerCase().replace(/\s/g,'')||old.apiAssignment?.equipmentTypeId!=null&&old.apiAssignment.equipmentTypeId!==e.equipmentTypeId);
  const binding=exactPrior&&!typeChanged&&old?.binding?.guardCurrent===true?Object.fromEntries(Object.entries(old.binding).filter(([k])=>k!=='guardCurrent')):null;
  const lifecycle=e.active===false||/\b(?:DO\s+NOT\s+USE|RETIRED|DECOMMISSIONED|STOLEN)\b/i.test(e.name)?'DO_NOT_USE':/\bMISSING\b/i.test(e.name)?'MISSING':'UNFLAGGED';
  records[index]={productId:e.equipmentId,unitNumber,category,customerId:e.customerId,customer:composite,placement:shop?'SHOP':'FIELD',lifecycle,
   sourceAddress:{street:site?text(site.address1):'',city:site?text(site.city):'',state:site?text(site.state,40):'',zip:site?text(site.zip,20):''},
   sourceRow:index+2,sourceDates:{apiUpdatedAt:e.updatedAt},binding,holdReason:!exactPrior&&old?'api_equipment_label_changed':typeChanged?'api_equipment_type_changed':old?.holdReason||null,
   possibleAliasUnitIds:binding?[]:[...new Set([...(old?.possibleAliasUnitIds||[]),...(old?.binding?[old.binding.trackerId,old.binding.nativeUnitId].filter(Boolean):[])])],
   ...(exactPrior&&old?.displayUnitNumber?{displayUnitNumber:old.displayUnitNumber,displayAuthorizationSha256:old.displayAuthorizationSha256}:{}),
   apiAssignment:{customerId:e.customerId,serviceLocationId:e.serviceLocationId,equipmentTypeId:e.equipmentTypeId,active:e.active,fullLabel:e.name},addressReview,
  };
 }}));
 const fresh=await options.verifyEquipment();compareInventoryEquipment(fresh,baseline);
 if(fresh.items.length!==review.items.length||fresh.items.some((r:Row,i:number)=>!same(r,review.items[i])))throw Error('Equipment changed during source read');
 return {comparison,records,readAt:(options.now||(()=>new Date().toISOString()))(),portalId:'224643',complete:true,
  summary:{total:records.length,field:records.filter(r=>r.placement==='FIELD').length,shop:records.filter(r=>r.placement==='SHOP').length,held:records.filter(r=>r.holdReason).length,addressReview:records.filter(r=>r.addressReview).length},
  sourceReads:{customers:parents.size,serviceInventories:services.size}};
}
