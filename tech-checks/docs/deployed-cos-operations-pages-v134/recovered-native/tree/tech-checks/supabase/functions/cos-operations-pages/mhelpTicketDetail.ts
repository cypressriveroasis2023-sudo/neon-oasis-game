/** Structural-only detail evidence. Contract verified against the locally saved
 * official models.html and its endpoint index, not a live vendor sample.
 * GET /portal/{portal_id}/Tickets/{ticket_id} returns the flat Ticket Get object.
 * This module has no network, persistence, joins or operational mapping capability.
 */
export const MHELP_TICKET_DETAIL_EVIDENCE = 'ticket_detail_structure_v1' as const;
const CONTRACT = 'cos-mhelpdesk-ticket-detail-evidence-v1' as const;
const SCOPE = 'single_server_selected_ticket' as const;
const KINDS = ['absent','null','boolean','integer','number','string','array','object','other'] as const;
const FORMATS = ['numeric','iso_with_zone','iso_without_zone','dotnet','other'] as const;
const FIELDS = ['subject','summary','comment','customerId','serviceLocationId','categoryId','priority','typeId','typeName','statusId','customStatusId','ticketStatus','assignedTo','deleted','creationDate','lastModDate','scheduledDate','neededBy','appointmentCount','estimatedTime','lastCalledDate','nextCallDate','parentTicketId','originalTicketId','recurringRuleId','generatedByRecurring','businessUnitId'] as const;
const NESTED_FIELDS = {
  items:['ticketItemId','ticketId','portalId','priceListId','priceListTypeId','name','description','quantity','currentStatus','notes','startTime','dateEntry','durationSeconds','groupId','lastUpdateUTC','sortNumber'],
  customFields:['id','customFieldId','fieldValue','fieldLabel','sortOrder','isRequired'],
  // Only POST/PUT document equipment: array[number]. Presence in a GET, even
  // numeric entries, cannot prove its schema, asset identity, or workflow meaning.
  equipment:[],
} as const;
const LIMIT=50,MAX_BYTES=16000;
type Kind=typeof KINDS[number];type Format=typeof FORMATS[number];
type Counts<T extends string>=Partial<Record<T,number>>;
type FieldEvidence={kinds:Counts<Kind>;formats:Counts<Format>;emptyStrings:number;nonemptyStrings:number};
type CollectionEvidence={kinds:Counts<Kind>;emptyArrays:number;nonemptyArrays:number;totalEntries:number;sampledEntries:number;entryKinds:Counts<Kind>;fields:Record<string,FieldEvidence>};
type Availability={description:'nonempty_text_present'|'nonempty_text_absent';site:'unresolved_no_join';equipment:'unverified_write_model_candidate';schedule:'unverified_deprecated_get_fields';items:'unmapped_structures_only';customFields:'unmapped_structures_only'};
export type MhelpTicketDetailEvidence = {
  contract:typeof CONTRACT;scope:typeof SCOPE;state:'selection_unavailable';reason:'empty_window'|'ambiguous_window';sampledTickets:0;
}|{
  contract:typeof CONTRACT;scope:typeof SCOPE;state:'detail_verified';sampledTickets:1;nestedSampleLimit:50;
  fields:Record<typeof FIELDS[number],FieldEvidence>;collections:Record<keyof typeof NESTED_FIELDS,CollectionEvidence>;availability:Availability;
};
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
  if(/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(value))return 'dotnet';
  return 'other';
}
function distribution<T extends string>(values:readonly unknown[],classify:(value:unknown)=>T):Counts<T> {
  const result:Counts<T>={};for(const value of values){const key=classify(value);result[key]=(result[key]||0)+1;}return result;
}
function field(values:readonly unknown[]):FieldEvidence {
  const strings=values.filter((value):value is string=>typeof value==='string'),emptyStrings=strings.filter(value=>!value.trim()).length;
  return {kinds:distribution(values,kind),formats:distribution(strings,value=>format(value as string)),emptyStrings,nonemptyStrings:strings.length-emptyStrings};
}
function collection(row:unknown,key:keyof typeof NESTED_FIELDS):CollectionEvidence {
  const value=own(row,key),entries=Array.isArray(value)?value.slice(0,LIMIT):[];
  return {kinds:distribution([value],kind),emptyArrays:Number(Array.isArray(value)&&value.length===0),nonemptyArrays:Number(Array.isArray(value)&&value.length>0),
    totalEntries:Array.isArray(value)?value.length:0,sampledEntries:entries.length,entryKinds:distribution(entries,kind),
    fields:Object.fromEntries(NESTED_FIELDS[key].map(key=>[key,field(entries.map(entry=>own(entry,key)))]))};
}
function availability(fields:Record<string,FieldEvidence>):Availability {
  return {description:['subject','summary','comment'].some(key=>fields[key].nonemptyStrings>0)?'nonempty_text_present':'nonempty_text_absent',
    site:'unresolved_no_join',equipment:'unverified_write_model_candidate',schedule:'unverified_deprecated_get_fields',items:'unmapped_structures_only',customFields:'unmapped_structures_only'};
}
export function unavailableMhelpTicketDetail(totalTickets:number):MhelpTicketDetailEvidence {
  return projectMhelpTicketDetailEvidence({contract:CONTRACT,scope:SCOPE,state:'selection_unavailable',reason:totalTickets===0?'empty_window':'ambiguous_window',sampledTickets:0},totalTickets);
}
/** Call only after the reader verifies detail identity, snapshot and source window. */
export function describeMhelpTicketDetail(value:unknown):MhelpTicketDetailEvidence {
  const fields=Object.fromEntries(FIELDS.map(key=>[key,field([own(value,key)])]));
  return projectMhelpTicketDetailEvidence({contract:CONTRACT,scope:SCOPE,state:'detail_verified',sampledTickets:1,nestedSampleLimit:LIMIT,
    fields,collections:Object.fromEntries((Object.keys(NESTED_FIELDS) as (keyof typeof NESTED_FIELDS)[]).map(key=>[key,collection(value,key)])),availability:availability(fields)},1);
}
/** Exact, bounded allowlist at every level: forged counters/keys/state fail closed. */
export function projectMhelpTicketDetailEvidence(value:unknown,totalTickets:number):MhelpTicketDetailEvidence {
  const invalid=():never=>{throw Error('Unsupported mHelpDesk ticket detail evidence.');};
  const exact=(value:unknown,keys:readonly string[]):Record<string,unknown>=>{
    if(!plain(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))invalid();return value as Record<string,unknown>;
  };
  const integer=(value:unknown,max=LIMIT):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)invalid();return value as number;};
  const counters=<T extends string>(value:unknown,keys:readonly T[],size:number):Counts<T>=>{
    if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key as T)))invalid();
    const source=value as Record<string,unknown>,result:Counts<T>={};
    for(const key of keys)if(Object.hasOwn(source,key)){const n=integer(source[key],size);if(n===0)invalid();result[key]=n;}
    if(Object.values(result).reduce((sum:number,n)=>sum+Number(n),0)!==size)invalid();return result;
  };
  const descriptor=(value:unknown,size:number):FieldEvidence=>{
    const row=exact(value,['kinds','formats','emptyStrings','nonemptyStrings']),kinds=counters(row.kinds,KINDS,size),formats=counters(row.formats,FORMATS,kinds.string||0);
    const emptyStrings=integer(row.emptyStrings,size),nonemptyStrings=integer(row.nonemptyStrings,size);
    if(emptyStrings+nonemptyStrings!==(kinds.string||0))invalid();return {kinds,formats,emptyStrings,nonemptyStrings};
  };
  integer(totalTickets,500);
  if(!plain(value))invalid();const row=value as Record<string,unknown>;
  if(row.contract!==CONTRACT||row.scope!==SCOPE)invalid();
  if(row.state==='selection_unavailable'){
    exact(row,['contract','scope','state','reason','sampledTickets']);
    if(totalTickets===1||row.sampledTickets!==0||row.reason!==(totalTickets===0?'empty_window':'ambiguous_window'))invalid();
    return {contract:CONTRACT,scope:SCOPE,state:'selection_unavailable',reason:row.reason as 'empty_window'|'ambiguous_window',sampledTickets:0};
  }
  exact(row,['contract','scope','state','sampledTickets','nestedSampleLimit','fields','collections','availability']);
  if(row.state!=='detail_verified'||totalTickets!==1||row.sampledTickets!==1||row.nestedSampleLimit!==LIMIT)invalid();
  const inputFields=exact(row.fields,FIELDS),fields=Object.fromEntries(FIELDS.map(key=>[key,descriptor(inputFields[key],1)])) as Record<typeof FIELDS[number],FieldEvidence>;
  const inputCollections=exact(row.collections,Object.keys(NESTED_FIELDS));
  const collections=Object.fromEntries((Object.keys(NESTED_FIELDS) as (keyof typeof NESTED_FIELDS)[]).map(key=>{
    const source=exact(inputCollections[key],['kinds','emptyArrays','nonemptyArrays','totalEntries','sampledEntries','entryKinds','fields']);
    const kinds=counters(source.kinds,KINDS,1),emptyArrays=integer(source.emptyArrays,1),nonemptyArrays=integer(source.nonemptyArrays,1),totalEntries=integer(source.totalEntries,1000000);
    const sampledEntries=integer(source.sampledEntries),entryKinds=counters(source.entryKinds,KINDS,sampledEntries);
    if(emptyArrays+nonemptyArrays!==(kinds.array||0)||totalEntries<nonemptyArrays||(totalEntries===0)!==(nonemptyArrays===0)||sampledEntries!==Math.min(totalEntries,LIMIT))invalid();
    const input=exact(source.fields,NESTED_FIELDS[key]);
    const fields=Object.fromEntries(NESTED_FIELDS[key].map(field=>[field,descriptor(input[field],sampledEntries)]));
    if(Object.values(fields).some(field=>(field.kinds.absent||0)<sampledEntries-(entryKinds.object||0)))invalid();
    return [key,{kinds,emptyArrays,nonemptyArrays,totalEntries,sampledEntries,entryKinds,fields}];
  })) as Record<keyof typeof NESTED_FIELDS,CollectionEvidence>;
  const available=availability(fields),inputAvailability=exact(row.availability,Object.keys(available));
  for(const key of Object.keys(available) as (keyof Availability)[])if(inputAvailability[key]!==available[key])invalid();
  const result:MhelpTicketDetailEvidence={contract:CONTRACT,scope:SCOPE,state:'detail_verified',sampledTickets:1,nestedSampleLimit:LIMIT,fields,collections,availability:available};
  if(new TextEncoder().encode(JSON.stringify(result)).length>MAX_BYTES)invalid();return result;
}

const CORE_FIELDS=['portalId','ticketId','ticketNumber','creationDate','lastModDate','deleted','statusId','assignedTo'] as const;
/** Fixed wrapper/core-field kind evidence for a failed flat GET, never source keys. */
export function describeMhelpTicketDetailFailure(value:unknown) {
  return Object.fromEntries(['root','data','results'].map(key=>{
    const row=key==='root'?value:own(value,key);
    return [key,{kind:kind(row),fields:Object.fromEntries(CORE_FIELDS.map(field=>[field,kind(own(row,field))]))}];
  }));
}
export function projectMhelpTicketDetailFailure(value:unknown) {
  const safeKind=(value:unknown)=>KINDS.includes(value as Kind)?value as Kind:'other';
  return Object.fromEntries(['root','data','results'].map(key=>{
    const row=own(value,key),fields=own(row,'fields');
    return [key,{kind:safeKind(own(row,'kind')),fields:Object.fromEntries(CORE_FIELDS.map(field=>[field,safeKind(own(fields,field))]))}];
  }));
}
