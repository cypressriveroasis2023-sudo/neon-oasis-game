// Transfer custody is separate from placement, health and permanent truck stock.
export const TRANSFER_STATEMENT = 'I physically checked the equipment listed in this transfer. My entries and photos accurately record what I handed over, received or returned.';
export const INTAKE_CHECKS = Object.freeze(['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok']);
export const isPhoneSurface = (windowObject = window) => windowObject.matchMedia('(max-width: 900px)').matches;
export const exactString = value => typeof value === 'string' ? value.trim() : '';
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function normalizeManifest(items, {allowEmpty=false}={}) {
  if (!Array.isArray(items) || (!allowEmpty && items.length < 1) || items.length > 20) throw new Error('Select 1 to 20 equipment units.');
  const keys=new Set(), allSims=new Set();
  return items.map(item => {
    const key=exactString(item.equipment_key),family=exactString(item.family),tag=exactString(item.unit_tag);
    if (!key || !family || !tag || keys.has(key)) throw new Error('Each item needs its exact saved equipment identity.');
    keys.add(key);
    if (!Array.isArray(item.sims) || item.sims.length>10 || item.sims.some(s=>!exactString(s)||typeof s!=='string'||s.length>100)) throw new Error('Enter SIM numbers as exact text, not numbers.');
    const sims=item.sims.map(exactString).sort();
    for (const sim of sims) { if(allSims.has(sim)) throw new Error('A SIM appears more than once.'); allSims.add(sim); }
    if(!Number.isSafeInteger(item.battery_count)||item.battery_count<0||item.battery_count>9999) throw new Error('Enter a whole battery count.');
    if(!Array.isArray(item.parts)||item.parts.length>20)throw new Error('Invalid part list.');
    const parts=item.parts.map(part=>{
      if(!exactString(part.name)||part.name.length>100||!Number.isSafeInteger(part.quantity)||part.quantity<0||part.quantity>9999)throw new Error('Enter a part name and whole quantity.');
      return {name:exactString(part.name),quantity:part.quantity};
    }).sort((a,b)=>a.name.localeCompare(b.name));
    if(new Set(parts.map(p=>p.name)).size!==parts.length)throw new Error('Combine duplicate part lines.');
    return {equipment_key:key,family,unit_tag:tag,sims,battery_count:item.battery_count,parts};
  }).sort((a,b)=>a.equipment_key.localeCompare(b.equipment_key));
}
export function receiptDifferences(expected,actual) {
  const e=normalizeManifest(expected),a=normalizeManifest(actual,{allowEmpty:true}),diff=[];
  for(const item of e){
    const received=a.find(r=>r.equipment_key===item.equipment_key);
    if(!received){diff.push({equipment_key:item.equipment_key,field:'item',expected:'Present',actual:'Missing'});continue;}
    for(const field of ['family','unit_tag','sims','battery_count','parts'])if(!same(item[field],received[field]))diff.push({equipment_key:item.equipment_key,field,expected:item[field],actual:received[field]});
  }
  for(const item of a)if(!e.some(r=>r.equipment_key===item.equipment_key))diff.push({equipment_key:item.equipment_key,field:'item',expected:'Not listed',actual:'Unexpected item'});
  return diff;
}
export function transferTitle(state) {
  return {awaiting_service:'Awaiting Service verification',discrepancy:'Discrepancy — not accepted',accepted:'Received by Service',returned_review:'Returned — inventory review required',returned_repair:'Returned — repair required',cancelled:'Cancelled — history retained'}[state] || 'Status unavailable';
}
