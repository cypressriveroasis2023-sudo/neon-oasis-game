/** Structural-only appointment evidence. The public endpoint documents one
 * fixed date-window GET and fields projection, but publishes malformed models.
 * Candidate fields are never promoted into operational scheduling or assignment.
 * No network, writes, source mapping, staff lookup, or private values in this DTO.
 */
import {mhelpAppointmentPreviewWindow} from './mhelpTicketDay.ts';
export const MHELP_APPOINTMENT_EVIDENCE='appointment_structure_v1' as const;
export const MHELP_APPOINTMENT_PAGE_LIMIT=500;
export const MHELP_APPOINTMENT_FIELDS=['ID','TicketId','PortalId','UserId','StartUTC','EndUTC','TeamId','RecurrenceRule','RecurrenceParentID','RecurrenceStartUTC','RecurrenceEndUTC','TimeZone','AppointmentTimeZone','IsAllDay','LastUpdate','IsDeleted','IsHidden'] as const;
const CONTRACT='cos-mhelpdesk-appointment-evidence-v1' as const,SCOPE='single_ticket_seven_day_schedule_window' as const;
const KINDS=['absent','null','boolean','integer','number','string','array','object','other'] as const;
const FORMATS=['numeric','iso_with_zone','iso_without_zone','dotnet','other'] as const;
const REVIEW_KEYS=['deleted','hidden','team','recurrence','missingFlags','missingUser','invalidTime','invalidIdentity'] as const;
const ENVELOPE_KEYS=['rootKind','totalRowsKind','resultsKind','alternateTotalRowsKind','alternateTotalResultsKind','alternateDataKind'] as const;
type Kind=typeof KINDS[number];type Format=typeof FORMATS[number];type Counts<T extends string>=Partial<Record<T,number>>;
type FieldEvidence={kinds:Counts<Kind>;formats:Counts<Format>;emptyStrings:number;nonemptyStrings:number};
type Window=ReturnType<typeof mhelpAppointmentPreviewWindow>;
type Common={contract:typeof CONTRACT;scope:typeof SCOPE;window:Window};
type ReviewCounts=Record<typeof REVIEW_KEYS[number],number>;
type Completeness='complete'|'incomplete'|'unverified';
type Linkage='single_structural_match'|'no_match_in_window'|'ambiguous_matches'|'review_required'|'unverified';
export type MhelpAppointmentEvidence=Common&({state:'selection_unavailable';reason:'empty_window'|'ambiguous_window'}|{
 state:'window_reviewed';pageLimit:500;sampledAppointments:number;reportedTotal:number|null;completeness:Completeness;
 envelope:Record<typeof ENVELOPE_KEYS[number],Kind>;fields:Record<typeof MHELP_APPOINTMENT_FIELDS[number],FieldEvidence>;
 exactMatchCount:number;unverifiedLinkageCount:number;linkage:Linkage;reviewCounts:ReviewCounts;
 technician:'unresolved_no_staff_read';schedule:'unverified_candidate_contract';
});
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(row:unknown,key:string):unknown=>plain(row)&&Object.hasOwn(row,key)?row[key]:undefined;
function kind(value:unknown):Kind {
 if(value===undefined)return 'absent';if(value===null)return 'null';if(Array.isArray(value))return 'array';
 if(typeof value==='number')return Number.isSafeInteger(value)?'integer':'number';
 return ['boolean','string','object'].includes(typeof value)?typeof value as Kind:'other';
}
function format(value:string):Format {
 if(/^\d{1,16}$/.test(value))return 'numeric';
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value))return 'iso_with_zone';
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(value))return 'iso_without_zone';
 if(/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(value))return 'dotnet';return 'other';
}
function distribution<T extends string>(values:readonly unknown[],classify:(value:unknown)=>T):Counts<T> {
 const result:Counts<T>={};for(const value of values){const key=classify(value);result[key]=(result[key]||0)+1;}return result;
}
function field(values:readonly unknown[]):FieldEvidence {
 const strings=values.filter((value):value is string=>typeof value==='string'),emptyStrings=strings.filter(value=>!value.trim()).length;
 return {kinds:distribution(values,kind),formats:distribution(strings,value=>format(value as string)),emptyStrings,nonemptyStrings:strings.length-emptyStrings};
}
const positiveId=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
// The candidate public model says numeric IDs. Do not coerce a string into an identity match.
const absentRelation=(value:unknown)=>value===null||value===0||value==='';
function timestamp(value:unknown):number|null {
 if(typeof value!=='string'||value.length>40||format(value)!=='iso_with_zone'||!Number.isFinite(Date.parse(value)))return null;
 const [year,month,day]=value.slice(0,10).split('-').map(Number),[hour,minute,second]=value.slice(11,19).split(':').map(Number);
 if(hour>23||minute>59||second>59)return null;
 if(year<1900||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;
 return Date.parse(value);
}
function linkage(completeness:Completeness,exactMatches:number,unknown:number,review:ReviewCounts):Linkage {
 if(completeness!=='complete'||unknown>0)return 'unverified';
 if(exactMatches===0)return 'no_match_in_window';
 if(exactMatches>1)return 'ambiguous_matches';
 return Object.values(review).some(n=>n>0)?'review_required':'single_structural_match';
}
export function unavailableMhelpAppointments(totalTickets:number,createdAfter:string):MhelpAppointmentEvidence {
 return projectMhelpAppointmentEvidence({contract:CONTRACT,scope:SCOPE,window:mhelpAppointmentPreviewWindow(createdAfter),state:'selection_unavailable',reason:totalTickets===0?'empty_window':'ambiguous_window'},totalTickets,createdAfter);
}
/** The caller supplies only identities from its already verified singleton detail. */
export function describeMhelpAppointments(value:unknown,selected:{ticketId:string;portalId:string;deleted:boolean},createdAfter:string):MhelpAppointmentEvidence {
 const window=mhelpAppointmentPreviewWindow(createdAfter),rawRows=own(value,'results');
 if(Array.isArray(rawRows)&&rawRows.length>MHELP_APPOINTMENT_PAGE_LIMIT)throw Error('mHelpDesk returned an oversized appointment page.');
 const rows=Array.isArray(rawRows)?rawRows:[],rawTotal=own(value,'TotalRows');
 const reportedTotal=typeof rawTotal==='number'&&Number.isSafeInteger(rawTotal)&&rawTotal>=0&&rawTotal<=1000000?rawTotal:null;
 const envelope={rootKind:kind(value),totalRowsKind:kind(rawTotal),resultsKind:kind(rawRows),alternateTotalRowsKind:kind(own(value,'totalRows')),alternateTotalResultsKind:kind(own(value,'totalResults')),alternateDataKind:kind(own(value,'data'))};
 const validEnvelope=plain(value)&&Array.isArray(rawRows)&&reportedTotal!==null&&reportedTotal>=rows.length&&['totalRows','totalResults','data'].every(key=>!Object.hasOwn(value,key));
 const completeness:Completeness=!validEnvelope?'unverified':reportedTotal===rows.length?'complete':'incomplete';
 const fields=Object.fromEntries(MHELP_APPOINTMENT_FIELDS.map(key=>[key,field(rows.map(row=>own(row,key)))])) as Record<typeof MHELP_APPOINTMENT_FIELDS[number],FieldEvidence>;
 const reviewCounts=Object.fromEntries(REVIEW_KEYS.map(key=>[key,0])) as ReviewCounts;
 let exactMatchCount=0,unverifiedLinkageCount=0;
 for(const row of rows){
  const ticket=own(row,'TicketId'),portal=own(row,'PortalId');
  // An explicit null/zero ticket is an unlinked appointment. Missing/malformed
  // linkage or a foreign portal cannot prove that the ticket has no other match.
  if(!plain(row)||!positiveId(portal)||portal!==Number(selected.portalId)||(!(ticket===null||ticket===0)&&!positiveId(ticket))){unverifiedLinkageCount++;continue;}
  if(ticket!==Number(selected.ticketId))continue;
  exactMatchCount++;
  if(selected.deleted||own(row,'IsDeleted')===true)reviewCounts.deleted++;
  if(own(row,'IsHidden')===true)reviewCounts.hidden++;
  if(typeof own(row,'IsDeleted')!=='boolean'||typeof own(row,'IsHidden')!=='boolean')reviewCounts.missingFlags++;
  // Missing optional relation fields remain unverified; absence is not a proven
  // lack of recurrence or team assignment in this unpublished runtime shape.
  if(!absentRelation(own(row,'TeamId')))reviewCounts.team++;
  if(['RecurrenceRule','RecurrenceParentID','RecurrenceStartUTC','RecurrenceEndUTC'].some(key=>!absentRelation(own(row,key))))reviewCounts.recurrence++;
  const user=own(row,'UserId');if(typeof user!=='string'||!user.trim()||user.length>500||/[\x00-\x1f\x7f]/.test(user))reviewCounts.missingUser++;
  const start=timestamp(own(row,'StartUTC')),end=timestamp(own(row,'EndUTC'));
  if(start===null||end===null||end<=start||start<Date.parse(window.startDateUtc)||start>=Date.parse(window.endDateUtc)||own(row,'IsAllDay')!==false)reviewCounts.invalidTime++;
  if(!positiveId(own(row,'ID')))reviewCounts.invalidIdentity++;
 }
 return projectMhelpAppointmentEvidence({contract:CONTRACT,scope:SCOPE,window,state:'window_reviewed',pageLimit:MHELP_APPOINTMENT_PAGE_LIMIT,
  sampledAppointments:rows.length,reportedTotal,completeness,envelope,fields,exactMatchCount,unverifiedLinkageCount,
  linkage:linkage(completeness,exactMatchCount,unverifiedLinkageCount,reviewCounts),reviewCounts,technician:'unresolved_no_staff_read',schedule:'unverified_candidate_contract'},1,createdAfter);
}
/** Exact nested allowlists and recomputed states prevent source data or a forged
 * claim of safe scheduling crossing the preview boundary. */
export function projectMhelpAppointmentEvidence(value:unknown,totalTickets:number,createdAfter:string):MhelpAppointmentEvidence {
 const invalid=():never=>{throw Error('Unsupported mHelpDesk appointment evidence.');};
 const exact=(value:unknown,keys:readonly string[]):Record<string,unknown>=>{
  if(!plain(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))invalid();return value as Record<string,unknown>;
 };
 const integer=(value:unknown,max=MHELP_APPOINTMENT_PAGE_LIMIT):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)invalid();return value as number;};
 const counters=<T extends string>(value:unknown,keys:readonly T[],size:number):Counts<T>=>{
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key as T)))invalid();const source=value as Record<string,unknown>,result:Counts<T>={};
  for(const key of keys)if(Object.hasOwn(source,key)){const n=integer(source[key],size);if(n===0)invalid();result[key]=n;}
  if(Object.values(result).reduce((sum:number,n)=>sum+Number(n),0)!==size)invalid();return result;
 };
 integer(totalTickets);if(!plain(value))invalid();const row=value as Record<string,unknown>;
 if(row.contract!==CONTRACT||row.scope!==SCOPE)invalid();
 const window=mhelpAppointmentPreviewWindow(createdAfter),inputWindow=exact(row.window,Object.keys(window));
 for(const key of Object.keys(window) as (keyof Window)[])if(inputWindow[key]!==window[key])invalid();
 const base={contract:CONTRACT,scope:SCOPE,window};
 if(row.state==='selection_unavailable'){
  exact(row,['contract','scope','window','state','reason']);
  if(totalTickets===1||row.reason!==(totalTickets===0?'empty_window':'ambiguous_window'))invalid();
  return {...base,state:'selection_unavailable',reason:row.reason as 'empty_window'|'ambiguous_window'};
 }
 exact(row,['contract','scope','window','state','pageLimit','sampledAppointments','reportedTotal','completeness','envelope','fields','exactMatchCount','unverifiedLinkageCount','linkage','reviewCounts','technician','schedule']);
 if(row.state!=='window_reviewed'||totalTickets!==1||row.pageLimit!==MHELP_APPOINTMENT_PAGE_LIMIT||row.technician!=='unresolved_no_staff_read'||row.schedule!=='unverified_candidate_contract')invalid();
 const sampledAppointments=integer(row.sampledAppointments),reportedTotal=row.reportedTotal===null?null:integer(row.reportedTotal,1000000);
 const inputEnvelope=exact(row.envelope,ENVELOPE_KEYS),envelope=Object.fromEntries(ENVELOPE_KEYS.map(key=>{if(!KINDS.includes(inputEnvelope[key] as Kind))invalid();return [key,inputEnvelope[key]];})) as Record<typeof ENVELOPE_KEYS[number],Kind>;
 const validEnvelope=envelope.rootKind==='object'&&envelope.resultsKind==='array'&&envelope.totalRowsKind==='integer'&&reportedTotal!==null&&reportedTotal>=sampledAppointments&&['alternateTotalRowsKind','alternateTotalResultsKind','alternateDataKind'].every(key=>inputEnvelope[key]==='absent');
 const completeness:Completeness=!validEnvelope?'unverified':reportedTotal===sampledAppointments?'complete':'incomplete';
 if(row.completeness!==completeness||(envelope.resultsKind!=='array'&&sampledAppointments!==0)||(reportedTotal!==null&&envelope.totalRowsKind!=='integer'))invalid();
 const inputFields=exact(row.fields,MHELP_APPOINTMENT_FIELDS),fields=Object.fromEntries(MHELP_APPOINTMENT_FIELDS.map(key=>{
  const source=exact(inputFields[key],['kinds','formats','emptyStrings','nonemptyStrings']),kinds=counters(source.kinds,KINDS,sampledAppointments),formats=counters(source.formats,FORMATS,kinds.string||0);
  const emptyStrings=integer(source.emptyStrings,sampledAppointments),nonemptyStrings=integer(source.nonemptyStrings,sampledAppointments);
  if(emptyStrings+nonemptyStrings!==(kinds.string||0))invalid();return [key,{kinds,formats,emptyStrings,nonemptyStrings}];
 })) as Record<typeof MHELP_APPOINTMENT_FIELDS[number],FieldEvidence>;
 const exactMatchCount=integer(row.exactMatchCount,sampledAppointments),unverifiedLinkageCount=integer(row.unverifiedLinkageCount,sampledAppointments);
 if(exactMatchCount+unverifiedLinkageCount>sampledAppointments||exactMatchCount>(fields.TicketId.kinds.integer||0)||exactMatchCount>(fields.PortalId.kinds.integer||0))invalid();
 const inputReview=exact(row.reviewCounts,REVIEW_KEYS),reviewCounts=Object.fromEntries(REVIEW_KEYS.map(key=>[key,integer(inputReview[key],exactMatchCount)])) as ReviewCounts;
 const resolvedLinkage=linkage(completeness,exactMatchCount,unverifiedLinkageCount,reviewCounts);if(row.linkage!==resolvedLinkage)invalid();
 const result:MhelpAppointmentEvidence={...base,state:'window_reviewed',pageLimit:500,sampledAppointments,reportedTotal,completeness,envelope,fields,exactMatchCount,unverifiedLinkageCount,linkage:resolvedLinkage,reviewCounts,technician:'unresolved_no_staff_read',schedule:'unverified_candidate_contract'};
 if(new TextEncoder().encode(JSON.stringify(result)).length>16000)invalid();return result;
}
