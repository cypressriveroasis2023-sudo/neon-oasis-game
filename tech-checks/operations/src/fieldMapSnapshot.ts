/** Compare the complete validated public map payload, ignoring only its top-level read clock.
 * This preserves an unchanged display snapshot; it grants no proof or action authority.
 * Arrays and every row, marker, proof, alias, review, and source field remain significant.
 */
export function sameFieldMapSourceSnapshot(previous:unknown,next:unknown):boolean{
  const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
  if(!object(previous)||!object(next)||!Array.isArray(previous.items)||!Array.isArray(next.items))return false;
  const canonical=(snapshot:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(snapshot).filter(([key])=>key!=='generatedAt')),
    (_key,value)=>object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
  return canonical(previous)===canonical(next);
}
