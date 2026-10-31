/** Private, explicit Owner review only. Literal operational values have their
 * own contract; no source schema, unit, technician, or COS mapping is inferred.
 * This pure projection module cannot perform reads, writes, joins or imports. */
import {MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS,MHELP_APPOINTMENT_ENVELOPE_KEYS,MHELP_APPOINTMENT_TICKET_KEYS,MHELP_APPOINTMENT_PORTAL_KEYS,MHELP_APPOINTMENT_USER_FIELDS,MHELP_APPOINTMENT_USER_FORMATS,MHELP_APPOINTMENT_PAIRS,describeMhelpAppointmentVariants,type MhelpAppointmentVariantDiagnostics} from './mhelpAppointmentVariants.ts';
import {mhelpPrivateAppointmentDay} from './mhelpTicketDay.ts';
export const MHELP_TICKET_PRIVATE_SAMPLE='ticket_private_sample_v1' as const;
export const MHELP_PRIVATE_SAMPLE_MAX_BYTES=262144;
export const MHELP_PRIVATE_SAMPLE_ROW_LIMIT=50;
export const MHELP_TICKET_PRIVATE_SAMPLE_CONTRACT='cos-mhelpdesk-ticket-private-sample-v1' as const;
export const MHELP_PRIVATE_APPOINTMENT_FIELDS=[...MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS,'Subject','subject','Description','description'] as const;
// Lowercase spellings are documented; uppercase candidates remain independent
// observations. Never normalize aliases or choose one literal over another.
export const MHELP_PRIVATE_ITEM_FIELDS=['name','Name','description','Description','notes','Notes','quantity','Quantity','durationSeconds','DurationSeconds'] as const;
export const MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS=['ID','Id','id',...MHELP_APPOINTMENT_TICKET_KEYS,...MHELP_APPOINTMENT_PORTAL_KEYS,'UserId','UserID','userId','userID','StartUTC','StartUtc','startUTC','startUtc','EndUTC','EndUtc','endUTC','endUtc','Subject','subject','Description','description'] as const;
const KINDS=['absent','null','boolean','integer','number','string','array','object','other'] as const;
type Kind=typeof KINDS[number];type Row=Record<string,unknown>;
export type MhelpPrivateSampleRequest={ticketNumber:string;appointmentDay:string};
export type MhelpPrivateSampleCell={state:'value';value:string|number}|{state:'absent'|'null'|'unsupported'|'suppressed'};
const FORMATS=['numeric','iso_with_zone','iso_without_zone','dotnet','other'] as const;
type Format=typeof FORMATS[number];
type FieldStructure={kinds:Partial<Record<Kind,number>>;formats:Partial<Record<Format,number>>;emptyStrings:number;nonemptyStrings:number};
type Descriptor={kind:Kind;integerCount:number|null;arrayEntries:number|null};
type Structure=Pick<MhelpAppointmentVariantDiagnostics,'rowKinds'|'emptyObjectRows'|'rootArrayEntries'|'suppressedEnvelopeKeys'|'userReferenceFormats'|'candidatePairs'>&{aliasConflicts:{identity:number;user:number;start:number;end:number};rootKind:Kind;envelope:Record<typeof MHELP_APPOINTMENT_ENVELOPE_KEYS[number],Descriptor>;fields:Record<typeof MHELP_PRIVATE_APPOINTMENT_FIELDS[number],FieldStructure>;suppressedRowKeys:number};
type ItemRow={index:number;fields:Record<typeof MHELP_PRIVATE_ITEM_FIELDS[number],MhelpPrivateSampleCell>};
type AppointmentRow={index:number;fields:Record<typeof MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS[number],MhelpPrivateSampleCell>};
type Selected={portalId:string;ticketId:string;ticketNumber:string};
type SelectionCounts={pageLimit:500;sampledTickets:number;reportedTotal:number;matchingTickets:number};
type Common={contract:typeof MHELP_TICKET_PRIVATE_SAMPLE_CONTRACT;scope:'single_ticket_appointment_day';schema:'unverified';identityMapping:'unverified';sourceToCosMapping:'unverified';automaticSync:false;ticketWrites:false;readAt:string;request:MhelpPrivateSampleRequest;window:ReturnType<typeof mhelpPrivateAppointmentDay>};
export type MhelpPrivateSample=Common&({state:'selection_unavailable';reason:'ticket_not_found'|'ambiguous_ticket_number'|'incomplete_ticket_page';selection:SelectionCounts}|{state:'sample_reviewed';selected:Selected;
 items:{state:'reviewed'|'absent'|'null'|'unsupported';totalEntries:number|null;truncated:boolean;rows:ItemRow[]};
 appointments:{state:'window_reviewed';completeness:'complete'|'incomplete'|'unverified';sampledAppointments:number;matchingAppointments:number;suppressedAppointments:number;truncated:boolean;rows:AppointmentRow[];structure:Structure};});
const plain=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value:unknown,key:string)=>plain(value)&&Object.hasOwn(value,key)?value[key]:undefined;
function invalid():never {throw Error('Unsupported mHelpDesk private ticket sample.');}
function exact(value:unknown,keys:readonly string[]):Row {if(!plain(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))invalid();return value as Row;}
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
function id(value:unknown):string {if(typeof value!=='string'||!/^[1-9]\d{0,14}$/.test(value)||!Number.isSafeInteger(Number(value)))invalid();return value;}
function count(value:unknown,max=500):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)invalid();return value as number;}
export function validateMhelpPrivateSampleRequest(value:unknown,now=new Date()) {
 const row=exact(value,['ticketNumber','appointmentDay']);id(row.ticketNumber);
 const window=mhelpPrivateAppointmentDay(row.appointmentDay,now);
 return {request:{ticketNumber:row.ticketNumber as string,appointmentDay:row.appointmentDay as string},window};
}
function common(input:ReturnType<typeof validateMhelpPrivateSampleRequest>,readAt:string):Common {
 return {contract:MHELP_TICKET_PRIVATE_SAMPLE_CONTRACT,scope:'single_ticket_appointment_day',schema:'unverified',identityMapping:'unverified',sourceToCosMapping:'unverified',automaticSync:false,ticketWrites:false,readAt,request:input.request,window:input.window};
}
export function unavailableMhelpPrivateSample(input:ReturnType<typeof validateMhelpPrivateSampleRequest>,reason:Extract<MhelpPrivateSample,{state:'selection_unavailable'}>['reason'],selection:SelectionCounts,readAt=new Date().toISOString()):MhelpPrivateSample {
 return {...common(input,readAt),state:'selection_unavailable',reason,selection};
}
/** Preserve permitted literal text; never attempt to rewrite or partially redact
 * a source field. An unsupported/secret-looking field has no value member. */
function secretLooking(value:string):boolean {
 if((value.match(/[A-Za-z0-9_+/=-]{40,}/g)||[]).some(token=>/[A-Za-z]/.test(token)&&/\d/.test(token)))return true;
 return /(?:\b(?:access[ _-]?token|refresh[ _-]?token|api[ _-]?key|client[ _-]?secret|password|passwd|authorization|bearer|session[ _-]?(?:key|token)|secret[ _-]?key)\b|\b(?:token|secret|key|passphrase|credential|cookie|session)\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:sk[-_](?:live[-_]|test[-_])?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}|\bAKIA[A-Z0-9]{16}\b|https?:\/\/[^\s/]+:[^\s/]+@|[?&](?:token|key|secret|signature|sig|password|auth)=)/i.test(value);
}
function cell(value:unknown,type:'text'|'recorded'|'identity'|'user'|'time'):MhelpPrivateSampleCell {
 if(value===undefined)return {state:'absent'};if(value===null)return {state:'null'};
 if(type==='identity')return positive(value)?{state:'value',value}:{state:'unsupported'};
 if(typeof value==='number')return Number.isFinite(value)&&(type==='recorded'?Math.abs(value)<=1e9:(type==='user'?positive(value):type==='time'&&Number.isSafeInteger(value)))?{state:'value',value}:{state:'unsupported'};
 if(typeof value!=='string')return {state:'unsupported'};
 const limit=type==='text'?4000:type==='user'?500:type==='time'?80:64;
 if(value.length>limit||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value)||(type!=='text'&&/[\r\n\t]/.test(value)))return {state:'unsupported'};
 if(secretLooking(value))return {state:'suppressed'};
 if(type==='recorded'&&!/^[+-]?(?:\d{1,10}(?:\.\d{1,10})?|\.\d{1,10})$/.test(value))return {state:'unsupported'};
 return {state:'value',value};
}
const itemType=(key:string)=>['quantity','Quantity','durationSeconds','DurationSeconds'].includes(key)?'recorded' as const:'text' as const;
const appointmentType=(key:string)=>['Subject','subject','Description','description'].includes(key)?'text' as const:/^[Uu]ser/.test(key)?'user' as const:/^[Ss]tart|^[Ee]nd/.test(key)?'time' as const:'identity' as const;
function kind(value:unknown):Kind {if(value===undefined)return 'absent';if(value===null)return 'null';if(Array.isArray(value))return 'array';if(typeof value==='number')return Number.isSafeInteger(value)?'integer':'number';return ['boolean','string','object'].includes(typeof value)?typeof value as Kind:'other';}
function format(value:string):Format {
 if(/^\d{1,16}$/.test(value))return 'numeric';
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value))return 'iso_with_zone';
 if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(value))return 'iso_without_zone';
 if(/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(value))return 'dotnet';return 'other';
}
function field(values:unknown[]):FieldStructure {
 const kinds:FieldStructure['kinds']={},formats:FieldStructure['formats']={};for(const value of values){const k=kind(value);kinds[k]=(kinds[k]||0)+1;if(typeof value==='string'){const f=format(value);formats[f]=(formats[f]||0)+1;}}
 const strings=values.filter((v):v is string=>typeof v==='string'),emptyStrings=strings.filter(v=>!v.trim()).length;return {kinds,formats,emptyStrings,nonemptyStrings:strings.length-emptyStrings};
}
function conflict(row:unknown,keys:readonly string[]):boolean {if(!plain(row))return false;const values=keys.filter(key=>Object.hasOwn(row,key)).map(key=>row[key]);return values.length>1&&values.slice(1).some(value=>!Object.is(value,values[0]));}
function structure(value:unknown,rows:unknown[],selected:Selected,createdAfter:string):Structure {
 // Reuse the definitive v2 structural projection, but never export its seven-day
 // window, review conclusions, or mapping claims as part of this one-day sample.
 const variant=describeMhelpAppointmentVariants(value,{...selected,deleted:false},createdAfter);if(variant.state!=='window_reviewed')invalid();const d=variant.diagnostics;
 return {rootKind:kind(value),envelope:d.envelope,rowKinds:d.rowKinds,emptyObjectRows:d.emptyObjectRows,rootArrayEntries:d.rootArrayEntries,suppressedEnvelopeKeys:d.suppressedEnvelopeKeys,userReferenceFormats:d.userReferenceFormats,candidatePairs:d.candidatePairs,
 aliasConflicts:{identity:rows.filter(row=>conflict(row,aliasGroups[0])).length,user:rows.filter(row=>conflict(row,aliasGroups[3])).length,start:rows.filter(row=>conflict(row,aliasGroups[4])).length,end:rows.filter(row=>conflict(row,aliasGroups[5])).length},
 fields:Object.fromEntries(MHELP_PRIVATE_APPOINTMENT_FIELDS.map(key=>[key,field(rows.map(row=>own(row,key)))])) as Structure['fields'],
 suppressedRowKeys:rows.reduce<number>((n,row)=>n+(plain(row)?Object.keys(row).filter(key=>!(MHELP_PRIVATE_APPOINTMENT_FIELDS as readonly string[]).includes(key)).length:0),0)};
}
const aliasGroups=[['ID','Id','id'],MHELP_APPOINTMENT_TICKET_KEYS,MHELP_APPOINTMENT_PORTAL_KEYS,['UserId','UserID','userId','userID'],['StartUTC','StartUtc','startUTC','startUtc'],['EndUTC','EndUtc','endUTC','endUtc']] as const;
function matches(row:unknown,selected:Selected):boolean {
 if(!plain(row))return false;
 // Every present alias participates. Strings are never coerced, and no alias
 // takes precedence over another. Conflicting non-linkage aliases also block values.
 if(aliasGroups.some(keys=>{const values=keys.filter(key=>Object.hasOwn(row,key)).map(key=>row[key]);return values.length>1&&values.slice(1).some(value=>!Object.is(value,values[0]));}))return false;
 return [[MHELP_APPOINTMENT_TICKET_KEYS,selected.ticketId],[MHELP_APPOINTMENT_PORTAL_KEYS,selected.portalId]].every(([keys,expected])=>{
  const values=(keys as readonly string[]).filter(key=>Object.hasOwn(row,key)).map(key=>row[key]);return values.length>0&&values.every(value=>positive(value)&&value===Number(expected));
 });
}
export function describeMhelpPrivateSample(input:ReturnType<typeof validateMhelpPrivateSampleRequest>,selected:Selected,detail:unknown,appointments:unknown,readAt=new Date().toISOString(),credentialValues:readonly string[]=[]):MhelpPrivateSample {
 const safeCell=(value:unknown,type:Parameters<typeof cell>[1]):MhelpPrivateSampleCell=>typeof value==='string'&&credentialValues.some(secret=>secret.length>0&&value.includes(secret))?{state:'suppressed'}:cell(value,type);
 const rawItems=own(detail,'items'),itemRows=Array.isArray(rawItems)?rawItems:[];
 const items:Extract<MhelpPrivateSample,{state:'sample_reviewed'}>['items']={state:rawItems===undefined?'absent':rawItems===null?'null':Array.isArray(rawItems)?'reviewed':'unsupported',totalEntries:Array.isArray(rawItems)?rawItems.length:null,truncated:itemRows.length>50,rows:itemRows.slice(0,50).map((row,index)=>{
  const belongs=plain(row)&&[['ticketId',selected.ticketId],['portalId',selected.portalId]].every(([key,expected])=>{const v=own(row,key);return v===undefined||v===null||v===0||(positive(v)&&v===Number(expected));});
  return {index,fields:Object.fromEntries(MHELP_PRIVATE_ITEM_FIELDS.map(key=>[key,belongs?safeCell(own(row,key),itemType(key)):{state:'unsupported'}])) as ItemRow['fields']};
 })};
 // Unknown collection variants stay diagnostic only. The fixed results rows
 // may qualify individually even when total-counter completeness is unverified.
 for(const collection of [appointments,...MHELP_APPOINTMENT_ENVELOPE_KEYS.map(key=>own(appointments,key))])if(Array.isArray(collection)&&collection.length>500)throw Error('mHelpDesk returned an oversized appointment page.');
 const rawRows=own(appointments,'results'),rows=Array.isArray(rawRows)?rawRows:[],total=own(appointments,'TotalRows');
 const supported=plain(appointments)&&Array.isArray(rawRows)&&typeof total==='number'&&Number.isSafeInteger(total)&&total>=rows.length&&total<=1000000&&MHELP_APPOINTMENT_ENVELOPE_KEYS.every(key=>key==='results'||key==='TotalRows'||!Object.hasOwn(appointments,key));
 const completeness=!supported?'unverified':total===rows.length?'complete':'incomplete';
 const matching=rows.map((row,index)=>({row,index})).filter(({row})=>matches(row,selected)),visible=matching.slice(0,50);
 return {...common(input,readAt),state:'sample_reviewed',selected:{portalId:selected.portalId,ticketId:selected.ticketId,ticketNumber:selected.ticketNumber},items,
  appointments:{state:'window_reviewed',completeness,sampledAppointments:rows.length,matchingAppointments:matching.length,suppressedAppointments:rows.length-visible.length,truncated:matching.length>50,rows:visible.map(({row,index})=>({index,fields:Object.fromEntries(MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS.map(key=>[key,safeCell(own(row,key),appointmentType(key))])) as AppointmentRow['fields']})),structure:structure(appointments,rows,selected,input.window.startDateUtc)}};
}
function denseRows(value:unknown,max=50):value is unknown[] {return Array.isArray(value)&&value.length<=max&&Object.keys(value).length===value.length&&Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).every(Boolean);}
function projectCell(value:unknown,type:Parameters<typeof cell>[1]):MhelpPrivateSampleCell {
 if(!plain(value))invalid();
 if(value.state==='value'){exact(value,['state','value']);const safe=cell(value.value,type);if(safe.state!=='value')invalid();return safe;}
 exact(value,['state']);if(!['absent','null','unsupported','suppressed'].includes(String(value.state)))invalid();return {state:value.state as 'absent'|'null'|'unsupported'|'suppressed'};
}
function projectCounts<T extends string>(value:unknown,keys:readonly T[],size:number):Partial<Record<T,number>> {
 if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key as T)))invalid();const counts:Partial<Record<T,number>>={};for(const key of keys)if(Object.hasOwn(value,key)){const n=count(value[key],size);if(!n)invalid();counts[key]=n;}if(Object.values(counts).reduce((n:number,v)=>n+Number(v),0)!==size)invalid();return counts;
}
function projectStructure(value:unknown,size:number):Structure {
 const row=exact(value,['rootKind','envelope','fields','suppressedRowKeys','rowKinds','emptyObjectRows','rootArrayEntries','suppressedEnvelopeKeys','userReferenceFormats','candidatePairs','aliasConflicts']);if(!KINDS.includes(row.rootKind as Kind))invalid();
 const rawEnvelope=exact(row.envelope,MHELP_APPOINTMENT_ENVELOPE_KEYS),envelope=Object.fromEntries(MHELP_APPOINTMENT_ENVELOPE_KEYS.map(key=>{
  const d=exact(rawEnvelope[key],['kind','integerCount','arrayEntries']);if(!KINDS.includes(d.kind as Kind))invalid();const counter=!['results','Results','data','Data'].includes(key),integerCount=d.integerCount===null?null:count(d.integerCount,1000000),arrayEntries=d.arrayEntries===null?null:count(d.arrayEntries);
  if(counter?(arrayEntries!==null||(integerCount!==null&&d.kind!=='integer')):(integerCount!==null||((d.kind==='array')!==(arrayEntries!==null))))invalid();return [key,{kind:d.kind,integerCount,arrayEntries}];
 })) as Structure['envelope'];
 if((envelope.results.arrayEntries??0)!==size)invalid();
 const rawFields=exact(row.fields,MHELP_PRIVATE_APPOINTMENT_FIELDS),fields=Object.fromEntries(MHELP_PRIVATE_APPOINTMENT_FIELDS.map(key=>{
  const d=exact(rawFields[key],['kinds','formats','emptyStrings','nonemptyStrings']);if(!plain(d.kinds)||Object.keys(d.kinds).some(k=>!KINDS.includes(k as Kind)))invalid();const kinds:FieldStructure['kinds']={};for(const k of KINDS)if(Object.hasOwn(d.kinds,k)){const n=count(d.kinds[k],size);if(!n)invalid();kinds[k]=n;}
  if(Object.values(kinds).reduce((n,v)=>n+v,0)!==size)invalid();const emptyStrings=count(d.emptyStrings,size),nonemptyStrings=count(d.nonemptyStrings,size);if(emptyStrings+nonemptyStrings!==(kinds.string||0))invalid();const formats=projectCounts(d.formats,FORMATS,kinds.string||0);return [key,{kinds,formats,emptyStrings,nonemptyStrings}];
 })) as Structure['fields'];
 const rowKinds=projectCounts(row.rowKinds,KINDS,size),objectRows=rowKinds.object||0,emptyObjectRows=count(row.emptyObjectRows,objectRows),rootArrayEntries=row.rootArrayEntries===null?null:count(row.rootArrayEntries);
 if((row.rootKind==='array')!==(rootArrayEntries!==null)||(row.rootKind!=='object'&&MHELP_APPOINTMENT_ENVELOPE_KEYS.some(key=>envelope[key].kind!=='absent')))invalid();
 const rawUsers=exact(row.userReferenceFormats,MHELP_APPOINTMENT_USER_FIELDS),userReferenceFormats=Object.fromEntries(MHELP_APPOINTMENT_USER_FIELDS.map(key=>[key,projectCounts(rawUsers[key],MHELP_APPOINTMENT_USER_FORMATS,fields[key].kinds.string||0)])) as Structure['userReferenceFormats'];
 const rawPairs=exact(row.candidatePairs,['comparable','matching','ticketAliasConflicts','portalAliasConflicts']);
 const pairCounts=(v:unknown)=>{if(!Array.isArray(v)||v.length!==16||Object.keys(v).length!==16||MHELP_APPOINTMENT_PAIRS.some((_,i)=>!Object.hasOwn(v,i)))invalid();return v.map(n=>count(n,objectRows-emptyObjectRows));};
 const comparable=pairCounts(rawPairs.comparable),matching=pairCounts(rawPairs.matching);MHELP_APPOINTMENT_PAIRS.forEach(([ticket,portal],i)=>{if(matching[i]>comparable[i]||comparable[i]>Math.min(fields[ticket].kinds.integer||0,fields[portal].kinds.integer||0))invalid();});
 const candidatePairs={comparable,matching,ticketAliasConflicts:count(rawPairs.ticketAliasConflicts,objectRows-emptyObjectRows),portalAliasConflicts:count(rawPairs.portalAliasConflicts,objectRows-emptyObjectRows)};
 const rawConflicts=exact(row.aliasConflicts,['identity','user','start','end']),aliasConflicts={identity:count(rawConflicts.identity,objectRows-emptyObjectRows),user:count(rawConflicts.user,objectRows-emptyObjectRows),start:count(rawConflicts.start,objectRows-emptyObjectRows),end:count(rawConflicts.end,objectRows-emptyObjectRows)};
 for(const f of Object.values(fields))if(size-(f.kinds.absent||0)>objectRows-emptyObjectRows)invalid();
 const suppressedEnvelopeKeys=count(row.suppressedEnvelopeKeys,1000000),suppressedRowKeys=count(row.suppressedRowKeys,1000000);if((row.rootKind!=='object'&&suppressedEnvelopeKeys!==0)||(objectRows===emptyObjectRows&&suppressedRowKeys!==0))invalid();
 return {rootKind:row.rootKind as Kind,envelope,fields,suppressedRowKeys,rowKinds,emptyObjectRows,rootArrayEntries,suppressedEnvelopeKeys,userReferenceFormats,candidatePairs,aliasConflicts};
}
// Identical to the fixed appointment-variant diagnostic classifier.
function userFormat(value:string):typeof MHELP_APPOINTMENT_USER_FORMATS[number] {
 if(/^\d{1,16}$/.test(value))return 'numeric';
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return 'uuid_like';
 if(value.length<=320&&/^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(value))return 'email_like';return 'other';
}
/** Visible literal observations must be a subset of the all-row diagnostics.
 * No combination of independently valid fragments can fabricate a linked row. */
function checkVisibleConsistency(rows:AppointmentRow[],structure:Structure,matching:number) {
 const nonempty=(structure.rowKinds.object||0)-structure.emptyObjectRows;
 const conflicts=Math.max(structure.candidatePairs.ticketAliasConflicts,structure.candidatePairs.portalAliasConflicts,...Object.values(structure.aliasConflicts));
 if(matching>nonempty-conflicts||matching>structure.candidatePairs.matching.reduce((n,v)=>n+v,0))invalid();
 for(const key of MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS){
  const cells=rows.map(row=>row.fields[key]),observed:Partial<Record<Kind,number>>={},formats:Partial<Record<Format,number>>={};let empty=0,nonemptyStrings=0;
  for(const c of cells){
   if(c.state==='value'){const k=kind(c.value);observed[k]=(observed[k]||0)+1;if(typeof c.value==='string'){const f=format(c.value);formats[f]=(formats[f]||0)+1;if(c.value.trim())nonemptyStrings++;else empty++;}}
   else if(c.state==='absent'||c.state==='null')observed[c.state]=(observed[c.state]||0)+1;
   else if(c.state==='suppressed')observed.string=(observed.string||0)+1;
  }
  const field=structure.fields[key];
  if(Object.entries(observed).some(([k,n])=>n>(field.kinds[k as Kind]||0))||Object.entries(formats).some(([f,n])=>n>(field.formats[f as Format]||0))||empty>field.emptyStrings||nonemptyStrings>field.nonemptyStrings||cells.filter(c=>c.state!=='absent').length>Object.values(field.kinds).reduce((n,v)=>n+v,0)-(field.kinds.absent||0))invalid();
 }
 for(const key of MHELP_APPOINTMENT_USER_FIELDS){
  const counts:Partial<Record<typeof MHELP_APPOINTMENT_USER_FORMATS[number],number>>={};
  for(const row of rows){const c=row.fields[key];if(c.state==='value'&&typeof c.value==='string'){const format=userFormat(c.value);counts[format]=(counts[format]||0)+1;}}
  if(MHELP_APPOINTMENT_USER_FORMATS.some(format=>(counts[format]||0)>(structure.userReferenceFormats[key][format]||0)))invalid();
 }
 MHELP_APPOINTMENT_PAIRS.forEach(([ticket,portal],i)=>{
  const visible=rows.filter(row=>row.fields[ticket].state==='value'&&row.fields[portal].state==='value').length;
  if(visible>structure.candidatePairs.comparable[i]||visible>structure.candidatePairs.matching[i])invalid();
 });
}
/** Defense in depth at the Owner route. Rebuild every nested allowlist and check
 * identity linkage again; never trust or spread the reader's untrusted result. */
export function projectMhelpPrivateSample(value:unknown):MhelpPrivateSample {
 if(!plain(value)||new TextEncoder().encode(JSON.stringify(value)).length>MHELP_PRIVATE_SAMPLE_MAX_BYTES)invalid();
 const commonKeys=['contract','scope','schema','identityMapping','sourceToCosMapping','automaticSync','ticketWrites','readAt','request','window','state'];
 if(value.contract!==MHELP_TICKET_PRIVATE_SAMPLE_CONTRACT||value.scope!=='single_ticket_appointment_day'||value.schema!=='unverified'||value.identityMapping!=='unverified'||value.sourceToCosMapping!=='unverified'||value.automaticSync!==false||value.ticketWrites!==false||typeof value.readAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.readAt)||!Number.isFinite(Date.parse(value.readAt)))invalid();
 const input=validateMhelpPrivateSampleRequest(value.request,new Date(value.readAt)),window=exact(value.window,Object.keys(input.window));for(const key of Object.keys(input.window) as (keyof typeof input.window)[])if(window[key]!==input.window[key])invalid();
 if(value.state==='selection_unavailable'){exact(value,[...commonKeys,'reason','selection']);if(!['ticket_not_found','ambiguous_ticket_number','incomplete_ticket_page'].includes(String(value.reason)))invalid();const selection=exact(value.selection,['pageLimit','sampledTickets','reportedTotal','matchingTickets']),sampledTickets=count(selection.sampledTickets),reportedTotal=count(selection.reportedTotal,1000000),matchingTickets=count(selection.matchingTickets,sampledTickets);if(selection.pageLimit!==500||reportedTotal<sampledTickets||(value.reason==='incomplete_ticket_page'?reportedTotal===sampledTickets:reportedTotal!==sampledTickets)||(value.reason==='ticket_not_found'&&matchingTickets!==0)||(value.reason==='ambiguous_ticket_number'&&matchingTickets<2))invalid();return unavailableMhelpPrivateSample(input,value.reason as Extract<MhelpPrivateSample,{state:'selection_unavailable'}>['reason'],{pageLimit:500,sampledTickets,reportedTotal,matchingTickets},value.readAt);}
 exact(value,[...commonKeys,'selected','items','appointments']);if(value.state!=='sample_reviewed')invalid();const selection=exact(value.selected,['portalId','ticketId','ticketNumber']),selected={portalId:id(selection.portalId),ticketId:id(selection.ticketId),ticketNumber:id(selection.ticketNumber)};if(selected.ticketNumber!==input.request.ticketNumber)invalid();
 const sourceItems=exact(value.items,['state','totalEntries','truncated','rows']);if(!['reviewed','absent','null','unsupported'].includes(String(sourceItems.state))||!denseRows(sourceItems.rows))invalid();const totalEntries=sourceItems.totalEntries===null?null:count(sourceItems.totalEntries,1000000);
 if(sourceItems.state==='reviewed'?(totalEntries===null||sourceItems.rows.length!==Math.min(totalEntries,50)||sourceItems.truncated!==(totalEntries>50)):(totalEntries!==null||sourceItems.rows.length!==0||sourceItems.truncated!==false))invalid();
 const itemRows=sourceItems.rows.map((v,i)=>{const row=exact(v,['index','fields']);if(row.index!==i)invalid();const fields=exact(row.fields,MHELP_PRIVATE_ITEM_FIELDS);return {index:i,fields:Object.fromEntries(MHELP_PRIVATE_ITEM_FIELDS.map(key=>[key,projectCell(fields[key],itemType(key))])) as ItemRow['fields']};});
 const a=exact(value.appointments,['state','completeness','sampledAppointments','matchingAppointments','suppressedAppointments','truncated','rows','structure']);if(a.state!=='window_reviewed'||!['complete','incomplete','unverified'].includes(String(a.completeness))||!denseRows(a.rows))invalid();
 const sampledAppointments=count(a.sampledAppointments),matchingAppointments=count(a.matchingAppointments,sampledAppointments),struct=projectStructure(a.structure,sampledAppointments),suppressedAppointments=count(a.suppressedAppointments,sampledAppointments);
 const env=struct.envelope,supported=struct.rootKind==='object'&&env.results.kind==='array'&&env.TotalRows.integerCount!==null&&env.TotalRows.integerCount>=sampledAppointments&&MHELP_APPOINTMENT_ENVELOPE_KEYS.every(key=>key==='results'||key==='TotalRows'||env[key].kind==='absent');
 const completeness=!supported?'unverified':env.TotalRows.integerCount===sampledAppointments?'complete':'incomplete';if(a.completeness!==completeness||a.rows.length!==Math.min(matchingAppointments,50)||suppressedAppointments!==sampledAppointments-a.rows.length||a.truncated!==(matchingAppointments>50))invalid();
 let previous=-1;const appointmentRows=a.rows.map(v=>{const row=exact(v,['index','fields']),index=count(row.index,sampledAppointments-1);if(index<=previous)invalid();previous=index;const source=exact(row.fields,MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS),fields=Object.fromEntries(MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS.map(key=>[key,projectCell(source[key],appointmentType(key))])) as AppointmentRow['fields'];
  const literal:Row={};for(const key of MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS){const c=fields[key];if(c.state==='value')literal[key]=c.value;else if(c.state!=='absent')literal[key]=null;}
  if(!matches(literal,selected))invalid();return {index,fields};
 });
 checkVisibleConsistency(appointmentRows,struct,matchingAppointments);
 return {...common(input,value.readAt),state:'sample_reviewed',selected,items:{state:sourceItems.state as 'reviewed'|'absent'|'null'|'unsupported',totalEntries,truncated:sourceItems.truncated as boolean,rows:itemRows},appointments:{state:'window_reviewed',completeness,sampledAppointments,matchingAppointments,suppressedAppointments,truncated:a.truncated as boolean,rows:appointmentRows,structure:struct}};
}
