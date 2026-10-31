/** Native-only pending requests. There is deliberately no Sheets transport,
 * credential access, publication worker, or source/fleet mutation in this module. */
export const UNIT_TRACKER_CONTRACT='COS_UNIT_TRACKER_OUTBOX_V1';
export const UNIT_TRACKER_WORKBOOK='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
export const UNIT_TRACKER_CONNECTOR=Object.freeze({enabled:false,state:'awaiting_sheets_connection'});
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const fields=['placement','street','city','state','zip','siteLabel','customerLabel'];
const limits:Record<string,number>={street:300,city:120,state:2,zip:10,siteLabel:250,customerLabel:250};
const unsafe=/[\x00-\x1f\x7f<>@=]|^[+\-]|https?:|password|passwd|passcode|lockbox|\bpwd\b|\bpin\b|token|secret|credential|\b(?:call|phone|mobile|email|contact|tel)\b|gate[\s-]*code|access[\s-]*code|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b\d{3}[ .-]?\d{3}[ .-]?\d{4}\b/i;
const safeText=(v:unknown,max:number)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=max&&!unsafe.test(v);
export class UnitTrackerError extends Error {constructor(message:string,public status=400){super(message);this.name='UnitTrackerError';}}
function fail(message:string,status=400):never {throw new UnitTrackerError(message,status);}
function exact(v:unknown,keys:string[],required=keys):v is Row {
 return object(v)&&Object.keys(v).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(v,k));
}
export function checkedTrackerChanges(value:unknown,full=false):Row {
 if(!exact(value,fields,full?fields:[])||!full&&Object.keys(value).length===0)fail('Choose at least one supported tracker field.');
 for(const [key,v] of Object.entries(value)){
  if(key==='placement'){if(!['FIELD','SHOP','INACTIVE'].includes(v))fail('Choose a valid placement.');continue;}
  if(v===null)continue;
  if(!safeText(v,limits[key])||key==='state'&&!/^[A-Z]{2}$/.test(v)||key==='zip'&&!/^\d{5}(?:-\d{4})?$/.test(v))fail('Use plain non-secret tracker fields; formulas, links, IPs and credentials are not accepted.');
 }
 return {...value};
}
export function checkedTrackerProposal(value:unknown,isNew=false):Row {const fields=checkedTrackerChanges(value,true);if(fields.placement==='FIELD'&&(!fields.street||!fields.state||!fields.city&&!fields.zip))fail('A field unit needs a street, state, and city or ZIP.');if(isNew&&fields.placement!=='FIELD'&&['street','city','state','zip'].some(key=>fields[key]!==null))fail('New Shop or Inactive units must not include a field installation address.');return fields;}
function checkedIdentity(v:unknown,source=false):Row {
 const keys=source?['unitId','family','fullVariant','unitLabel','sourceRecordId']:['family','fullVariant','unitLabel'];
 if(!exact(v,keys)||!safeText(v.family,160)||!safeText(v.fullVariant,160)||!/[A-Za-z]/.test(v.fullVariant)
  ||!/^[A-Za-z][A-Za-z0-9 ._&/-]{0,159}$/.test(v.family)||!/^[A-Za-z][A-Za-z0-9 ._-]{0,159}$/.test(v.fullVariant)
  ||!safeText(v.unitLabel,40)||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(v.unitLabel))fail('Choose the exact family, full variant and unit label.');
 if(source&&!(v.unitId===null&&v.sourceRecordId===null||uuid(v.unitId)&&typeof v.sourceRecordId==='string'
  &&v.sourceRecordId.split(':').length===4&&v.sourceRecordId.split(':')[0]==='google_sheet'&&v.sourceRecordId.split(':')[1]===UNIT_TRACKER_WORKBOOK
  &&/^(0|[1-9][0-9]{0,18})$/.test(v.sourceRecordId.split(':')[2])&&v.sourceRecordId.split(':')[3]===v.fullVariant+'|'+v.unitLabel))fail('The tracker source identity could not be verified.',503);
 return {...v};
}
export function checkedTrackerRequest(body:unknown):Row {
 if(!object(body)||!uuid(body.requestId)||!['add','update'].includes(body.kind))fail('A unique tracker request identifier and request type are required.');
 const changes=checkedTrackerChanges(body.changes);
 if(body.kind==='add'){
  if(!exact(body,['requestId','kind','identity','changes']))fail('The add request contains unsupported fields.');
  const identity=checkedIdentity(body.identity);
  if(!Object.hasOwn(changes,'placement')||changes.placement==='FIELD'&&(!changes.street||!changes.state||!changes.city&&!changes.zip))fail('A new field unit needs a street, state, and city or ZIP.');
  return {requestId:body.requestId.toLowerCase(),kind:'add',identity,changes};
 }
 if(!exact(body,['requestId','kind','unitId','expectedSourceRevision','changes'])||!uuid(body.unitId)||!uuid(body.expectedSourceRevision))fail('An exact source unit and current revision are required.');
 return {requestId:body.requestId.toLowerCase(),kind:'update',unitId:body.unitId.toLowerCase(),expectedSourceRevision:body.expectedSourceRevision.toLowerCase(),changes};
}
function connector(v:unknown){if(!exact(v,['enabled','state'])||v.enabled!==false||v.state!=='awaiting_sheets_connection')fail('The Sheets connector state is not safe.',503);return {...UNIT_TRACKER_CONNECTOR};}
export function checkedTrackerSource(v:unknown):Row {
 if(!object(v)||!uuid(v.unitId)||!uuid(v.sourceRevision)||!(v.pendingRequestId===null||uuid(v.pendingRequestId))||!exact(v.sourceIdentity,['sourceSystem','sourceRecordId'])||v.sourceIdentity.sourceSystem!=='google_sheet_tracker')fail('The tracker source is incomplete.',503);
 const identity=checkedIdentity({unitId:v.unitId,family:v.family,fullVariant:v.fullVariant,unitLabel:v.unitLabel,sourceRecordId:v.sourceIdentity.sourceRecordId},true);
 return {unitId:identity.unitId,sourceRevision:v.sourceRevision,sourceIdentity:{...v.sourceIdentity},family:identity.family,fullVariant:identity.fullVariant,unitLabel:identity.unitLabel,fields:checkedTrackerChanges(v.fields,true),pendingRequestId:v.pendingRequestId};
}
function checkedReceipt(v:unknown):Row {
 if(!object(v)||!uuid(v.requestId)||!['add','update'].includes(v.kind)||v.status!=='awaiting_sheets_connection'
  ||typeof v.createdAt!=='string'||!Number.isFinite(Date.parse(v.createdAt))
  ||!(v.kind==='add'&&v.expectedSourceRevision===null||v.kind==='update'&&uuid(v.expectedSourceRevision)))fail('The persisted tracker request could not be verified.',503);
 const identity=checkedIdentity(v.identity,true),changes=checkedTrackerChanges(v.changes),before=v.kind==='add'?null:checkedTrackerChanges(v.before,true);
 if(v.kind==='add'&&(identity.unitId!==null||identity.sourceRecordId!==null||v.before!==null)||v.kind==='update'&&identity.unitId===null)fail('The persisted tracker binding could not be verified.',503);
 const proposed=checkedTrackerProposal(v.proposed,v.kind==='add');
 for(const k of fields){if(proposed[k]!== (Object.hasOwn(changes,k)?changes[k]:before?.[k]??null))fail('The persisted tracker changes do not match the receipt.',503);}
 return {requestId:v.requestId,kind:v.kind,status:v.status,createdAt:v.createdAt,identity,expectedSourceRevision:v.expectedSourceRevision,changes,before,proposed};
}
export function checkedTrackerSnapshot(v:unknown):Row {
 if(!object(v)||v.contract!==UNIT_TRACKER_CONTRACT||v.workbookId!==UNIT_TRACKER_WORKBOOK||typeof v.queueEnabled!=='boolean'
  ||!Array.isArray(v.sources)||v.sources.length>2000||!Array.isArray(v.requests)||v.requests.length>100
  ||typeof v.sourcesTruncated!=='boolean'||typeof v.requestsTruncated!=='boolean'||!Number.isInteger(v.sourcesHeld)||v.sourcesHeld<0)fail('The tracker queue is unavailable. No request has been saved.',503);
 const sources=v.sources.map(checkedTrackerSource),requests=v.requests.map(checkedReceipt);
 if(new Set(sources.map(s=>s.unitId)).size!==sources.length||new Set(requests.map(r=>r.requestId)).size!==requests.length)fail('The tracker snapshot contains conflicting identifiers.',503);
 return {contract:UNIT_TRACKER_CONTRACT,workbookId:UNIT_TRACKER_WORKBOOK,connector:connector(v.connector),queueEnabled:v.queueEnabled,
  availability:'available',sources,requests,sourcesTruncated:v.sourcesTruncated,requestsTruncated:v.requestsTruncated,sourcesHeld:v.sourcesHeld};
}
export function createUnitTracker(options:{rpc:(name:string,args:Row)=>Promise<unknown>;actorPayload:Row}){
 return async(path:string,method:string,body:unknown)=>{
  const requestRead=/^\/api\/unit-tracker\/requests\/([a-f0-9-]+)$/i.exec(path);
  if(method==='GET'&&requestRead){if(!uuid(requestRead[1]))fail('An exact tracker request identifier is required.');const value=await options.rpc('cos_unit_tracker_request_read',{...options.actorPayload,p_request_id:requestRead[1]});if(!object(value)||typeof value.ownedByCurrentActor!=='boolean')fail('The exact request status is unavailable.',503);const request=value.request===null?null:checkedReceipt(value.request);if(request&&request.requestId!==requestRead[1].toLowerCase()||!request&&value.ownedByCurrentActor!==false)fail('The exact request status could not be verified.',503);return {request,ownedByCurrentActor:value.ownedByCurrentActor,connector:connector(value.connector)};}
  const read=/^\/api\/unit-tracker\/([a-f0-9-]+)$/i.exec(path);
  if(method==='GET'&&path==='/api/unit-tracker'){
   let result;
   try{result=await options.rpc('cos_unit_tracker_snapshot',options.actorPayload);}
   catch(error:any){
    if([401,403].includes(error?.status))throw error;
    return {contract:UNIT_TRACKER_CONTRACT,workbookId:UNIT_TRACKER_WORKBOOK,connector:{...UNIT_TRACKER_CONNECTOR},queueEnabled:false,
     availability:'unavailable',reason:'Pending tracker requests are not enabled on this backend. Sheets connection required.',sources:[],requests:[],sourcesTruncated:false,requestsTruncated:false,sourcesHeld:0};
   }
   return checkedTrackerSnapshot(result);
  }
  if(method==='GET'&&read){
   if(!uuid(read[1]))fail('A stable unit identifier is required.');
   const v=await options.rpc('cos_unit_tracker_read',{...options.actorPayload,p_native_unit_id:read[1]});
   if(!object(v)||v.contract!==UNIT_TRACKER_CONTRACT||v.workbookId!==UNIT_TRACKER_WORKBOOK||typeof v.queueEnabled!=='boolean')fail('The current tracker record is unavailable.',503);
   const source=checkedTrackerSource(v);
   if(source.unitId!==read[1].toLowerCase())fail('The tracker source changed. Reload before editing.',409);
   const pendingRequest=v.pendingRequest===null?null:checkedReceipt(v.pendingRequest);
   if(source.pendingRequestId!==(pendingRequest?.requestId??null)||pendingRequest&&(pendingRequest.kind!=='update'||pendingRequest.identity.unitId!==source.unitId))fail('The selected pending request could not be verified. Reload before editing.',503);
   return {...source,contract:UNIT_TRACKER_CONTRACT,workbookId:UNIT_TRACKER_WORKBOOK,queueEnabled:v.queueEnabled,connector:connector(v.connector),pendingRequest};
  }
  if(method==='POST'&&path==='/api/unit-tracker/requests'){
   const payload=checkedTrackerRequest(body);
   const result=await options.rpc('cos_unit_tracker_enqueue',{...options.actorPayload,p_request:payload});
   if(!object(result)||typeof result.created!=='boolean'||result.ownedByCurrentActor!==true)fail('The save response was incomplete. Retry with the same request identifier.',503);
   const request=checkedReceipt(result.request);
   // JSONB object order is not significant. Bind the whole exact-field patch.
   if(request.requestId!==payload.requestId||request.kind!==payload.kind||Object.keys(request.changes).length!==Object.keys(payload.changes).length
     ||Object.keys(payload.changes).some(k=>request.changes[k]!==payload.changes[k]))fail('The saved request could not be matched. Retry with the same request identifier.',503);
   if(payload.kind==='update'&&(request.identity.unitId!==payload.unitId||request.expectedSourceRevision!==payload.expectedSourceRevision)
     ||payload.kind==='add'&&['family','fullVariant','unitLabel'].some(k=>request.identity[k]!==payload.identity[k]))fail('The saved request identity could not be matched.',503);
   return {created:result.created,request,ownedByCurrentActor:true,connector:connector(result.connector)};
  }
  fail('Unit Tracker endpoint not found.',404);
 };
}
