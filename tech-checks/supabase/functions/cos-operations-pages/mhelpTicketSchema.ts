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
