import {checkedTrackerRequest as checkedPendingRequestInput,checkedTrackerSource as checkedPendingSource} from '../../supabase/functions/cos-operations-pages/unitTracker';
export const addressUuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
import { validInstallation } from '../../supabase/functions/cos-operations-pages/importedAddressContract';

export const trackerWorkbookId = '1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA';
export const trackerContract = 'COS_UNIT_TRACKER_OUTBOX_V1';
export type TrackerFields = { placement: 'FIELD'|'SHOP'|'INACTIVE'; street: string|null; city: string|null; state: string|null; zip: string|null; siteLabel: string|null; customerLabel: string|null };
export type TrackerIdentity = { family: string; fullVariant: string; unitLabel: string };
export type TrackerSource = TrackerIdentity & { unitId:string; sourceRevision:string; pendingRequestId:string|null; sourceIdentity:{sourceSystem:'google_sheet_tracker';sourceRecordId:string}; fields:TrackerFields };
export type TrackerRequest = { requestId:string; kind:'add'|'update'; status:'awaiting_sheets_connection'; createdAt:string; identity:TrackerIdentity & {unitId:string|null;sourceRecordId:string|null}; expectedSourceRevision:string|null; changes:Partial<TrackerFields>; before:TrackerFields|null; proposed:TrackerFields };
export type TrackerSnapshot = { contract:typeof trackerContract; workbookId:string; connector:{enabled:false;state:'awaiting_sheets_connection'}; queueEnabled:boolean; sources:TrackerSource[]; requests:TrackerRequest[]; sourcesTruncated?:boolean;requestsTruncated?:boolean;sourcesHeld?:number;availability?:string;reason?:string };
export type TrackerDraft = TrackerIdentity & { placement:TrackerFields['placement']; street:string;city:string;state:string;zip:string;siteLabel:string;customerLabel:string };
export type TrackerInventory = { id:string;unitNumber:string;modelName:string;placement:string;site:string;customer:string;address:string;readOnly:boolean;source:TrackerSource|null; pending:number };
type Row=Record<string,unknown>;
const object=(value:unknown):value is Row=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const safe=(value:unknown,max=250):value is string=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f<>]/.test(value);
const fieldKeys=['placement','street','city','state','zip','siteLabel','customerLabel'] as const;
export const trackerFieldLabels:Record<keyof TrackerFields,string>={placement:'Placement',street:'Street',city:'City',state:'State',zip:'ZIP',siteLabel:'Site label',customerLabel:'Customer'};
const fieldValue=(key:string,value:unknown)=>key==='placement'?['FIELD','SHOP','INACTIVE'].includes(String(value)):value===null||safe(value,key==='street'?300:250);
const fields=(value:unknown,partial=false):value is TrackerFields=>object(value)&&Object.keys(value).every(key=>fieldKeys.includes(key as keyof TrackerFields)&&fieldValue(key,value[key]))&&(partial||fieldKeys.every(key=>Object.hasOwn(value,key)));
const identity=(value:unknown):value is TrackerIdentity & Row=>object(value)&&['family','fullVariant','unitLabel'].every(key=>safe(value[key],160)&&Boolean((value[key] as string).trim()));
export function trackerAccess(session:unknown):boolean {return object(session)&&session.authorized===true&&['Owner','IT'].includes(String(session.role))&&object(session.features)&&session.features.unitTracker===true;}
export function checkedTrackerSource(value:unknown):TrackerSource {
 checkedPendingSource(value);
 if(!identity(value)||!addressUuid(value.unitId)||!addressUuid(value.sourceRevision)||!(value.pendingRequestId===null||addressUuid(value.pendingRequestId))||!object(value.sourceIdentity)||value.sourceIdentity.sourceSystem!=='google_sheet_tracker'||!safe(value.sourceIdentity.sourceRecordId,400)||!value.sourceIdentity.sourceRecordId.startsWith('google_sheet:'+trackerWorkbookId+':')||!fields(value.fields))throw new Error('The tracker source could not be verified. Refresh before editing.');
 return value as TrackerSource;
}
export function checkedTrackerRequest(value:unknown):TrackerRequest {
 if(!object(value)||!addressUuid(value.requestId)||!['add','update'].includes(String(value.kind))||value.status!=='awaiting_sheets_connection'||!safe(value.createdAt,60)||!Number.isFinite(Date.parse(value.createdAt))||!identity(value.identity)||!fields(value.changes,true)||Object.keys(value.changes).length===0||!(value.before===null||fields(value.before))||!(value.expectedSourceRevision===null||addressUuid(value.expectedSourceRevision)))throw new Error('The saved tracker request could not be verified. Refresh the tracker before trying again.');
 const id=value.identity as unknown as Row;
 if(value.kind==='add'?(id.unitId!==null||id.sourceRecordId!==null||value.expectedSourceRevision!==null||value.before!==null):(!addressUuid(id.unitId)||!safe(id.sourceRecordId,400)||!id.sourceRecordId.startsWith('google_sheet:'+trackerWorkbookId+':')||!addressUuid(value.expectedSourceRevision)||!fields(value.before)))throw new Error('The saved request identity could not be verified.');
 if(!fields(value.proposed))throw new Error('The proposed tracker values are incomplete.');
 for(const key of fieldKeys){if(value.proposed[key]!== (Object.hasOwn(value.changes,key)?value.changes[key]:value.before?.[key]??null))throw new Error('The proposed tracker values do not match the saved request.');}
 return value as TrackerRequest;
}
export function checkedTrackerDetail(value:unknown):TrackerSource & {pendingRequest:TrackerRequest|null;queueEnabled:boolean} {
 const source=checkedTrackerSource(value);if(!object(value)||typeof value.queueEnabled!=='boolean')throw new Error('Tracker request availability could not be verified.');
 const pending=value.pendingRequest===null?null:checkedTrackerRequest(value.pendingRequest);
 if(pending?.requestId!==source.pendingRequestId&&(pending!==null||source.pendingRequestId!==null)||pending&&pending.identity.unitId!==source.unitId)throw new Error('The pending tracker request does not match this exact unit.');
 return {...source,pendingRequest:pending,queueEnabled:value.queueEnabled};
}
export function checkedTrackerSnapshot(value:unknown):TrackerSnapshot {
 if(!object(value)||value.contract!==trackerContract||value.workbookId!==trackerWorkbookId||!object(value.connector)||value.connector.enabled!==false||value.connector.state!=='awaiting_sheets_connection'||typeof value.queueEnabled!=='boolean'||!Number.isInteger(value.sourcesHeld)||Number(value.sourcesHeld)<0||!Array.isArray(value.sources)||!Array.isArray(value.requests)||value.sources.length>2000||value.requests.length>100||['sourcesTruncated','requestsTruncated'].some(key=>value[key]!==undefined&&typeof value[key]!=='boolean'))throw new Error('Unit Tracker returned an incomplete response. Refresh to verify its status.');
 const sources=value.sources.map(checkedTrackerSource),requests=value.requests.map(checkedTrackerRequest);
 if(new Set(sources.map(row=>row.unitId)).size!==sources.length||new Set(requests.map(row=>row.requestId)).size!==requests.length)throw new Error('Unit Tracker returned conflicting identities. Refresh before editing.');
 return {...value,sources,requests} as TrackerSnapshot;
}
export function trackerInventory(value:unknown,sources:TrackerSource[],requests:TrackerRequest[]):TrackerInventory[] {
 if(!object(value)||!Array.isArray(value.inventoryItems)||value.inventoryItems.some(row=>!object(row)||!addressUuid(row.id)||!safe(row.unitNumber,200)))throw new Error('The current COS inventory could not be verified.');
 const seen=new Set<string>(),byId=new Map(sources.map(row=>[row.unitId,row]));
 return value.inventoryItems.map(raw=>{
  const row=raw as Row,id=row.id as string;if(seen.has(id))throw new Error('The current COS inventory contains a duplicate unit identity.');seen.add(id);
  const source=byId.get(id)||null;
  return {id,unitNumber:row.unitNumber as string,modelName:safe(row.modelName,200)?row.modelName:source?.fullVariant||'',placement:String(row.placement||row.importedPlacement||row.currentLocationType||row.status||'UNKNOWN').toUpperCase(),site:safe(row.site)?row.site:'',customer:safe(row.customer)?row.customer:'',address:safe(row.address,700)?row.address:'',readOnly:row.readOnly===true,source,pending:source?.pendingRequestId?1:requests.filter(request=>request.identity.unitId===id).length};
 });
}
export function newTrackerDraft():TrackerDraft{return {family:'',fullVariant:'',unitLabel:'',placement:'SHOP',street:'',city:'',state:'',zip:'',siteLabel:'',customerLabel:''};}
export function trackerDraft(source:TrackerSource):TrackerDraft {return {family:source.family,fullVariant:source.fullVariant,unitLabel:source.unitLabel,...Object.fromEntries(Object.entries(source.fields).map(([key,value])=>[key,value??'']))} as TrackerDraft;}
export function trackerDraftValues(draft:TrackerDraft):TrackerFields{return {placement:draft.placement,street:draft.street.trim()||null,city:draft.city.trim()||null,state:draft.state.trim().toUpperCase()||null,zip:draft.zip.trim()||null,siteLabel:draft.siteLabel.trim()||null,customerLabel:draft.customerLabel.trim()||null};}
export function trackerChanges(draft:TrackerDraft,source:TrackerSource|null):Partial<TrackerFields>{const values=trackerDraftValues(draft);return Object.fromEntries(Object.entries(values).filter(([key,value])=>source?value!==source.fields[key as keyof TrackerFields]:key==='placement'||value!==null));}
export function trackerDraftProblem(draft:TrackerDraft,source:TrackerSource|null):string {
 const blocked=/[\u0000-\u001f\u007f<>@=]|https?:|password|passwd|passcode|token|secret|credential|lockbox|gate[ -]*code|access[ -]*code/i;
 if(!source&&(!draft.family.trim()||!draft.fullVariant.trim()||!draft.unitLabel.trim()))return 'Enter the family, full model / variant, and unit label.';
 if(['family','fullVariant','unitLabel','street','city','state','zip','siteLabel','customerLabel'].some(key=>blocked.test(draft[key as keyof TrackerDraft])||draft[key as keyof TrackerDraft].length>(key==='street'?300:key==='family'||key==='fullVariant'?160:250)))return 'Use equipment and installation details only. Leave out passwords, access codes, contact details, links, and formulas.';
 if(!['FIELD','SHOP','INACTIVE'].includes(draft.placement))return 'Choose Field, Shop, or Inactive.';
 const values=trackerDraftValues(draft);
 if(draft.placement==='FIELD'&&!validInstallation({street:values.street,city:values.city,state:values.state,zip:values.zip}))return 'Field units need a safe US street address, two-letter state, and city or ZIP.';
 if(!source&&draft.placement!=='FIELD'&&[values.street,values.city,values.state,values.zip].some(Boolean))return 'New Shop or Inactive units must not include a field installation address.';
 if(!Object.keys(trackerChanges(draft,source)).length)return 'No changed tracker fields to save.';
 try{checkedPendingRequestInput(rawTrackerPayload(draft,source,'00000000-0000-4000-8000-000000000000'));}catch(cause){return cause instanceof Error?cause.message:'Review the supported tracker fields.';}
 return '';
}
function rawTrackerPayload(draft:TrackerDraft,source:TrackerSource|null,requestId:string){const changes=trackerChanges(draft,source);return source?{requestId,kind:'update' as const,unitId:source.unitId,expectedSourceRevision:source.sourceRevision,changes}:{requestId,kind:'add' as const,identity:{family:draft.family.trim(),fullVariant:draft.fullVariant.trim(),unitLabel:draft.unitLabel.trim()},changes};}
export function checkedTrackerLookup(value:unknown,requestId:string):TrackerRequest|null {if(!object(value)||typeof value.ownedByCurrentActor!=='boolean'||!object(value.connector)||value.connector.enabled!==false||value.connector.state!=='awaiting_sheets_connection')throw new Error('The pending request status could not be verified.');const request=value.request===null?null:checkedTrackerRequest(value.request);if(request&&value.ownedByCurrentActor!==true)throw new Error('This request was saved by a different account. It cannot verify your save.');if(request&&request.requestId!==requestId)throw new Error('The returned request identity does not match.');return request;}
export function trackerRequestPayload(draft:TrackerDraft,source:TrackerSource|null,requestId:string,confirmed:boolean){
 if(!confirmed||!addressUuid(requestId))throw new Error('Review and confirm the pending tracker request.');
 const problem=trackerDraftProblem(draft,source);if(problem)throw new Error(problem);
 return rawTrackerPayload(draft,source,requestId);
}
export function trackerRequestMatches(request:TrackerRequest,payload:ReturnType<typeof trackerRequestPayload>):boolean {
 return request.requestId===payload.requestId&&request.kind===payload.kind&&JSON.stringify(Object.entries(request.changes).sort())===JSON.stringify(Object.entries(payload.changes).sort())&&(payload.kind==='update'?request.identity.unitId===payload.unitId&&request.expectedSourceRevision===payload.expectedSourceRevision:request.identity.family===payload.identity.family&&request.identity.fullVariant===payload.identity.fullVariant&&request.identity.unitLabel===payload.identity.unitLabel);
}
