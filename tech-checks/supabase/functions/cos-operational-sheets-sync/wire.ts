/** Google omits zero offsets and default-false properties on the wire.
 * Normalize representation only; never add a row, identity, placement or cell.
 * This adapter keeps the reviewed strict parser's semantic checks intact. */
type Row=Record<string,unknown>;
const object=(value:unknown):value is Row=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(!object(value))return value;
 return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
export function normalizeGoogleSheetWire(value:unknown):unknown {
 if(!object(value)||!Array.isArray(value.sheets))return value;
 return {...value,sheets:value.sheets.map(sheet=>{
  if(!object(sheet)||!object(sheet.properties))return sheet;
  const properties=canonical({...sheet.properties,hidden:sheet.properties.hidden??false});
  const data=Array.isArray(sheet.data)?sheet.data.map(block=>object(block)?{...block,startColumn:block.startColumn??0,startRow:block.startRow??0}:block):sheet.data;
  return {...sheet,properties,...(data===undefined?{}:{data})};
 })};
}
