import {normalizeManifest} from './model.js';

export const SELF_CONFIRMATION = 'I physically checked these unit details and the matching photo.';
export const CITED_CONFIRMATION = 'I am recording the technician’s documented confirmation and applying this correction as myself.';
export const sameManifest = (a,b) => JSON.stringify(normalizeManifest(a)) === JSON.stringify(normalizeManifest(b));
export const centralTime = value => value ? new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'long'}) : 'Not recorded';
export function httpsEvidence(value) {
  try { const url=new URL(String(value).trim());return url.protocol==='https:'&&!url.username&&!url.password ? url.href : null; } catch { return null; }
}
// datetime-local has no zone. Resolve against Central explicitly, regardless of
// the device's time zone, and reject nonexistent or ambiguous DST clock times.
export function centralDateTimeToISO(value) {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value||''))throw new Error('Enter the technician confirmation date and time in Central time.');
  const wanted=value.length===16?value+':00':value;
  const naive=Date.parse(wanted+'Z');
  const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const candidates=[5,6].map(hours=>new Date(naive+hours*3600000)).filter(date=>Number.isFinite(date.valueOf())&&format.format(date).replace(' ','T')===wanted);
  if(candidates.length!==1)throw new Error('That Central clock time is invalid or repeats during a daylight-saving change. Use a confirmed unambiguous time.');
  return candidates[0].toISOString();
}
export function changedItems(before,after) {
  const previous=normalizeManifest(before),next=normalizeManifest(after);
  return next.filter(item=>JSON.stringify(item)!==JSON.stringify(previous.find(old=>old.equipment_key===item.equipment_key)));
}
export function correctionChanges(before,after) {
  const previous=normalizeManifest(before),next=normalizeManifest(after),changes=[];
  for(const item of previous){
    const updated=next.find(row=>row.equipment_key===item.equipment_key);
    if(!updated){changes.push({equipment_key:item.equipment_key,field:'Unit',before:item.family+' '+item.unit_tag,after:'Removed from pending handoff'});continue;}
    for(const [field,label] of [['family','Family'],['unit_tag','Unit tag'],['sims','SIM cards'],['battery_count','Battery count'],['parts','Additional parts']]){
      if(JSON.stringify(item[field])!==JSON.stringify(updated[field]))changes.push({equipment_key:item.equipment_key,field:label,before:item[field],after:updated[field]});
    }
  }
  for(const item of next)if(!previous.some(old=>old.equipment_key===item.equipment_key))changes.push({equipment_key:item.equipment_key,field:'Unit',before:'Not on pending handoff',after:item.family+' '+item.unit_tag});
  return changes;
}
const textLines=value=>String(value||'').split(/\r?\n/).map(text=>text.trim()).filter(Boolean);
export function draftItems(manifest) {
  return normalizeManifest(manifest).map(item=>({...item,simText:item.sims.join('\n'),batteryText:String(item.battery_count),partsText:item.parts.map(part=>part.name+' | '+part.quantity).join('\n')}));
}
export function manifestFromDraft(items) {
  return normalizeManifest(items.map(item=>({equipment_key:item.equipment_key,family:item.family,unit_tag:item.unit_tag,sims:textLines(item.simText),battery_count:item.batteryText===''?NaN:Number(item.batteryText),parts:/^(?:none|n\/?a)$/i.test(item.partsText.trim())?[]:textLines(item.partsText).map((line,index)=>{
    const match=line.match(/^(.+?)\s*\|\s*(\d+)$/);if(!match)throw new Error('Additional parts, line '+(index+1)+': use part name | quantity.');
    return {name:match[1].trim(),quantity:Number(match[2])};
  })})));
}
export function validateCorrection({transfer,items,equipment,reason,photos,confirmation}) {
  const after=normalizeManifest(items);
  if(sameManifest(transfer.manifest,after))throw new Error('The corrected details must change the saved pending handoff.');
  if(typeof reason!=='string'||reason.trim().length<5||reason.trim().length>2000)throw new Error('Enter a reason for correction, from 5 to 2,000 characters.');
  for(const item of after){
    const exact=equipment.find(row=>row.equipment_key===item.equipment_key);
    if(!exact||exact.family!==item.family||exact.unit_tag!==item.unit_tag)throw new Error('Select the exact registered unit; its family, tag and saved identity must match.');
  }
  if(!photos.length)throw new Error('Add a matching unit and tag photo for the corrected handoff.');
  for(const item of changedItems(transfer.manifest,after))if(!photos.some(photo=>photo.equipment_key===item.equipment_key))throw new Error('Add a matching unit and tag photo for '+item.family+' '+item.unit_tag+'.');
  if(!confirmation?.confirmed)throw new Error('Confirm the corrected details and matching photo before saving.');
  if(confirmation.technician_id!==transfer.original?.actor_id)throw new Error('The confirmation must identify the original submitting technician.');
  if(confirmation.mode==='cited'){
    if((confirmation.technician_reply?.trim().length||0)<5||confirmation.technician_reply.length>5000)throw new Error('Record the technician’s reply, from 5 to 5,000 characters.');
    const evidence=httpsEvidence(confirmation.evidence_reference);
    if(!evidence||evidence.length>2000||!/^https:\/\/(drive\.google\.com|docs\.google\.com|mail\.google\.com)\/[^\s<>]+$/.test(evidence))throw new Error('Add a Google Drive, Docs or Gmail HTTPS link to the technician’s documented confirmation.');
    if(!Number.isFinite(Date.parse(confirmation.technician_confirmed_at)))throw new Error('Enter the technician confirmation date and time.');
  }else if(confirmation.mode!=='self')throw new Error('The correction confirmation mode is unavailable.');
  return after;
}
