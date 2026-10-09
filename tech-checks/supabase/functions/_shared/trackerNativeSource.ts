/** V3 extends Google provenance to existing native equipment. It never supplies
 * provider/camera identity. Preserve the full family, number, leading zeroes and
 * suffix; the broad placement normalizer is deliberately not used here. */
export const trackerRecordId=(v:unknown):v is string=>typeof v==='string'&&v.length<=400&&/^google_sheet:[A-Za-z0-9_-]{10,128}:(?:0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$/.test(v);
export function validNativeTrackerLabel(value:Record<string,any>):boolean{
 if(!trackerRecordId(value.sourceRecordId))return false;
 const [family,number]=value.sourceRecordId.slice(value.sourceRecordId.lastIndexOf(':')+1).split('|');
 return value.unitNumber===family+' '+number&&value.family===family&&value.variant===null;
}
export const unsupportedSourceVersion=(value:Record<string,any>)=>value.schemaVersion!==undefined&&![1,2,3].includes(value.schemaVersion);
