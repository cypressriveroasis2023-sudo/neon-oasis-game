// Search only: exact equipment keys and server eligibility remain authoritative.
const tokens=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z]+|[0-9]+/g)||[];
const normalized=value=>tokens(value).map(t=>/^\d+$/.test(t)?t.replace(/^0+(?=\d)/,''):t);
export function matchesEquipment(item,query){
 const wanted=normalized(query);if(!wanted.length)return !String(query).trim();
 const words=normalized([item.unit_name,item.family,item.unit_tag,item.equipment_key,item.workflow_type].filter(Boolean).join(' '));
 const compact=words.join('');
 return wanted.every(word=>/^\d+$/.test(word)?words.includes(word):words.some(w=>w.includes(word))||compact.includes(word));
}
export function equipmentHold(item){
 return item.hold_reason||(item.reserved?'Already held or reserved':!item.supported?'Equipment mapping needs review':item.tracker_state==='field'?'In Field — unavailable for Shop handoff':item.tracker_state!=='shop'?'Shop placement is not verified':'');
}
export function equipmentEligible(item){return !!item&&!item.reserved&&!!item.supported&&item.tracker_state==='shop'&&!item.hold_reason;}
