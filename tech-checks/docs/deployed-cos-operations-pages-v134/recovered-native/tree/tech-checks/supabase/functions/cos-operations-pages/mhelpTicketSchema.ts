/** Fixed-shape structural evidence only. Never return values, untrusted keys or samples. */
const FIELDS = {
  ticketTypes:['typeId','portalId','typeName','isActive'],
  ticketStatuses:['statusId','statusText','displayText','parentId','canBeParent'],
  tickets:['ticketId','ticketNumber','portalId','typeId','typeName','statusId','customStatusId','deleted','creationDate','lastModDate','customerId','serviceLocationId','assignedTo'],
} as const;
const KINDS = ['absent','null','boolean','integer','number','string','array','object','other'] as const;
const FORMATS = ['numeric','iso_with_zone','iso_without_zone','dotnet','other'] as const;
type Kind=typeof KINDS[number];
type Format=typeof FORMATS[number];
type Section=keyof typeof FIELDS;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function kind(v:unknown):Kind {
  if(v===undefined)return 'absent'; if(v===null)return 'null';
  if(Array.isArray(v))return 'array'; if(typeof v==='number')return Number.isSafeInteger(v)?'integer':'number';
  return ['boolean','string','object'].includes(typeof v)?typeof v as Kind:'other';
}
function format(v:string):Format {
  if(/^\d{1,16}$/.test(v))return 'numeric';
  if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(v))return 'iso_with_zone';
  if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(v))return 'iso_without_zone';
  if(/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(v))return 'dotnet';
  return 'other';
}
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1000000?v:null;
function collection(value:unknown,section:Section) {
  const rows=Array.isArray(value)?value.slice(0,50):[];
  return {kind:kind(value),length:Array.isArray(value)?count(value.length):null,sampled:rows.length,
    fields:Object.fromEntries((rows.length?FIELDS[section]:[]).map(field=>{
      const kinds=Object.fromEntries(KINDS.map(k=>[k,0])) as Record<Kind,number>;
      const formats=Object.fromEntries(FORMATS.map(k=>[k,0])) as Record<Format,number>;
      for(const row of rows){const v=plain(row)?row[field]:undefined;kinds[kind(v)]++;if(typeof v==='string')formats[format(v)]++;}
      return [field,{kinds:Object.fromEntries(Object.entries(kinds).filter(([,n])=>n>0)),formats:Object.fromEntries(Object.entries(formats).filter(([,n])=>n>0))}];
    }))};
}
export function describeMhelpTicketSchema(value:unknown,section:Section) {
  const row=plain(value)?value:{};
  return {kind:kind(value),totalRowsKind:kind(row.totalRows),totalRows:count(row.totalRows),
    topLevel:collection(value,section),data:collection(row.data,section),results:collection(row.results,section)};
}
/** Rebuild known sections/fields/counters before logging even an attached/forged error. */
export function projectMhelpTicketSchema(value:unknown) {
  if(!plain(value))return null;
  const safeKind=(v:unknown)=>KINDS.includes(v as Kind)?v as Kind:'other';
  const result:Record<string,unknown>={};
  for(const section of Object.keys(FIELDS) as Section[]) {
    const row=value[section];if(!plain(row))continue;
    const output:Record<string,unknown>={kind:safeKind(row.kind),totalRowsKind:safeKind(row.totalRowsKind),totalRows:count(row.totalRows)};
    for(const key of ['topLevel','data','results']) {
      const source=row[key];if(!plain(source))continue;
      const fields=plain(source.fields)?source.fields:{};
      output[key]={kind:safeKind(source.kind),length:count(source.length),sampled:typeof source.sampled==='number'&&source.sampled<=50?count(source.sampled):null,
        fields:Object.fromEntries((typeof source.sampled==='number'&&source.sampled>0&&source.sampled<=50?FIELDS[section]:[]).map(field=>{
          const f=plain(fields[field])?fields[field] as Record<string,unknown>:{};
          const kinds=plain(f.kinds)?f.kinds:{},formats=plain(f.formats)?f.formats:{};
          const bounded=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=50?n:0;
          return [field,{kinds:Object.fromEntries(KINDS.filter(k=>bounded(kinds[k])>0).map(k=>[k,bounded(kinds[k])])),formats:Object.fromEntries(FORMATS.filter(k=>bounded(formats[k])>0).map(k=>[k,bounded(formats[k])]))}];
        }))};
    }
    result[section]=output;
  }
  if(!Object.keys(result).length)return null;
  if(new TextEncoder().encode(JSON.stringify(result)).length>6000){
    for(const section of Object.keys(result)){
      const row=result[section] as Record<string,unknown>;
      for(const key of ['topLevel','data','results'])if(plain(row[key])){
        const source=row[key] as Record<string,unknown>;
        row[key]={kind:source.kind,length:source.length,sampled:source.sampled};
      }
    }
    result.truncated=true;
  }
  return result;
}

/** Owner opt-in success evidence. Keys below come from the vendor's Ticket Get,
 * Ticket Item Get and Ticket Custom Field models; never enumerate source keys.
 * https://www.mhelpdesk.com/partner-api/models.html
 * These are shapes of an already-read sample, not operational readiness claims.
 */
export const MHELP_OPERATIONAL_EVIDENCE = 'operational_structure_v1' as const;
const OPERATIONAL_FIELDS = ['subject','summary','comment','scheduledDate','neededBy','serviceLocationId'] as const;
const NESTED_FIELDS = {
  items:['ticketItemId','priceListId','priceListTypeId','name','description','quantity'],
  customFields:['customFieldId','fieldValue','fieldLabel'],
} as const;
const SAMPLE_LIMIT=50, MAX_EVIDENCE_BYTES=12000;
type Counts<T extends string> = Partial<Record<T,number>>;
type FieldEvidence = {kinds:Counts<Kind>;formats:Counts<Format>;emptyStrings:number;nonemptyStrings:number};
type CollectionEvidence = {kinds:Counts<Kind>;emptyArrays:number;nonemptyArrays:number;totalEntries:number;sampledEntries:number;entryKinds:Counts<Kind>;fields:Record<string,FieldEvidence>};
export type MhelpOperationalEvidence = {
  contract:'cos-mhelpdesk-operational-evidence-v1';scope:'first_ticket_page';ticketSampleLimit:50;nestedSampleLimit:50;
  sampledTickets:number;siteIdTickets:number;fields:Record<typeof OPERATIONAL_FIELDS[number],FieldEvidence>;
  collections:Record<keyof typeof NESTED_FIELDS,CollectionEvidence>;
};
const own=(row:unknown,key:string):unknown=>plain(row)&&Object.hasOwn(row,key)?row[key]:undefined;
function distribution<T extends string>(values:readonly unknown[],classify:(value:unknown)=>T):Counts<T> {
  const result:Counts<T>={};for(const value of values){const key=classify(value);result[key]=(result[key]||0)+1;}return result;
}
function fieldEvidence(values:readonly unknown[]):FieldEvidence {
  const strings=values.filter((value):value is string=>typeof value==='string');
  const emptyStrings=strings.filter(value=>!value.trim()).length;
  return {kinds:distribution(values,kind),formats:distribution(strings,value=>format(value as string)),emptyStrings,nonemptyStrings:strings.length-emptyStrings};
}
function operationalCollection(rows:readonly unknown[],key:keyof typeof NESTED_FIELDS):CollectionEvidence {
  const values=rows.map(row=>own(row,key)),arrays=values.filter(Array.isArray),entries:unknown[]=[];
  let totalEntries=0;
  for(const array of arrays){totalEntries+=array.length;entries.push(...array.slice(0,SAMPLE_LIMIT-entries.length));}
  return {kinds:distribution(values,kind),emptyArrays:arrays.filter(array=>array.length===0).length,nonemptyArrays:arrays.filter(array=>array.length>0).length,
    totalEntries,sampledEntries:entries.length,entryKinds:distribution(entries,kind),
    fields:Object.fromEntries(NESTED_FIELDS[key].map(field=>[field,fieldEvidence(entries.map(row=>own(row,field)))]))};
}
/** Receives only the first validated ticket page. It never fetches or expands rows. */
export function describeMhelpOperationalEvidence(firstPage:readonly unknown[],totalTickets:number):MhelpOperationalEvidence {
  const rows=firstPage.slice(0,SAMPLE_LIMIT);
  const result={contract:'cos-mhelpdesk-operational-evidence-v1',scope:'first_ticket_page',ticketSampleLimit:SAMPLE_LIMIT,nestedSampleLimit:SAMPLE_LIMIT,
    sampledTickets:rows.length,siteIdTickets:rows.filter(row=>{
      const value=own(row,'serviceLocationId');return typeof value==='number'?Number.isSafeInteger(value)&&value>0:typeof value==='string'&&/^[1-9]\d{0,14}$/.test(value)&&Number.isSafeInteger(Number(value));
    }).length,
    fields:Object.fromEntries(OPERATIONAL_FIELDS.map(field=>[field,fieldEvidence(rows.map(row=>own(row,field)))])),
    collections:{items:operationalCollection(rows,'items'),customFields:operationalCollection(rows,'customFields')}};
  return projectMhelpOperationalEvidence(result,totalTickets);
}
/** Rebuild every level and reject malformed counters, source keys and unbounded
 * evidence. Unlike failure diagnostics, success must be complete, not truncated.
 */
export function projectMhelpOperationalEvidence(value:unknown,totalTickets:number):MhelpOperationalEvidence {
  const invalid=():never=>{throw Error('Unsupported mHelpDesk operational evidence.');};
  const exact=(value:unknown,keys:readonly string[]):Record<string,unknown>=>{
    if(!plain(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))invalid();
    return value as Record<string,unknown>;
  };
  const integer=(value:unknown,max=SAMPLE_LIMIT):number=>{
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)invalid();return value as number;
  };
  const counters=<T extends string>(value:unknown,keys:readonly T[],size:number):Counts<T>=>{
    if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key as T)))invalid();
    const source=value as Record<string,unknown>,result:Counts<T>={};
    for(const key of keys)if(Object.hasOwn(source,key)){const n=integer(source[key],size);if(n===0)invalid();result[key]=n;}
    if(Object.values(result).reduce((sum:number,n)=>sum+Number(n),0)!==size)invalid();return result;
  };
  const descriptor=(value:unknown,size:number):FieldEvidence=>{
    const row=exact(value,['kinds','formats','emptyStrings','nonemptyStrings']),kinds=counters(row.kinds,KINDS,size),formats=counters(row.formats,FORMATS,kinds.string||0);
    const emptyStrings=integer(row.emptyStrings,size),nonemptyStrings=integer(row.nonemptyStrings,size);
    if(emptyStrings+nonemptyStrings!==(kinds.string||0))invalid();
    return {kinds,formats,emptyStrings,nonemptyStrings};
  };
  const row=exact(value,['contract','scope','ticketSampleLimit','nestedSampleLimit','sampledTickets','siteIdTickets','fields','collections']);
  if(row.contract!=='cos-mhelpdesk-operational-evidence-v1'||row.scope!=='first_ticket_page'||row.ticketSampleLimit!==SAMPLE_LIMIT||row.nestedSampleLimit!==SAMPLE_LIMIT)invalid();
  const sampledTickets=integer(row.sampledTickets),siteIdTickets=integer(row.siteIdTickets,sampledTickets);
  if(sampledTickets!==Math.min(integer(totalTickets,500),SAMPLE_LIMIT))invalid();
  const inputFields=exact(row.fields,OPERATIONAL_FIELDS);
  const fields=Object.fromEntries(OPERATIONAL_FIELDS.map(field=>[field,descriptor(inputFields[field],sampledTickets)])) as MhelpOperationalEvidence['fields'];
  if(siteIdTickets>(fields.serviceLocationId.kinds.integer||0)+(fields.serviceLocationId.kinds.string||0))invalid();
  const inputCollections=exact(row.collections,['items','customFields']);
  const collections=Object.fromEntries((['items','customFields'] as const).map(key=>{
    const source=exact(inputCollections[key],['kinds','emptyArrays','nonemptyArrays','totalEntries','sampledEntries','entryKinds','fields']);
    const kinds=counters(source.kinds,KINDS,sampledTickets),emptyArrays=integer(source.emptyArrays,sampledTickets),nonemptyArrays=integer(source.nonemptyArrays,sampledTickets);
    const totalEntries=integer(source.totalEntries,1000000),sampledEntries=integer(source.sampledEntries),entryKinds=counters(source.entryKinds,KINDS,sampledEntries);
    if(emptyArrays+nonemptyArrays!==(kinds.array||0)||totalEntries<nonemptyArrays||(totalEntries===0)!==(nonemptyArrays===0)||sampledEntries!==Math.min(totalEntries,SAMPLE_LIMIT))invalid();
    const input=exact(source.fields,NESTED_FIELDS[key]);
    return [key,{kinds,emptyArrays,nonemptyArrays,totalEntries,sampledEntries,entryKinds,fields:Object.fromEntries(NESTED_FIELDS[key].map(field=>[field,descriptor(input[field],sampledEntries)]))}];
  })) as MhelpOperationalEvidence['collections'];
  const result:MhelpOperationalEvidence={contract:'cos-mhelpdesk-operational-evidence-v1',scope:'first_ticket_page',ticketSampleLimit:SAMPLE_LIMIT,nestedSampleLimit:SAMPLE_LIMIT,sampledTickets,siteIdTickets,fields,collections};
  if(new TextEncoder().encode(JSON.stringify(result)).length>MAX_EVIDENCE_BYTES)invalid();
  return result;
}
