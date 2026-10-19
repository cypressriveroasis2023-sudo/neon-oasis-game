/** Complete-source comparison. Vendor/credential objects never enter responses. */
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown)=>typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v);
const label=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=250&&!/[\x00-\x1f\x7f<>]/.test(v);
export function compareInventoryEquipment(review:unknown,baseline:unknown){
 if(!object(review)||review.liveAccessVerified!==true||review.verifiedPortalId!=='224643'||review.partial!==false
  ||!Array.isArray(review.items)||!Number.isSafeInteger(review.totalRows)||review.totalRows!==review.items.length||!review.totalRows||review.totalRows>10000)throw Error('Incomplete source');
 if(!object(baseline)||!Array.isArray(baseline.records)||!baseline.records.length||!/^[a-f0-9]{64}$/.test(baseline.sourceSha256))throw Error('Invalid baseline');
 const prior=new Map<string,Row>(),current=new Map<string,Row>();
 for(const r of baseline.records){if(!object(r)||!id(r.productId)||prior.has(r.productId)||!label(r.unitNumber))throw Error('Invalid baseline');prior.set(r.productId,r);}
 for(const r of review.items){if(!object(r)||!id(r.equipmentId)||r.portalId!=='224643'||current.has(r.equipmentId)||!label(r.name)||!(r.active===null||typeof r.active==='boolean'))throw Error('Invalid source');current.set(r.equipmentId,r);}
 const added:string[]=[],missing:string[]=[],renamed:string[]=[],customerChanged:string[]=[],inactive:string[]=[];
 for(const [key,row] of current){const before=prior.get(key);if(!before)added.push(key);else{if(row.name.trim()!==before.unitNumber.trim())renamed.push(key);if(row.customerId!==before.customerId&&row.serviceLocationId!==before.customerId)customerChanged.push(key);}if(row.active===false)inactive.push(key);}
 for(const key of prior.keys())if(!current.has(key))missing.push(key);
 return {contract:'COS_MHELP_INVENTORY_COMPARISON_V1',portalId:'224643',complete:true,baselineSourceSha256:baseline.sourceSha256,baselineRecords:prior.size,liveRecords:current.size,
  changes:{added:added.length,missing:missing.length,renamed:renamed.length,customerIdentityChanged:customerChanged.length,inactive:inactive.length},
  productIds:{added,missing,renamed,customerIdentityChanged:customerChanged,inactive},
  labelPaddingDifferences:review.items.filter((r:Row)=>prior.get(r.equipmentId)?.unitNumber===r.name.trim()&&r.name!==r.name.trim()).length,
  labelDifferences:renamed.map(key=>({productId:key,before:prior.get(key)!.unitNumber,after:current.get(key)!.name,hasReviewedBinding:!!prior.get(key)!.binding})),
  assignmentDifferences:customerChanged.map(key=>({productId:key,unitNumber:prior.get(key)!.unitNumber,beforeCustomerId:prior.get(key)!.customerId,afterCustomerId:current.get(key)!.customerId,serviceLocationId:current.get(key)!.serviceLocationId})),
  equipmentTypes:[...new Set(review.items.map((r:Row)=>r.equipmentTypeId))].sort(),
  samples:review.items.slice(0,4).map((r:Row)=>({productId:r.equipmentId,name:r.name,model:typeof r.model==='string'?r.model.slice(0,180):null,equipmentTypeId:r.equipmentTypeId,customerId:r.customerId,serviceLocationId:r.serviceLocationId})),
  inventoryWrites:0};
}
export function createInventoryComparisonHandler(options:{authenticate:(req:Request)=>Promise<boolean>;readEquipment:()=>Promise<any>;readBaseline:()=>Promise<any>;readSource?:(review:Row,baseline:Row)=>Promise<any>;writeSource?:(action:'stage'|'run',source:Row,baseline:Row)=>Promise<any>;status?:()=>Promise<any>;recordFailure?:()=>Promise<unknown>}){
 return async(req:Request)=>{
  const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(req.method!=='POST'||new URL(req.url).search||req.headers.has('origin'))return reply({error:'Scheduled request required'},405);
  try{if(!await options.authenticate(req))return reply({error:'Forbidden'},403);}catch{return reply({error:'Forbidden'},403);}
  let action:string;
  try{if(!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))throw Error();const reader=req.body?.getReader();if(!reader)throw Error();let bytes=0,body='';const decoder=new TextDecoder('utf-8',{fatal:true});try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>64)throw Error();body+=decoder.decode(r.value,{stream:true});}body+=decoder.decode();}finally{void reader.cancel().catch(()=>{});}const v=JSON.parse(body);if(!object(v)||Object.keys(v).length!==1||!['compare','preview','stage','run','status'].includes(v.action))throw Error();action=v.action;}catch{return reply({error:'Invalid request'},400);}
  try{if(action==='status'){if(!options.status)throw Error();return reply(await options.status());}const review=await options.readEquipment(),baseline=await options.readBaseline();const comparison=compareInventoryEquipment(review,baseline);if(action==='compare')return reply(comparison);
   if(!options.readSource)throw Error();const source=await options.readSource(review,baseline);const old=new Map<string,Row>(baseline.records.map((r:Row)=>[r.productId,r]));
   const addresses=source.records.filter((r:Row)=>['street','city','state','zip'].some(k=>r.sourceAddress[k]!==old.get(r.productId)?.sourceAddress?.[k]));
   if(action==='stage'||action==='run'){if(!options.writeSource)throw Error();return reply(await options.writeSource(action,source,baseline));}
   return reply({...comparison,sourcePreview:{readAt:source.readAt,complete:source.complete,summary:source.summary,sourceReads:source.sourceReads,addressDifferences:addresses.length,addressDifferenceProductIds:addresses.map((r:Row)=>r.productId)}});
  }catch(cause){if(action==='run'&&options.recordFailure)await options.recordFailure().catch(()=>{});const allowed=['Equipment customer unavailable','Customer identity unavailable','Equipment service identity unavailable','Service membership unavailable','Service portal unavailable','Equipment category needs review','Equipment changed during source read','Shop identities unavailable','Unsafe source field','Incomplete equipment categories','Invalid equipment category','Incomplete service inventory','Incomplete service page','Duplicate service identity'];return reply({error:'Complete mHelpDesk inventory comparison unavailable',inventoryWrites:0,...(cause instanceof Error&&(allowed.includes(cause.message)||/^source_http_[1-5][0-9]{2}_(customers|service_locations|equipment_categories)$/.test(cause.message))?{reason:cause.message}:{})},503);}
 };
}
