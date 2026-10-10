/** Client-only appointment counts. Never imports provider readers or source records. */
import type {TicketFieldEvidence} from './mhelpTicketPreviewModel';
export const ticketAppointmentEvidenceCapability='appointment_structure_v1' as const;
export const ticketAppointmentEvidenceFields=['ID','TicketId','PortalId','UserId','StartUTC','EndUTC','TeamId','RecurrenceRule','RecurrenceParentID','RecurrenceStartUTC','RecurrenceEndUTC','TimeZone','AppointmentTimeZone','IsAllDay','LastUpdate','IsDeleted','IsHidden'] as const;
export const ticketAppointmentReviewKeys=['deleted','hidden','team','recurrence','missingFlags','missingUser','invalidTime','invalidIdentity'] as const;
const kinds=['absent','null','boolean','integer','number','string','array','object','other'] as const;
const formats=['numeric','iso_with_zone','iso_without_zone','dotnet','other'] as const;
const envelopeKeys=['rootKind','totalRowsKind','resultsKind','alternateTotalRowsKind','alternateTotalResultsKind','alternateDataKind'] as const;
type Kind=typeof kinds[number];
type Window={startDateUtc:string;endDateUtc:string;timeZone:'America/Chicago';calendarDays:7};
type Common={contract:'cos-mhelpdesk-appointment-evidence-v1';scope:'single_ticket_seven_day_schedule_window';window:Window};
export type TicketAppointmentEvidence=Common&({state:'selection_unavailable';reason:'empty_window'|'ambiguous_window'}|{
  state:'window_reviewed';pageLimit:500;sampledAppointments:number;reportedTotal:number|null;completeness:'complete'|'incomplete'|'unverified';
  envelope:Record<typeof envelopeKeys[number],Kind>;fields:Record<typeof ticketAppointmentEvidenceFields[number],TicketFieldEvidence>;
  exactMatchCount:number;unverifiedLinkageCount:number;linkage:'single_structural_match'|'no_match_in_window'|'ambiguous_matches'|'review_required'|'unverified';
  reviewCounts:Record<typeof ticketAppointmentReviewKeys[number],number>;technician:'unresolved_no_staff_read';schedule:'unverified_candidate_contract';
});
function invalid():never {throw Error('The ticket preview response could not be verified. Try again.');}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!plain(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))invalid();return value;
}
function count(value:unknown,max=500):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)invalid();return value;}
function counts<K extends string>(value:unknown,keys:readonly K[],size:number):Partial<Record<K,number>>{
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key as K)))invalid();
  const result:Partial<Record<K,number>>={};let total=0;
  for(const key of keys)if(Object.hasOwn(value,key)){const n=count(value[key],size);if(n===0)invalid();result[key]=n;total+=n;}
  if(total!==size)invalid();return result;
}
/** Validate server bounds against named-zone calendar midnights, including DST.
 * This does not choose a date or create a request; the creation-day start is returned by the server. */
function checkedWindow(value:unknown,createdAfter:string):Window {
  const row=exact(value,['startDateUtc','endDateUtc','timeZone','calendarDays']),start=new Date(createdAfter);
  if(!Number.isFinite(start.getTime())||row.timeZone!=='America/Chicago'||row.calendarDays!==7||row.startDateUtc!==start.toISOString())invalid();
  const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const parts=(at:Date)=>Object.fromEntries(formatter.formatToParts(at).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
  const first=parts(start);
  if(first.hour!==0||first.minute!==0||first.second!==0||start.getUTCMilliseconds()!==0)invalid();
  const target=new Date(Date.UTC(first.year,first.month-1,first.day+7)),local=target.getTime();let candidate=local;
  for(let n=0;n<3;n++){const part=parts(new Date(candidate)),delta=local-Date.UTC(part.year,part.month-1,part.day,part.hour,part.minute,part.second);candidate+=delta;if(delta===0)break;}
  const last=parts(new Date(candidate));
  if(last.year!==target.getUTCFullYear()||last.month!==target.getUTCMonth()+1||last.day!==target.getUTCDate()||last.hour!==0||last.minute!==0||last.second!==0||row.endDateUtc!==new Date(candidate).toISOString())invalid();
  return {startDateUtc:start.toISOString(),endDateUtc:new Date(candidate).toISOString(),timeZone:'America/Chicago',calendarDays:7};
}
export function checkedMhelpAppointmentEvidence(value:unknown,totalTickets:number,createdAfter:string):TicketAppointmentEvidence {
  if(!plain(value))invalid();
  try {if(new TextEncoder().encode(JSON.stringify(value)).length>16000)invalid();}catch {invalid();}
  const unavailable=value.state==='selection_unavailable',row=exact(value,['contract','scope','window','state',...(unavailable?['reason']:['pageLimit','sampledAppointments','reportedTotal','completeness','envelope','fields','exactMatchCount','unverifiedLinkageCount','linkage','reviewCounts','technician','schedule'])]);
  if(row.contract!=='cos-mhelpdesk-appointment-evidence-v1'||row.scope!=='single_ticket_seven_day_schedule_window')invalid();
  const window=checkedWindow(row.window,createdAfter),base={contract:'cos-mhelpdesk-appointment-evidence-v1' as const,scope:'single_ticket_seven_day_schedule_window' as const,window};
  count(totalTickets);
  if(unavailable){
    if(totalTickets===1||row.reason!==(totalTickets===0?'empty_window':'ambiguous_window'))invalid();
    return {...base,state:'selection_unavailable',reason:totalTickets===0?'empty_window':'ambiguous_window'};
  }
  if(row.state!=='window_reviewed'||totalTickets!==1||row.pageLimit!==500||row.technician!=='unresolved_no_staff_read'||row.schedule!=='unverified_candidate_contract')invalid();
  const sampledAppointments=count(row.sampledAppointments),reportedTotal=row.reportedTotal===null?null:count(row.reportedTotal,1000000);
  const inputEnvelope=exact(row.envelope,envelopeKeys),envelope=Object.fromEntries(envelopeKeys.map(key=>{if(!kinds.includes(inputEnvelope[key] as Kind))invalid();return [key,inputEnvelope[key]];})) as Record<typeof envelopeKeys[number],Kind>;
  const validEnvelope=envelope.rootKind==='object'&&envelope.resultsKind==='array'&&envelope.totalRowsKind==='integer'&&reportedTotal!==null&&reportedTotal>=sampledAppointments&&['alternateTotalRowsKind','alternateTotalResultsKind','alternateDataKind'].every(key=>inputEnvelope[key]==='absent');
  const completeness=!validEnvelope?'unverified':reportedTotal===sampledAppointments?'complete':'incomplete';
  if(row.completeness!==completeness||(envelope.resultsKind!=='array'&&sampledAppointments!==0)||(reportedTotal!==null&&envelope.totalRowsKind!=='integer'))invalid();
  const inputFields=exact(row.fields,ticketAppointmentEvidenceFields),fields=Object.fromEntries(ticketAppointmentEvidenceFields.map(key=>{
    const field=exact(inputFields[key],['kinds','formats','emptyStrings','nonemptyStrings']),fieldKinds=counts(field.kinds,kinds,sampledAppointments),stringCount=fieldKinds.string||0,fieldFormats=counts(field.formats,formats,stringCount);
    const emptyStrings=count(field.emptyStrings,sampledAppointments),nonemptyStrings=count(field.nonemptyStrings,sampledAppointments);
    if(emptyStrings+nonemptyStrings!==stringCount)invalid();return [key,{kinds:fieldKinds,formats:fieldFormats,emptyStrings,nonemptyStrings}];
  })) as Record<typeof ticketAppointmentEvidenceFields[number],TicketFieldEvidence>;
  const exactMatchCount=count(row.exactMatchCount,sampledAppointments),unverifiedLinkageCount=count(row.unverifiedLinkageCount,sampledAppointments);
  if(exactMatchCount+unverifiedLinkageCount>sampledAppointments||exactMatchCount>(fields.TicketId.kinds.integer||0)||exactMatchCount>(fields.PortalId.kinds.integer||0))invalid();
  const inputReview=exact(row.reviewCounts,ticketAppointmentReviewKeys),reviewCounts=Object.fromEntries(ticketAppointmentReviewKeys.map(key=>[key,count(inputReview[key],exactMatchCount)])) as Record<typeof ticketAppointmentReviewKeys[number],number>;
  const linkage=completeness!=='complete'||unverifiedLinkageCount>0?'unverified':exactMatchCount===0?'no_match_in_window':exactMatchCount>1?'ambiguous_matches':Object.values(reviewCounts).some(n=>n>0)?'review_required':'single_structural_match';
  if(row.linkage!==linkage)invalid();
  return {...base,state:'window_reviewed',pageLimit:500,sampledAppointments,reportedTotal,completeness,envelope,fields,exactMatchCount,unverifiedLinkageCount,linkage,reviewCounts,technician:'unresolved_no_staff_read',schedule:'unverified_candidate_contract'};
}
