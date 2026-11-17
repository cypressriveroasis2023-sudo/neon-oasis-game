import {validateEvidenceRefresh,evidenceRefreshSelection,evidenceRefreshReceipt,type EvidenceRefresh} from './manualRefresh.ts';
/** Complete-source comparison. Vendor/credential objects never enter responses. */
import {InventoryCacheMembershipError} from './cache.ts';
import {classifyMhelpPartnerDiagnostic,MhelpPartnerError,MhelpPartnerReadDeadlineError} from '../cos-operations-pages/mhelpPartner.ts';
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Closed partner-preview facts only. Never the message, URL, body, or token. */
export function partnerPreviewDiagnostic(cause:unknown):{providerOperation:'account_read'|'equipment_read';httpStatus:number}|undefined{
 if(!(cause instanceof MhelpPartnerError)||cause instanceof MhelpPartnerReadDeadlineError)return;
 const operation=cause.provider?.operation,httpStatus=cause.provider?.httpStatus;
 if(operation!=='account_read'&&operation!=='equipment_read')return;
 if(!Number.isInteger(httpStatus)||httpStatus<100||httpStatus>599)return;
 return {providerOperation:operation,httpStatus};
}
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
// Sanitized, secret-free failure class for logs and the 503 body. The persisted
// control-row code is deliberately unchanged (the RPC collapses it anyway).
export function classifyInventoryFailure(cause:unknown):string{
  if(cause instanceof MhelpPartnerReadDeadlineError)return 'equipment_pass_deadline';
  if(cause instanceof MhelpPartnerError&&cause.provider){const h=cause.provider.httpStatus;return h===401||h===403?'mhelp_auth_rejected':h===429?'mhelp_rate_limited':'mhelp_http_'+(Number.isInteger(h)&&h>=100&&h<=599?h:'unknown');}
  const diagnostic=classifyMhelpPartnerDiagnostic(cause);if(diagnostic)return diagnostic;
 const message=cause instanceof Error?cause.message:'';
  const http=/^source_http_([1-5][0-9]{2})_(customers|service_locations|equipment_categories)$/.exec(message);
  if(http)return http[1]==='401'||http[1]==='403'?'mhelp_auth_rejected_'+http[2]:'mhelp_http_'+http[1]+'_'+http[2];
  const name=(cause as {name?:unknown})?.name;
  if(name==='TimeoutError'||name==='AbortError')return 'timeout';
  const setup:Record<string,string>={'Token storage unavailable':'setup_token_storage','Request allowance unavailable':'setup_request_allowance','Stored access unavailable':'setup_stored_access','Source unavailable':'setup_source_config','Backend unavailable':'setup_backend','Cache unavailable':'setup_cache','Read unavailable':'setup_read','Read authority unavailable':'setup_read_authority'};
  if(Object.hasOwn(setup,message))return setup[message];
  return 'unclassified';
}
export function createInventoryComparisonHandler(options:{authenticate:(req:Request)=>Promise<boolean>;readEquipment:()=>Promise<any>;readBaseline:()=>Promise<any>;readSource?:(review:Row,baseline:Row,refreshEquipmentIds?:string[])=>Promise<any>;writeSource?:(action:'stage'|'run',source:Row,baseline:Row)=>Promise<any>;publishAfterCommit?:(req:Request,receipt:Row)=>Promise<Row>;status?:()=>Promise<any>;acquireRead?:()=>Promise<Row>;releaseRead?:(lease:string)=>Promise<unknown>;recordFailure?:(code:'inventory_source_unavailable'|'source_rate_limited')=>Promise<unknown>}){
 return async(req:Request)=>{
  const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(req.method!=='POST'||new URL(req.url).search||req.headers.has('origin'))return reply({error:'Scheduled request required'},405);
  try{if(!await options.authenticate(req))return reply({error:'Forbidden'},403);}catch{return reply({error:'Forbidden'},403);}
  let action:string;let refresh:EvidenceRefresh|undefined;
  try{if(!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))throw Error();const reader=req.body?.getReader();if(!reader)throw Error();let bytes=0,body='';const decoder=new TextDecoder('utf-8',{fatal:true});try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>512)throw Error();body+=decoder.decode(r.value,{stream:true});}body+=decoder.decode();}finally{void reader.cancel().catch(()=>{});}const v=JSON.parse(body);if(!object(v))throw Error();if(v.action==='refresh')refresh=validateEvidenceRefresh(v);else if(Object.keys(v).length!==1||!['compare','preview','stage','run','status'].includes(v.action))throw Error();action=v.action;}catch{return reply({error:'Invalid request'},400);}
  let readLease:string|null=null;
  // Fixed stage names and exact static reasons only; never serialize a cause.
  let failureStage='read_authority';
  try{if(action==='status'){failureStage='status';if(!options.status)throw Error();return reply(await options.status());}
   if(refresh&&(!options.acquireRead||!options.releaseRead))throw Error('Read authority unavailable');
   if(options.acquireRead){const gate=await options.acquireRead();if(!object(gate)||typeof gate.allowed!=='boolean')throw Error('Read authority unavailable');
    if(!gate.allowed){if(gate.reason==='inventory_paused'&&gate.retryAt===null)return reply({state:'paused',reason:'inventory_paused',sourceRefreshed:false,inventoryWrites:0},202);if(!['source_rate_limited','inventory_read_in_progress'].includes(gate.reason)||typeof gate.retryAt!=='string'||!Number.isFinite(Date.parse(gate.retryAt)))throw Error('Read authority unavailable');return reply({state:'deferred',reason:gate.reason,retryAt:gate.retryAt,sourceRefreshed:false,inventoryWrites:0},202);}
    if(typeof gate.leaseId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(gate.leaseId))throw Error('Read authority unavailable');readLease=gate.leaseId;
   }
   failureStage='equipment';const review=await options.readEquipment();
   failureStage='baseline';const baseline=await options.readBaseline();
   failureStage='comparison';const comparison=compareInventoryEquipment(review,baseline);if(action==='compare')return reply(comparison);
   const refreshStartedAt=Date.now();failureStage='resources';if(!options.readSource)throw Error();const selected=refresh?evidenceRefreshSelection(refresh,review,baseline):undefined;const source=await options.readSource(review,baseline,selected);const old=new Map<string,Row>(baseline.records.map((r:Row)=>[r.productId,r]));
   const addresses=source.records.filter((r:Row)=>['street','city','state','zip'].some(k=>r.sourceAddress[k]!==old.get(r.productId)?.sourceAddress?.[k]));
   if(action==='stage'||action==='run'){failureStage='write';if(!options.writeSource)throw Error();const receipt=await options.writeSource(action,source,baseline);if(action==='run'&&object(receipt)&&receipt.state==='current'&&receipt.sourceActivated===true&&options.publishAfterCommit){let trackerPublish:Row;try{trackerPublish=await options.publishAfterCommit(req,receipt);}catch{trackerPublish={state:'failed'};}return reply({...receipt,trackerPublish});}return reply(receipt);}
   return reply({...comparison,...(refresh?{evidenceRefresh:evidenceRefreshReceipt(refresh,source,refreshStartedAt)}:{}),sourcePreview:{readAt:source.readAt,complete:source.complete,summary:source.summary,sourceReads:source.sourceReads,addressDifferences:addresses.length,addressDifferenceProductIds:addresses.map((r:Row)=>r.productId)}});
  }catch(cause){const failureClass=classifyInventoryFailure(cause);if(action==='run')console.error('inventory_source_failure',failureStage,failureClass);const limited=(cause as Row)?.status===429||cause instanceof Error&&/^source_http_429_/.test(cause.message);if(action==='run'&&options.recordFailure)await options.recordFailure(limited?'source_rate_limited':'inventory_source_unavailable').catch(()=>{});const allowed=['Equipment customer unavailable','Customer identity unavailable','Equipment service identity unavailable','Service membership unavailable','Service portal unavailable','Equipment category needs review','Equipment changed during source read','Shop identities unavailable','Unsafe source field','Incomplete equipment categories','Invalid equipment category','Incomplete service inventory','Incomplete service page','Duplicate service identity','Unsupported inventory cache path','Invalid inventory cache response','Invalid cached customer identity','Invalid cached categories','Incomplete cached service page','Invalid cached service membership','Inventory cache unavailable','Invalid resource observation','Inventory cache save is unconfirmed','Resource observation unavailable'];return reply({error:'Complete mHelpDesk inventory comparison unavailable',inventoryWrites:0,failureStage,failureClass,...partnerPreviewDiagnostic(cause),...(cause instanceof MhelpPartnerReadDeadlineError?{reason:'equipment_pass_deadline_exceeded'}:{}),...(cause instanceof InventoryCacheMembershipError?{cacheMembership:cause.diagnostic}:{}),...(cause instanceof Error&&(allowed.includes(cause.message)||/^source_http_[1-5][0-9]{2}_(customers|service_locations|equipment_categories)$/.test(cause.message))?{reason:cause.message}:{})},503);}
  finally{if(readLease&&options.releaseRead)await options.releaseRead(readLease).catch(()=>{});}
 };
}
