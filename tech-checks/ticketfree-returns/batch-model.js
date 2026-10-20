// Selections use exact family-qualified identities, never a number-only join.
export const selectionKey = item => item.equipment_key || 'truck:' + item.family + ':' + item.unit_tag;
export const itemName = item => item.name || item.family + ' ' + item.unit_tag;
export const itemReason = item => item.reason || (item.usedKey ? 'swap' : item.source === 'truck' ? 'truck_return' : 'pickup');
export const reasonLabel = reason => ({swap:'Return from swap',pickup:'Pickup from site',truck_return:'Unused truck equipment'}[reason] || 'Return reason unavailable');
export const savedReturnReason = item => item.used_key || item.source_mode === 'swap' ? 'swap' : ({field_return:'pickup',truck_return:'truck_return'}[item.source_mode]);
export function batchDraft(saved, equipment = []) {
 if (saved.items) return {...saved,tab:saved.tab==='site'?'pickup':saved.tab||'truck',items:saved.items.map(item=>({...item,reason:itemReason(item)}))};
 const request = saved.request;
 const key = request?.p_returned_key || saved.returnedKey;
 const entry = equipment.find(e => e.equipment_key === key);
 const items = key ? [{id: request?.p_request_id || saved.id, equipment_key:key, family:entry?.family || '',unit_tag:entry?.unit_tag || '',name:entry?.name || key,usedKey:request?.p_used_key || saved.usedKey || '',source:'site'}] : [];
 return {...saved,items,tab:'truck',query:'',family:'',page:0,request:request ? {p_items:[{request_id:request.p_request_id,returned_key:request.p_returned_key,used_key:request.p_used_key,notes:request.p_notes,photos:request.p_photos}]} : null};
}
export function selectItem(draft, entry, source) {
 const key=selectionKey(entry),at=draft.items.findIndex(e=>selectionKey(e)===key);
 if(at>=0){draft.items.splice(at,1);return;}
 const reason=source==='truck'?'truck_return':source==='swap'?'swap':'pickup';
 draft.items.push({...entry,id:crypto.randomUUID(),source:source==='truck'?'truck':'site',reason,usedKey:reason==='swap'?draft.pendingUsedKey||'':''});
 if(reason==='swap')draft.pendingUsedKey='';
}
export function cataloguePage(equipment, query='', family='', page=0, size=24) {
 const tokens=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 const all=equipment.filter(e=>(!family||e.family===family)&&tokens.every(t=>(itemName(e)+' '+e.equipment_key).toLowerCase().includes(t)));
 const pages=Math.max(1,Math.ceil(all.length/size)),current=Math.max(0,Math.min(page,pages-1));
 return {items:all.slice(current*size,(current+1)*size),count:all.length,page:current,pages,start:all.length?current*size+1:0,end:Math.min((current+1)*size,all.length)};
}
export async function prepareBatch(draft,client) {
 if(!draft.items.length)throw new Error('Select at least one unit to return.');
 if(draft.items.length>24)throw new Error('Send up to 24 units at a time.');
 const keys=draft.items.map(selectionKey),used=draft.items.map(i=>i.usedKey).filter(Boolean);
 if(new Set(keys).size!==keys.length||new Set(used).size!==used.length||used.some(k=>keys.includes(k)))throw new Error('A unit cannot be returned and installed at the same time, or used in two swaps.');
 for(const item of draft.items){
  const reason=itemReason(item);
  if(reason==='swap'&&!item.usedKey)throw new Error('Select the equipment used from your truck for the swap returning '+itemName(item)+'.');
  if(reason!=='swap'&&item.usedKey)throw new Error('Only a swap can remove installed replacement equipment from your truck.');
 }
 const items=[];
 for(const item of draft.items){
  client.assert();
  items.push({request_id:item.id,returned_key:item.equipment_key||null,unlinked_family:item.equipment_key?null:item.family,unlinked_tag:item.equipment_key?null:item.unit_tag,used_key:item.usedKey||null,notes:draft.notes,photos:await client.paths(item.id,draft.photos)});
 }
 return {p_items:items};
}
