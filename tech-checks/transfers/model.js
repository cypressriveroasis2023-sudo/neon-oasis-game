// Transfer custody is separate from placement, health and permanent truck stock.
export const TRANSFER_STATEMENT = 'I physically checked the equipment listed in this transfer. My entries and photos accurately record what I handed over, received or returned.';
export const INTAKE_CHECKS = Object.freeze(['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok']);
export const isPhoneSurface = (windowObject = window) => windowObject.matchMedia('(max-width: 900px)').matches;
export const exactString = value => typeof value === 'string' ? value.trim() : '';
export const TRANSFER_PURPOSES = Object.freeze({truck_replenishment:'Truck replenishment',installation:'Installation'});
export const transferPurposeLabel = purpose => TRANSFER_PURPOSES[purpose] || 'Purpose needs IT / Owner confirmation';
export const hasTransferPurpose = purpose => Object.hasOwn(TRANSFER_PURPOSES,purpose);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
// Display capitalization is not a different equipment family. Only the six
// registered workflow families share this comparison; tags, keys and SIMs do not.
const transferFamilies=Object.freeze(['Sniper','Ranger','Spotter','Solar Spotter','Recon 2','Helios']);
export function comparableTransferFamily(value){
  const original=exactString(value),candidate=original.replace(/\s+/g,' ').toLowerCase();
  return transferFamilies.find(family=>family.toLowerCase()===candidate)||original;
}
// Current Owner-specified installation packages, expressed per transferred
// unit. Solar Spotter batteries belong to its stand, so the camera's BACKUP
// minimum of zero is not an installation battery plan. Historical signed
// configurations remain in their original events; they are not rewritten here.
export function installationBatteryPlan(family,configuration=''){
 const type=comparableTransferFamily(family);
 const fixed={
  Sniper:{configuration:'sniper_2x_12v_35ah',count:2,description:'2 × 12V 35Ah'},
  Ranger:{configuration:'lifepo4_1x',count:1,description:'1 LiFePO4 battery'},
  'Solar Spotter':{configuration:'agm_4x_12v_110ah',count:4,description:'4 × 12V 110Ah per Solar Stand'},
  Helios:{configuration:'helios_battery_box',count:1,description:'1 Helios battery box'},
  'Recon 2':{configuration:'recon_configured',count:null,minimum:1,description:'Configured Recon battery quantity (at least 1)'},
  Spotter:{configuration:'none',count:0,description:'No internal battery package required'}
 }[type];
 return fixed?{...fixed,minimum:fixed.minimum??fixed.count,exact:type!=='Recon 2',selectable:false,options:[]}:{configuration:'',count:null,minimum:null,exact:false,selectable:false,options:[],description:'Installation battery plan unavailable'};
}
export function latestReceiptEvent(transfer){
  const revision=event=>Number.isSafeInteger(event?.snapshot?.revision)?event.snapshot.revision:0;
  return (transfer?.events||[]).filter(event=>event.kind==='receipt').reduce((latest,event)=>!latest||revision(event)>revision(latest)||revision(event)===revision(latest)&&event.signed_at>latest.signed_at?event:latest,null);
}
export const canRecordReceipt=transfer=>transfer?.state==='awaiting_service'&&hasTransferPurpose(transfer.purpose)&&transfer.receipt_required===true;
export function normalizeManifest(items, {allowEmpty=false,purpose=null,requirePlan=true}={}) {
  if (!Array.isArray(items) || (!allowEmpty && items.length < 1) || items.length > 20) throw new Error('Select 1 to 20 equipment units.');
  const keys=new Set(), allSims=new Set();
  return items.map(item => {
    const key=exactString(item.equipment_key),family=exactString(item.family),tag=exactString(item.unit_tag);
    if (!key || !family || !tag || keys.has(key)) throw new Error('Each item needs its exact saved equipment identity.');
    keys.add(key);
    if (!Array.isArray(item.sims) || item.sims.length>10 || item.sims.some(s=>!exactString(s)||typeof s!=='string'||s.length>100)) throw new Error('Enter SIM numbers as exact text, not numbers.');
    const sims=item.sims.map(exactString).sort();
    for (const sim of sims) { if(allSims.has(sim)) throw new Error('A SIM appears more than once.'); allSims.add(sim); }
    if(purpose==='truck_replenishment'){
      if(item.battery_count!==null)throw new Error('Truck replenishment does not record a battery count.');
    }else if(!Number.isSafeInteger(item.battery_count)||item.battery_count<0||item.battery_count>9999) throw new Error('Enter a whole battery count.');
    if(!Array.isArray(item.parts)||item.parts.length>20)throw new Error('Invalid part list.');
    const parts=item.parts.map(part=>{
      if(!exactString(part.name)||part.name.length>100||!Number.isSafeInteger(part.quantity)||part.quantity<0||part.quantity>9999)throw new Error('Enter a part name and whole quantity.');
      return {name:exactString(part.name),quantity:part.quantity};
    }).sort((a,b)=>a.name.localeCompare(b.name));
    if(new Set(parts.map(p=>p.name)).size!==parts.length)throw new Error('Combine duplicate part lines.');
    const result={equipment_key:key,family,unit_tag:tag,sims,battery_count:item.battery_count,parts};
    if(purpose==='installation'){
      const plan=installationBatteryPlan(family,item.battery_configuration);
      if(requirePlan&&(!plan.configuration||plan.configuration!==item.battery_configuration))throw new Error('Choose the installation battery setup for '+family+' '+tag+'.');
      if(item.battery_configuration!=null&&(typeof item.battery_configuration!=='string'||item.battery_configuration.length>100))throw new Error('Record a valid installation battery setup.');
      result.battery_configuration=exactString(item.battery_configuration)||null;
    }else if(purpose==='truck_replenishment')result.battery_configuration=null;
    return result;
  }).sort((a,b)=>a.equipment_key.localeCompare(b.equipment_key));
}
export function receiptDifferences(expected,actual,{purpose=null}={}) {
  // Comparison never edits the original signed manifest. A purpose amendment
  // can make an old recorded battery quantity inapplicable to the new receipt.
  const project=items=>purpose==='truck_replenishment'?items.map(item=>({...item,battery_count:null,battery_configuration:null})):items;
  const e=normalizeManifest(project(expected),{purpose}),a=normalizeManifest(project(actual),{allowEmpty:true,purpose,requirePlan:false}),diff=[];
  for(const item of e){
    const received=a.find(r=>r.equipment_key===item.equipment_key);
    if(!received){diff.push({equipment_key:item.equipment_key,field:'item',expected:'Present',actual:'Missing'});continue;}
    const fields=['family','unit_tag','sims','parts',...(purpose==='truck_replenishment'?[]:['battery_count']),...(purpose==='installation'?['battery_configuration']:[])];
    for(const field of fields)if(field==='family'?!same(comparableTransferFamily(item[field]),comparableTransferFamily(received[field])):!same(item[field],received[field]))diff.push({equipment_key:item.equipment_key,field,expected:item[field],actual:received[field]});
  }
  for(const item of a)if(!e.some(r=>r.equipment_key===item.equipment_key))diff.push({equipment_key:item.equipment_key,field:'item',expected:'Not listed',actual:'Unexpected item'});
  return diff;
}
export function transferTitle(state) {
  return {awaiting_service:'Awaiting Service verification',discrepancy:'Discrepancy — not accepted',accepted:'Received by Service',returned_review:'Returned — inventory review required',returned_repair:'Returned — repair required',cancelled:'Cancelled — history retained'}[state] || 'Status unavailable';
}
