import {publishTransferPlacement} from './projectPlacement.mjs';
import {inspectEncodingBridge} from './encodingBridge.mjs';
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
/** Bind only inside the existing authorized server path. This module has no
 * browser route, credential acquisition, schedule, probe, or automatic retry. */
export function createTransferPlacementPublisher({db,readNative,readReviewedCrosswalk,scopeKeys,now=Date.now}){
 if(scopeKeys&&(!Array.isArray(scopeKeys)||scopeKeys.length===0||new Set(scopeKeys).size!==scopeKeys.length||scopeKeys.some(k=>typeof k!=='string')))throw Error('Exact publication scope required');
 const rpc=async(args,signal)=>{
  if(signal?.aborted)throw Error('Cancelled');
  let call=db.rpc('cos_admit_transfer_placement_v1',args);if(signal&&call.abortSignal)call=call.abortSignal(signal);
  const result=await call;
  if(result.error||!Number.isSafeInteger(result.data)||result.data<0)throw Error('Placement admission unavailable; reconcile head before retry');
  return result.data;
 };
 const equipment=async signal=>{
  const rows=[];
  for(let offset=0;offset<10000;offset+=1000){
   let call=db.from('equipment_master').select('equipment_key,canonical_family,source_family,workflow_type,unit_tag,updated_at').order('equipment_key').range(offset,offset+999);
   if(signal&&call.abortSignal)call=call.abortSignal(signal);
   const result=await call;
   if(signal?.aborted||result.error||!Array.isArray(result.data))throw Error('Transfer register unavailable');
   rows.push(...result.data);if(result.data.length<1000){if(new Set(rows.map(r=>r.equipment_key)).size!==rows.length)throw Error('Duplicate equipment keys');return rows;}
  }throw Error('Transfer register truncated');
 };
 return {async run({signal}={}){
  if(signal?.aborted)throw Error('Cancelled');
  const expected=await rpc({p_expected_generation:null,p_packet:null},signal);
  let observedRegister=null,observedNative=null;
  const readCrosswalk=async()=>{
   const rows=await equipment(signal);
   let c;
   if(readReviewedCrosswalk)c=await readReviewedCrosswalk(signal);
   else{
    const bridge=inspectEncodingBridge(observedNative?.records||[],rows);
    if(scopeKeys)bridge.records=bridge.records.filter(r=>scopeKeys.includes(r.equipmentKey));
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(bridge.records)));
    c={reviewed:true,revision:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),records:bridge.records};
   }
   if(c?.reviewed!==true||!Array.isArray(c.records))throw Error('Reviewed crosswalk unavailable');
   if(scopeKeys&&(scopeKeys.some(k=>!rows.some(e=>e.equipment_key===k))||c.records.some(r=>!scopeKeys.includes(r.equipmentKey))))throw Error('Transfer scope changed');
   // Never infer a bridge from the legacy row's label. Exact keys, families,
   // tags and current native IDs come from a separately reviewed crosswalk.
   for(const entry of c.records){
    const matches=rows.filter(r=>r.equipment_key===entry.equipmentKey);
    if(matches.length!==1||matches[0].canonical_family!==entry.family||matches[0].unit_tag!==entry.unitTag||matches[0].workflow_type!==entry.family)throw Error('Reviewed transfer identity changed');
   }
   const value=stable(rows);if(observedRegister!==null&&value!==observedRegister)throw Error('Transfer register changed during read');observedRegister=value;
   return c;
  };
  const readBaseline=async()=>{
   if(signal?.aborted)throw Error('Cancelled');
   const native=await readNative(signal);
   if(native?.contract!=='COS_CAMERA_SNAPSHOT_SOURCE_V1'||native.complete!==true)throw Error('Existing native source unavailable');
   observedNative=native.baseline;return native.baseline;
  };
  const generation=await publishTransferPlacement({readBaseline,readCrosswalk,publish:(args,s)=>rpc({...args,p_packet:scopeKeys?{...args.p_packet,scope_keys:scopeKeys}:args.p_packet},s),expectedGeneration:expected,signal,now});
  return {generation,status:'admitted'};
 }};
}
