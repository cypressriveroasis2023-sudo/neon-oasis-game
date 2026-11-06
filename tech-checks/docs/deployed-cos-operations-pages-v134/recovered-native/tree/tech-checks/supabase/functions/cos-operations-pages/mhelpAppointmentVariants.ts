/** Fixed case-variant diagnostics only. No source values, dynamic field names,
 * nested traversal, alias normalization, or operational mapping is permitted. */
import {MHELP_APPOINTMENT_FIELDS,describeMhelpAppointments,unavailableMhelpAppointments,projectMhelpAppointmentEvidence,type MhelpAppointmentEvidence} from './mhelpAppointments.ts';
export const MHELP_APPOINTMENT_VARIANTS='appointment_variants_v1' as const;
export const MHELP_APPOINTMENT_VARIANT_CONTRACT='cos-mhelpdesk-appointment-evidence-v2' as const;
// Supplemental to the unchanged 17 documented candidates. These spellings are
// hypotheses to observe individually, never aliases to use interchangeably.
export const MHELP_APPOINTMENT_VARIANT_FIELDS=[
 'Id','id','TicketID','ticketId','ticketID','PortalID','portalId','portalID','UserID','userId','userID',
 'StartUtc','startUTC','startUtc','EndUtc','endUTC','endUtc','TeamID','teamId','teamID','recurrenceRule',
 'RecurrenceParentId','recurrenceParentID','recurrenceParentId','RecurrenceStartUtc','recurrenceStartUTC','recurrenceStartUtc',
 'RecurrenceEndUtc','recurrenceEndUTC','recurrenceEndUtc','timeZone','appointmentTimeZone','isAllDay','lastUpdate','isDeleted','isHidden'
] as const;
export const MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS=[...MHELP_APPOINTMENT_FIELDS,...MHELP_APPOINTMENT_VARIANT_FIELDS] as const;
export const MHELP_APPOINTMENT_COUNTER_KEYS=['TotalRows','totalRows','TotalResults','totalResults'] as const;
export const MHELP_APPOINTMENT_COLLECTION_KEYS=['results','Results','data','Data'] as const;
export const MHELP_APPOINTMENT_ENVELOPE_KEYS=[...MHELP_APPOINTMENT_COUNTER_KEYS,...MHELP_APPOINTMENT_COLLECTION_KEYS] as const;
export const MHELP_APPOINTMENT_TICKET_KEYS=['TicketId','TicketID','ticketId','ticketID'] as const;
export const MHELP_APPOINTMENT_PORTAL_KEYS=['PortalId','PortalID','portalId','portalID'] as const;
export const MHELP_APPOINTMENT_PAIRS=MHELP_APPOINTMENT_TICKET_KEYS.flatMap(ticket=>MHELP_APPOINTMENT_PORTAL_KEYS.map(portal=>[ticket,portal] as const));
export const MHELP_APPOINTMENT_USER_FIELDS=['UserId','UserID','userId','userID'] as const;
export const MHELP_APPOINTMENT_USER_FORMATS=['numeric','uuid_like','email_like','other'] as const;
const KINDS=['absent','null','boolean','integer','number','string','array','object','other'] as const;
const FORMATS=['numeric','iso_with_zone','iso_without_zone','dotnet','other'] as const;
type Kind=typeof KINDS[number];type Format=typeof FORMATS[number];type Counts<T extends string>=Partial<Record<T,number>>;
type FieldEvidence={kinds:Counts<Kind>;formats:Counts<Format>;emptyStrings:number;nonemptyStrings:number};
type Descriptor={kind:Kind;integerCount:number|null;arrayEntries:number|null};
export type MhelpAppointmentVariantDiagnostics={
 contractState:'unresolved';candidatePairs:{comparable:number[];matching:number[];ticketAliasConflicts:number;portalAliasConflicts:number};fields:Record<typeof MHELP_APPOINTMENT_VARIANT_FIELDS[number],FieldEvidence>;
 envelope:Record<typeof MHELP_APPOINTMENT_ENVELOPE_KEYS[number],Descriptor>;rootArrayEntries:number|null;rowKinds:Counts<Kind>;
 suppressedEnvelopeKeys:number;suppressedRowKeys:number;emptyObjectRows:number;
 userReferenceFormats:Record<typeof MHELP_APPOINTMENT_USER_FIELDS[number],Counts<typeof MHELP_APPOINTMENT_USER_FORMATS[number]>>;
};
export type MhelpAppointmentVariantEvidence=(Omit<Extract<MhelpAppointmentEvidence,{state:'selection_unavailable'}>,'contract'>&{contract:typeof MHELP_APPOINTMENT_VARIANT_CONTRACT})|
 (Omit<Extract<MhelpAppointmentEvidence,{state:'window_reviewed'}>,'contract'|'completeness'|'linkage'>&{contract:typeof MHELP_APPOINTMENT_VARIANT_CONTRACT;completeness:'unverified';linkage:'unverified';diagnostics:MhelpAppointmentVariantDiagnostics});
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value:unknown,key:string):unknown=>plain(value)&&Object.hasOwn(value,key)?value[key]:undefined;
const invalid=():never=>{throw Error('Unsupported mHelpDesk appointment evidence.');};
const exact=(value:unknown,keys:readonly string[]):Record<string,unknown>=>{
 if(!plain(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))invalid();return value as Record<string,unknown>;
};
function kind(value:unknown):Kind {
 if(value===undefined)return 'absent';if(value===null)return 'null';if(Array.isArray(value))return 'array';
 if(typeof value==='number')return Number.isSafeInteger(value)?'integer':'number';return ['boolean','string','object'].includes(typeof value)?typeof value as Kind:'other';
}
function format(value:string):Format {
 if(/^\d{1,16}$/.test(value))return 'numeric';
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value))return 'iso_with_zone';
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(value))return 'iso_without_zone';
 if(/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(value))return 'dotnet';return 'other';
}
function userFormat(value:string):typeof MHELP_APPOINTMENT_USER_FORMATS[number] {
 if(/^\d{1,16}$/.test(value))return 'numeric';
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return 'uuid_like';
 if(value.length<=320&&/^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(value))return 'email_like';return 'other';
}
const boundedCount=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=1000000;
function count(value:unknown,max=500):number {if(!boundedCount(value)||(value as number)>max)invalid();return value as number;}
const positiveId=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
function aliasConflict(row:unknown,keys:readonly string[]):boolean {
 const present=keys.map(key=>own(row,key)).filter(value=>value!==undefined);return present.length>1&&present.slice(1).some(value=>!Object.is(value,present[0]));
}
function distribution<T extends string>(values:readonly unknown[],classify:(value:unknown)=>T):Counts<T>{
 const result:Counts<T>={};for(const value of values){const key=classify(value);result[key]=(result[key]||0)+1;}return result;
}
function counts<T extends string>(value:unknown,keys:readonly T[],size:number):Counts<T>{
 if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key as T)))invalid();const source=value as Record<string,unknown>,result:Counts<T>={};
 for(const key of keys)if(Object.hasOwn(source,key)){const n=count(source[key],size);if(n===0)invalid();result[key]=n;}
 if(Object.values(result).reduce((n:number,next)=>n+Number(next),0)!==size)invalid();return result;
}
function field(values:readonly unknown[]):FieldEvidence {
 const strings=values.filter((value):value is string=>typeof value==='string'),emptyStrings=strings.filter(value=>!value.trim()).length;
 return {kinds:distribution(values,kind),formats:distribution(strings,value=>format(value as string)),emptyStrings,nonemptyStrings:strings.length-emptyStrings};
}
// This reconstructs only the old validator's derived states. v2 always returns
// unverified: even a matching documented candidate is not a runtime contract.
function legacyStates(row:Record<string,unknown>){
 const e=plain(row.envelope)?row.envelope:{},review=plain(row.reviewCounts)?row.reviewCounts:{};
 const valid=e.rootKind==='object'&&e.resultsKind==='array'&&e.totalRowsKind==='integer'&&boundedCount(row.reportedTotal)&&typeof row.sampledAppointments==='number'&&row.reportedTotal>=row.sampledAppointments&&['alternateTotalRowsKind','alternateTotalResultsKind','alternateDataKind'].every(key=>e[key]==='absent');
 const completeness=!valid?'unverified':row.reportedTotal===row.sampledAppointments?'complete':'incomplete';
 const linkage=completeness!=='complete'||Number(row.unverifiedLinkageCount)>0?'unverified':row.exactMatchCount===0?'no_match_in_window':Number(row.exactMatchCount)>1?'ambiguous_matches':Object.values(review).some(n=>Number(n)>0)?'review_required':'single_structural_match';
 return {completeness,linkage};
}
export function unavailableMhelpAppointmentVariants(totalTickets:number,createdAfter:string):MhelpAppointmentVariantEvidence {
 return projectMhelpAppointmentVariants({...unavailableMhelpAppointments(totalTickets,createdAfter),contract:MHELP_APPOINTMENT_VARIANT_CONTRACT},totalTickets,createdAfter);
}
/** One already-authorized bounded response is inspected transiently. Only the
 * fixed results collection supplies row evidence; no alternate row parser. */
export function describeMhelpAppointmentVariants(value:unknown,selected:{ticketId:string;portalId:string;deleted:boolean},createdAfter:string):MhelpAppointmentVariantEvidence {
 const base=describeMhelpAppointments(value,selected,createdAfter);
 if(base.state!=='window_reviewed')return invalid();
 const rawRows=own(value,'results'),rows=Array.isArray(rawRows)?rawRows:[];
 for(const collection of [value,...MHELP_APPOINTMENT_COLLECTION_KEYS.map(key=>own(value,key))])if(Array.isArray(collection)&&collection.length>500)throw Error('mHelpDesk returned an oversized appointment page.');
 const envelope=Object.fromEntries(MHELP_APPOINTMENT_ENVELOPE_KEYS.map(key=>{
  const candidate=own(value,key),counter=(MHELP_APPOINTMENT_COUNTER_KEYS as readonly string[]).includes(key);
  return [key,{kind:kind(candidate),integerCount:counter&&boundedCount(candidate)?candidate:null,arrayEntries:!counter&&Array.isArray(candidate)?candidate.length:null}];
 })) as MhelpAppointmentVariantDiagnostics['envelope'];
 const candidatePairs={comparable:MHELP_APPOINTMENT_PAIRS.map(([ticket,portal])=>rows.filter(row=>positiveId(own(row,ticket))&&positiveId(own(row,portal))).length),matching:MHELP_APPOINTMENT_PAIRS.map(([ticket,portal])=>rows.filter(row=>positiveId(own(row,ticket))&&positiveId(own(row,portal))&&own(row,ticket)===Number(selected.ticketId)&&own(row,portal)===Number(selected.portalId)).length),ticketAliasConflicts:rows.filter(row=>aliasConflict(row,MHELP_APPOINTMENT_TICKET_KEYS)).length,portalAliasConflicts:rows.filter(row=>aliasConflict(row,MHELP_APPOINTMENT_PORTAL_KEYS)).length};
 const diagnostics:MhelpAppointmentVariantDiagnostics={contractState:'unresolved',envelope,candidatePairs,
  fields:Object.fromEntries(MHELP_APPOINTMENT_VARIANT_FIELDS.map(key=>[key,field(rows.map(row=>own(row,key)))])) as MhelpAppointmentVariantDiagnostics['fields'],
  rootArrayEntries:Array.isArray(value)?value.length:null,rowKinds:distribution(rows,kind),emptyObjectRows:rows.filter(row=>plain(row)&&Object.keys(row).length===0).length,
  userReferenceFormats:Object.fromEntries(MHELP_APPOINTMENT_USER_FIELDS.map(key=>[key,distribution(rows.map(row=>own(row,key)).filter((v):v is string=>typeof v==='string'),value=>userFormat(value as string))])) as MhelpAppointmentVariantDiagnostics['userReferenceFormats'],
  suppressedEnvelopeKeys:plain(value)?Object.keys(value).filter(key=>!(MHELP_APPOINTMENT_ENVELOPE_KEYS as readonly string[]).includes(key)).length:0,
  suppressedRowKeys:rows.reduce((n,row)=>n+(plain(row)?Object.keys(row).filter(key=>!(MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS as readonly string[]).includes(key)).length:0),0)};
 return projectMhelpAppointmentVariants({...base,contract:MHELP_APPOINTMENT_VARIANT_CONTRACT,completeness:'unverified',linkage:'unverified',diagnostics},1,createdAfter);
}
export function projectMhelpAppointmentVariants(value:unknown,totalTickets:number,createdAfter:string):MhelpAppointmentVariantEvidence {
 if(!plain(value))invalid();const row=value as Record<string,unknown>;
 if(row.contract!==MHELP_APPOINTMENT_VARIANT_CONTRACT)invalid();
 // Bound before any reconstruction. No user-controlled key survives either projector.
 try {if(new TextEncoder().encode(JSON.stringify(value)).length>16000)invalid();}catch {invalid();}
 if(row.state==='selection_unavailable'){
  const base=projectMhelpAppointmentEvidence({...row,contract:'cos-mhelpdesk-appointment-evidence-v1'},totalTickets,createdAfter);
  if(base.state!=='selection_unavailable')invalid();return {...base,contract:MHELP_APPOINTMENT_VARIANT_CONTRACT} as MhelpAppointmentVariantEvidence;
 }
 if(row.completeness!=='unverified'||row.linkage!=='unverified')invalid();
 const {diagnostics:rawDiagnostics,...core}=row;
 const base=projectMhelpAppointmentEvidence({...core,contract:'cos-mhelpdesk-appointment-evidence-v1',...legacyStates(core)},totalTickets,createdAfter);
 if(base.state!=='window_reviewed')return invalid();
 const d=exact(rawDiagnostics,['contractState','candidatePairs','fields','envelope','rootArrayEntries','rowKinds','suppressedEnvelopeKeys','suppressedRowKeys','emptyObjectRows','userReferenceFormats']);
 if(d.contractState!=='unresolved')invalid();
 const sourceEnvelope=exact(d.envelope,MHELP_APPOINTMENT_ENVELOPE_KEYS);
 const envelope=Object.fromEntries(MHELP_APPOINTMENT_ENVELOPE_KEYS.map(key=>{
  const source=exact(sourceEnvelope[key],['kind','integerCount','arrayEntries']);if(!KINDS.includes(source.kind as Kind))invalid();
  const counter=(MHELP_APPOINTMENT_COUNTER_KEYS as readonly string[]).includes(key);
  const integerCount=source.integerCount===null?null:count(source.integerCount,1000000),arrayEntries=source.arrayEntries===null?null:count(source.arrayEntries,500);
  if(counter?(arrayEntries!==null||(integerCount!==null&&source.kind!=='integer')):(integerCount!==null||(source.kind==='array')!==(arrayEntries!==null)))invalid();
  return [key,{kind:source.kind as Kind,integerCount,arrayEntries}];
 })) as MhelpAppointmentVariantDiagnostics['envelope'];
 const correspondence={TotalRows:'totalRowsKind',totalRows:'alternateTotalRowsKind',totalResults:'alternateTotalResultsKind',results:'resultsKind',data:'alternateDataKind'} as const;
 for(const [source,target] of Object.entries(correspondence))if(envelope[source as keyof typeof correspondence].kind!==base.envelope[target as keyof typeof base.envelope])invalid();
 if(envelope.TotalRows.integerCount!==base.reportedTotal||(envelope.results.arrayEntries??0)!==base.sampledAppointments)invalid();
 const rootArrayEntries=d.rootArrayEntries===null?null:count(d.rootArrayEntries,500);
 if((base.envelope.rootKind==='array')!==(rootArrayEntries!==null))invalid();
 if(base.envelope.rootKind!=='object'&&MHELP_APPOINTMENT_ENVELOPE_KEYS.some(key=>envelope[key].kind!=='absent'))invalid();
 const rowKinds=counts(d.rowKinds,KINDS,base.sampledAppointments),objectRows=rowKinds.object||0;
 const emptyObjectRows=count(d.emptyObjectRows,objectRows);
 const sourceFields=exact(d.fields,MHELP_APPOINTMENT_VARIANT_FIELDS),fields=Object.fromEntries(MHELP_APPOINTMENT_VARIANT_FIELDS.map(key=>{
  const source=exact(sourceFields[key],['kinds','formats','emptyStrings','nonemptyStrings']),kinds=counts(source.kinds,KINDS,base.sampledAppointments),formats=counts(source.formats,FORMATS,kinds.string||0);
  const emptyStrings=count(source.emptyStrings,base.sampledAppointments),nonemptyStrings=count(source.nonemptyStrings,base.sampledAppointments);
  if(emptyStrings+nonemptyStrings!==(kinds.string||0))invalid();return [key,{kinds,formats,emptyStrings,nonemptyStrings}];
 })) as MhelpAppointmentVariantDiagnostics['fields'];
 for(const f of [...Object.values(base.fields),...Object.values(fields)])if(base.sampledAppointments-(f.kinds.absent||0)>objectRows-emptyObjectRows)invalid();
 const sourcePairs=exact(d.candidatePairs,['comparable','matching','ticketAliasConflicts','portalAliasConflicts']);
 const pairCounts=(value:unknown)=>{if(!Array.isArray(value)||value.length!==16||Object.keys(value).length!==16||MHELP_APPOINTMENT_PAIRS.some((_,i)=>!Object.hasOwn(value,i)))invalid();return (value as unknown[]).map(n=>count(n,objectRows-emptyObjectRows));};
 const comparable=pairCounts(sourcePairs.comparable),matching=pairCounts(sourcePairs.matching);
 const fieldFor=(key:typeof MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS[number])=>key in base.fields?base.fields[key as keyof typeof base.fields]:fields[key as keyof typeof fields];
 MHELP_APPOINTMENT_PAIRS.forEach(([ticket,portal],i)=>{if(matching[i]>comparable[i]||comparable[i]>Math.min(fieldFor(ticket).kinds.integer||0,fieldFor(portal).kinds.integer||0))invalid();});
 if(matching[0]!==base.exactMatchCount)invalid();
 const candidatePairs={comparable,matching,ticketAliasConflicts:count(sourcePairs.ticketAliasConflicts,objectRows-emptyObjectRows),portalAliasConflicts:count(sourcePairs.portalAliasConflicts,objectRows-emptyObjectRows)};
 for(const [keys,n] of [[MHELP_APPOINTMENT_TICKET_KEYS,candidatePairs.ticketAliasConflicts],[MHELP_APPOINTMENT_PORTAL_KEYS,candidatePairs.portalAliasConflicts]] as const)if(n>Math.floor(keys.reduce((sum,key)=>sum+base.sampledAppointments-(fieldFor(key).kinds.absent||0),0)/2))invalid();
 const sourceUsers=exact(d.userReferenceFormats,MHELP_APPOINTMENT_USER_FIELDS),userReferenceFormats=Object.fromEntries(MHELP_APPOINTMENT_USER_FIELDS.map(key=>[key,counts(sourceUsers[key],MHELP_APPOINTMENT_USER_FORMATS,(key==='UserId'?base.fields.UserId:fields[key]).kinds.string||0)])) as MhelpAppointmentVariantDiagnostics['userReferenceFormats'];
 const suppressedEnvelopeKeys=count(d.suppressedEnvelopeKeys,1000000),suppressedRowKeys=count(d.suppressedRowKeys,1000000);
 if((base.envelope.rootKind!=='object'&&suppressedEnvelopeKeys!==0)||(objectRows===emptyObjectRows&&suppressedRowKeys!==0))invalid();
 return {...base,contract:MHELP_APPOINTMENT_VARIANT_CONTRACT,completeness:'unverified',linkage:'unverified',diagnostics:{contractState:'unresolved',candidatePairs,fields,envelope,rootArrayEntries,rowKinds,suppressedEnvelopeKeys,suppressedRowKeys,emptyObjectRows,userReferenceFormats}};
}
