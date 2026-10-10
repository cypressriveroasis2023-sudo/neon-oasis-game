/** Client-only fixed case diagnostics. Spellings are observations, never aliases or mappings. */
import {checkedMhelpAppointmentEvidence,ticketAppointmentEvidenceFields,type TicketAppointmentEvidence} from './mhelpAppointmentPreviewModel';
import type {TicketFieldEvidence} from './mhelpTicketPreviewModel';
export const ticketAppointmentVariantCapability='appointment_variants_v1' as const;
export const ticketAppointmentVariantFields=[
  'Id','id','TicketID','ticketId','ticketID','PortalID','portalId','portalID','UserID','userId','userID',
  'StartUtc','startUTC','startUtc','EndUtc','endUTC','endUtc','TeamID','teamId','teamID','recurrenceRule',
  'RecurrenceParentId','recurrenceParentID','recurrenceParentId','RecurrenceStartUtc','recurrenceStartUTC','recurrenceStartUtc',
  'RecurrenceEndUtc','recurrenceEndUTC','recurrenceEndUtc','timeZone','appointmentTimeZone','isAllDay','lastUpdate','isDeleted','isHidden'
] as const;
export const ticketAppointmentCounterKeys=['TotalRows','totalRows','TotalResults','totalResults'] as const;
export const ticketAppointmentCollectionKeys=['results','Results','data','Data'] as const;
export const ticketAppointmentEnvelopeKeys=[...ticketAppointmentCounterKeys,...ticketAppointmentCollectionKeys] as const;
export const ticketAppointmentTicketIdFields=['TicketId','TicketID','ticketId','ticketID'] as const;
export const ticketAppointmentPortalIdFields=['PortalId','PortalID','portalId','portalID'] as const;
export const ticketAppointmentCandidatePairFields=ticketAppointmentTicketIdFields.flatMap(ticket=>ticketAppointmentPortalIdFields.map(portal=>({ticket,portal})));
export const ticketAppointmentUserFields=['UserId','UserID','userId','userID'] as const;
export const ticketAppointmentUserReferenceFormats=['numeric','uuid_like','email_like','other'] as const;
const kinds=['absent','null','boolean','integer','number','string','array','object','other'] as const;
const formats=['numeric','iso_with_zone','iso_without_zone','dotnet','other'] as const;
type Kind=typeof kinds[number];
type Descriptor={kind:Kind;integerCount:number|null;arrayEntries:number|null};
export type TicketAppointmentVariantDiagnostics={
  contractState:'unresolved';fields:Record<typeof ticketAppointmentVariantFields[number],TicketFieldEvidence>;
  envelope:Record<typeof ticketAppointmentEnvelopeKeys[number],Descriptor>;rootArrayEntries:number|null;rowKinds:Partial<Record<Kind,number>>;
  candidatePairs:{comparable:number[];matching:number[];ticketAliasConflicts:number;portalAliasConflicts:number};
  emptyObjectRows:number;userReferenceFormats:Record<typeof ticketAppointmentUserFields[number],Partial<Record<typeof ticketAppointmentUserReferenceFormats[number],number>>>;
  suppressedEnvelopeKeys:number;suppressedRowKeys:number;
};
export type TicketAppointmentVariantEvidence=(Omit<Extract<TicketAppointmentEvidence,{state:'selection_unavailable'}>,'contract'>&{contract:'cos-mhelpdesk-appointment-evidence-v2'})|
  (Omit<Extract<TicketAppointmentEvidence,{state:'window_reviewed'}>,'contract'|'completeness'|'linkage'>&{contract:'cos-mhelpdesk-appointment-evidence-v2';completeness:'unverified';linkage:'unverified';diagnostics:TicketAppointmentVariantDiagnostics});
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function invalid():never {throw Error('The ticket preview response could not be verified. Try again.');}
function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!plain(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))invalid();return value;
}
function count(value:unknown,max=1000000):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)invalid();return value;}
function counts<K extends string>(value:unknown,keys:readonly K[],size:number):Partial<Record<K,number>>{
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key as K)))invalid();
  const result:Partial<Record<K,number>>={};let total=0;
  for(const key of keys)if(Object.hasOwn(value,key)){const n=count(value[key],size);if(n===0)invalid();result[key]=n;total+=n;}
  if(total!==size)invalid();return result;
}
/** Reuse the unchanged v1 validator for its exact fields, calendar window and counters.
 * Its recomputed structural states are only validation inputs; v2 remains unresolved. */
export function checkedMhelpAppointmentVariantEvidence(value:unknown,totalTickets:number,createdAfter:string):TicketAppointmentVariantEvidence {
  if(!plain(value))invalid();
  try {if(new TextEncoder().encode(JSON.stringify(value)).length>16000)invalid();}catch {invalid();}
  const unavailable=value.state==='selection_unavailable';
  const row=exact(value,['contract','scope','window','state',...(unavailable?['reason']:['pageLimit','sampledAppointments','reportedTotal','completeness','envelope','fields','exactMatchCount','unverifiedLinkageCount','linkage','reviewCounts','technician','schedule','diagnostics'])]);
  if(row.contract!=='cos-mhelpdesk-appointment-evidence-v2')invalid();
  const {diagnostics:inputDiagnostics,...inputCore}=row;
  if(unavailable){
    const core=checkedMhelpAppointmentEvidence({...inputCore,contract:'cos-mhelpdesk-appointment-evidence-v1'},totalTickets,createdAfter);
    if(core.state!=='selection_unavailable')invalid();
    return {...core,contract:'cos-mhelpdesk-appointment-evidence-v2'};
  }
  if(row.completeness!=='unverified'||row.linkage!=='unverified'||!plain(row.envelope)||!plain(row.reviewCounts))invalid();
  const validEnvelope=row.envelope.rootKind==='object'&&row.envelope.resultsKind==='array'&&row.envelope.totalRowsKind==='integer'&&typeof row.reportedTotal==='number'&&typeof row.sampledAppointments==='number'&&row.reportedTotal>=row.sampledAppointments&&['alternateTotalRowsKind','alternateTotalResultsKind','alternateDataKind'].every(key=>row.envelope && (row.envelope as Record<string,unknown>)[key]==='absent');
  const completeness=!validEnvelope?'unverified':row.reportedTotal===row.sampledAppointments?'complete':'incomplete';
  const linkage=completeness!=='complete'||typeof row.unverifiedLinkageCount!=='number'||row.unverifiedLinkageCount>0?'unverified':row.exactMatchCount===0?'no_match_in_window':typeof row.exactMatchCount==='number'&&row.exactMatchCount>1?'ambiguous_matches':Object.values(row.reviewCounts).some(n=>typeof n==='number'&&n>0)?'review_required':'single_structural_match';
  const core=checkedMhelpAppointmentEvidence({...inputCore,contract:'cos-mhelpdesk-appointment-evidence-v1',completeness,linkage},totalTickets,createdAfter);
  if(core.state!=='window_reviewed')invalid();
  const input=exact(inputDiagnostics,['contractState','fields','envelope','rootArrayEntries','rowKinds','emptyObjectRows','userReferenceFormats','candidatePairs','suppressedEnvelopeKeys','suppressedRowKeys']);
  if(input.contractState!=='unresolved')invalid();
  const rowKinds=counts(input.rowKinds,kinds,core.sampledAppointments),nonObjectRows=core.sampledAppointments-(rowKinds.object||0),emptyObjectRows=count(input.emptyObjectRows,rowKinds.object||0);
  const inputFields=exact(input.fields,ticketAppointmentVariantFields),fields=Object.fromEntries(ticketAppointmentVariantFields.map(key=>{
    const field=exact(inputFields[key],['kinds','formats','emptyStrings','nonemptyStrings']),fieldKinds=counts(field.kinds,kinds,core.sampledAppointments),strings=fieldKinds.string||0,fieldFormats=counts(field.formats,formats,strings);
    const emptyStrings=count(field.emptyStrings,core.sampledAppointments),nonemptyStrings=count(field.nonemptyStrings,core.sampledAppointments);
    if(emptyStrings+nonemptyStrings!==strings||(fieldKinds.absent||0)<nonObjectRows+emptyObjectRows)invalid();
    return [key,{kinds:fieldKinds,formats:fieldFormats,emptyStrings,nonemptyStrings}];
  })) as TicketAppointmentVariantDiagnostics['fields'];
  for(const key of ticketAppointmentEvidenceFields)if((core.fields[key].kinds.absent||0)<nonObjectRows+emptyObjectRows)invalid();
  const inputEnvelope=exact(input.envelope,ticketAppointmentEnvelopeKeys),envelope=Object.fromEntries(ticketAppointmentEnvelopeKeys.map(key=>{
    const item=exact(inputEnvelope[key],['kind','integerCount','arrayEntries']);
    if(!kinds.includes(item.kind as Kind))invalid();
    const counter=ticketAppointmentCounterKeys.includes(key as typeof ticketAppointmentCounterKeys[number]);
    const integerCount=item.integerCount===null?null:count(item.integerCount),arrayEntries=item.arrayEntries===null?null:count(item.arrayEntries,500);
    if(counter?(arrayEntries!==null||(integerCount!==null&&item.kind!=='integer')):(integerCount!==null||(item.kind==='array')!==(arrayEntries!==null)))invalid();
    if(core.envelope.rootKind!=='object'&&item.kind!=='absent')invalid();
    return [key,{kind:item.kind as Kind,integerCount,arrayEntries}];
  })) as TicketAppointmentVariantDiagnostics['envelope'];
  if(envelope.TotalRows.kind!==core.envelope.totalRowsKind||envelope.totalRows.kind!==core.envelope.alternateTotalRowsKind||envelope.totalResults.kind!==core.envelope.alternateTotalResultsKind||envelope.results.kind!==core.envelope.resultsKind||envelope.data.kind!==core.envelope.alternateDataKind||envelope.TotalRows.integerCount!==core.reportedTotal||envelope.results.arrayEntries!==(core.envelope.resultsKind==='array'?core.sampledAppointments:null))invalid();
  const rootArrayEntries=input.rootArrayEntries===null?null:count(input.rootArrayEntries,500),suppressedEnvelopeKeys=count(input.suppressedEnvelopeKeys),suppressedRowKeys=count(input.suppressedRowKeys);
  if((core.envelope.rootKind==='array')!==(rootArrayEntries!==null)||(core.envelope.rootKind!=='object'&&suppressedEnvelopeKeys!==0)||((rowKinds.object||0)===emptyObjectRows&&suppressedRowKeys!==0))invalid();
  const inputUserFormats=exact(input.userReferenceFormats,ticketAppointmentUserFields),userReferenceFormats=Object.fromEntries(ticketAppointmentUserFields.map(key=>[key,counts(inputUserFormats[key],ticketAppointmentUserReferenceFormats,(key==='UserId'?core.fields.UserId:fields[key]).kinds.string||0)])) as TicketAppointmentVariantDiagnostics['userReferenceFormats'];
  const inputPairs=exact(input.candidatePairs,['comparable','matching','ticketAliasConflicts','portalAliasConflicts']);
  if(!Array.isArray(inputPairs.comparable)||!Array.isArray(inputPairs.matching)||inputPairs.comparable.length!==16||inputPairs.matching.length!==16||[inputPairs.comparable,inputPairs.matching].some(values=>Object.keys(values).length!==16||ticketAppointmentCandidatePairFields.some((_,index)=>!Object.hasOwn(values,index))))invalid();
  const comparable=inputPairs.comparable.map((n,index)=>{const pair=ticketAppointmentCandidatePairFields[index],ticket=pair.ticket==='TicketId'?core.fields.TicketId:fields[pair.ticket],portal=pair.portal==='PortalId'?core.fields.PortalId:fields[pair.portal];return count(n,Math.min(ticket.kinds.integer||0,portal.kinds.integer||0));});
  const matching=inputPairs.matching.map((n,index)=>count(n,comparable[index]));
  if(matching[0]!==core.exactMatchCount)invalid();
  const candidatePairs={comparable,matching,ticketAliasConflicts:count(inputPairs.ticketAliasConflicts,(rowKinds.object||0)-emptyObjectRows),portalAliasConflicts:count(inputPairs.portalAliasConflicts,(rowKinds.object||0)-emptyObjectRows)};
  for(const [keys,n] of [[ticketAppointmentTicketIdFields,candidatePairs.ticketAliasConflicts],[ticketAppointmentPortalIdFields,candidatePairs.portalAliasConflicts]] as const){
    const present=keys.reduce((sum,key)=>sum+core.sampledAppointments-((key==='TicketId'||key==='PortalId'?core.fields[key]:fields[key]).kinds.absent||0),0);
    if(n>Math.floor(present/2))invalid();
  }
  const diagnostics:TicketAppointmentVariantDiagnostics={contractState:'unresolved',fields,envelope,rootArrayEntries,rowKinds,emptyObjectRows,userReferenceFormats,candidatePairs,suppressedEnvelopeKeys,suppressedRowKeys};
  return {...core,contract:'cos-mhelpdesk-appointment-evidence-v2',completeness:'unverified',linkage:'unverified',diagnostics};
}
