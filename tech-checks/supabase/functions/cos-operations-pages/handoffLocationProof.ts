import {currentOwnerPlacements,placementIdentityConcernKey} from './placementProjection.ts';
type Row=Record<string,any>;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const encoder=new TextEncoder(),hex=(value:ArrayBuffer)=>[...new Uint8Array(value)].map(n=>n.toString(16).padStart(2,'0')).join('');
const exact=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=160&&v===v.trim()&&!/[\x00-\x1f\x7f<>]/.test(v);
const stable=(value:any):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const object=(v:any):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:any,wanted:string[])=>object(v)&&Object.keys(v).sort().join(',')===[...wanted].sort().join(',');
const stamp=(v:any)=>typeof v==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const byteOrder=(a:string,b:string)=>{const x=encoder.encode(a),y=encoder.encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
export class HandoffLocationError extends Error{constructor(message:string,readonly status:number){super(message);}}
const unavailable=():never=>{throw new HandoffLocationError('Current Shop placement could not be verified. Reload and resolve the recorded placement before handing off equipment.',409);};
const actorProfileAllowed=(c:Row)=>object(c)&&UUID.test(c.legacyId)&&(c.department==='it'&&c.legacyOwner===false||c.department==='owner'&&c.legacyOwner===true);
const actorAllowed=(c:Row)=>actorProfileAllowed(c)&&c.fleetRead===true;
export type HandoffLocationRead={attestation:Row;equipment:Row[];audits:Row[];devices:Row[]};

/** Legacy identity is checked under the real caller JWT before any native read. */
export function validateHandoffLegacyItems(items:Row[],equipment:Row[]):Row[]{
 if(!Array.isArray(equipment)||equipment.length>20000)unavailable();
 return items.map(item=>{
  const rows=equipment.filter(r=>r?.equipment_key===item.equipment_key),concern=placementIdentityConcernKey(item.family+' '+item.unit_tag);
  if(rows.length!==1||rows[0].canonical_family!==item.family||rows[0].unit_tag!==item.unit_tag||rows[0].tracker_state!=='shop'||!Number.isFinite(stamp(rows[0].updated_at))
   ||equipment.filter(r=>placementIdentityConcernKey(r?.canonical_family+' '+r?.unit_tag)===concern).length!==1)unavailable();
  return {...item,legacy_updated_at:rows[0].updated_at};
 });
}
function proofItems(context:Row,body:Row,read:HandoffLocationRead,now:number,start:number){
 const {attestation:a,equipment,audits,devices}=read;
 if(!keys(a,['contract','organization_id','legacy_actor_id','request_id','purpose','checked_at','valid_until','items'])||a.contract!=='COS_TECHCHECK_SHOP_ATTESTATION_V1'||a.organization_id!==ORG||a.legacy_actor_id!==context.legacyId||a.request_id!==body.request_id||a.purpose!==body.purpose
  ||!Array.isArray(a.items)||a.items.length!==body.items.length||!Number.isFinite(stamp(a.checked_at))||stamp(a.checked_at)>now+2000||stamp(a.checked_at)<start-2000
  ||!Number.isFinite(stamp(a.valid_until))||stamp(a.valid_until)<=now||stamp(a.valid_until)>stamp(a.checked_at)+30000
  ||!Array.isArray(audits)||audits.length>100000||!Array.isArray(devices)||devices.length>100000)unavailable();
 const legacy=validateHandoffLegacyItems(body.items,equipment);
 let owners:Row[];try{owners=currentOwnerPlacements(audits,devices);}catch{unavailable();}
 const ids=new Set<string>(),trackers=new Set<string>();
 const items=legacy.map((item,index)=>{
  const r=a.items[index];
  if(!keys(r,['equipment_key','family','unit_tag','representation_id','representation_kind','native_unit_id','tracker_id','placement','observed_at','source_success_at','authority_sha256'])
   ||r.equipment_key!==item.equipment_key||r.family!==item.family||r.unit_tag!==item.unit_tag||!UUID.test(r.representation_id)||!UUID.test(r.tracker_id)||ids.has(r.representation_id)||trackers.has(r.tracker_id)
   ||!(r.representation_kind==='native'&&r.native_unit_id===r.representation_id||r.representation_kind==='tracker'&&r.native_unit_id===null&&r.tracker_id===r.representation_id)
   ||r.placement!=='SHOP'||typeof r.authority_sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.authority_sha256)
   ||![r.observed_at,r.source_success_at].every(t=>Number.isFinite(stamp(t))&&stamp(t)<=now&&now-stamp(t)<=40*60000)
   ||stamp(r.source_success_at)<stamp(r.observed_at)||stamp(a.valid_until)>Math.min(stamp(r.observed_at),stamp(r.source_success_at))+40*60000)unavailable();
  ids.add(r.representation_id);trackers.add(r.tracker_id);
  const label=item.family+' '+item.unit_tag,concern=placementIdentityConcernKey(label);
  const relatedDevices=devices.filter(d=>placementIdentityConcernKey(d?.unit_key)===concern);
  if(relatedDevices.some(d=>typeof d.id!=='number'&&typeof d.id!=='string'||typeof d.unit_key!=='string'||d.unit_key.trim().toUpperCase()!==label.toUpperCase())
   ||new Set(relatedDevices.map(d=>String(d.id))).size!==relatedDevices.length)unavailable();
  const deviceIds=new Set(relatedDevices.map(d=>String(d.id)));
  const related=audits.filter(x=>placementIdentityConcernKey(x.unit_key)===concern||[r.representation_id,r.tracker_id].includes(x.control_id)||Array.isArray(x.device_ids)&&x.device_ids.some((id:unknown)=>deviceIds.has(String(id))));
  for(const key of new Set(related.map(x=>x.unit_key))){
   const current=owners!.filter(x=>x.unit_key===key);
   // Current reviewed ROOT can corroborate Shop. Field, incomplete identity or
   // a later unmarked edit is a veto. A related alias never grants identity.
   if(current.length!==1||current[0].placement!=='SHOP'||current[0].conflictReason||key.trim().toUpperCase()!==label.toUpperCase()||stamp(current[0].created_at)>now)unavailable();
  }
  return {...item,native_id:r.representation_id,tracker_id:r.tracker_id,observed_at:r.observed_at,
   authority:{native:r.authority_sha256,source_success_at:r.source_success_at,audits:related,devices:relatedDevices}};
 });
 return {items,validUntil:stamp(a.valid_until)};
}

/** Two scoped observations with fresh actor checks before both reads and before
 * signing. Native/legacy changes after the reads are not cross-project locked. */
export async function issueHandoffLocationProof(context:Row,body:Row,read:(items:Row[],signal:AbortSignal)=>Promise<HandoffLocationRead>,getSecret:()=>string|undefined,revalidate:(signal:AbortSignal)=>Promise<Row>,options:{now?:()=>number;deadlineMs?:number;signal?:AbortSignal}={}){
 const now=options.now||Date.now,start=now(),deadline=Math.min(options.deadlineMs??start+10000,start+10000);
 if(!actorProfileAllowed(context)||!keys(body,['request_id','purpose','items'])||!UUID.test(body.request_id)||!['checkout','inventory_release'].includes(body.purpose)||body.purpose==='inventory_release'&&!context.legacyOwner)throw new HandoffLocationError('A verified IT or Owner action is required.',403);
 if(!Array.isArray(body.items)||body.items.length<1||body.items.length>20||body.items.some((i:Row)=>!keys(i,['equipment_key','family','unit_tag'])||!['equipment_key','family','unit_tag'].every(k=>exact(i[k])))
  ||new Set(body.items.map((i:Row)=>i.equipment_key)).size!==body.items.length||new Set(body.items.map((i:Row)=>i.unit_tag.toLowerCase())).size!==body.items.length)throw new HandoffLocationError('Exact equipment identities required.',400);
 const request={request_id:body.request_id,purpose:body.purpose,items:body.items.map((i:Row)=>Object.freeze({...i})).sort((a:Row,b:Row)=>byteOrder(a.equipment_key,b.equipment_key))};Object.freeze(request.items);Object.freeze(request);
 const secret=getSecret();if(typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret))throw new HandoffLocationError('Shop verification is held for installation review.',503);
 const controller=new AbortController(),cancel=()=>controller.abort();options.signal?.addEventListener('abort',cancel,{once:true});
 const check=()=>{if(controller.signal.aborted||options.signal?.aborted||now()>=deadline)throw new HandoffLocationError('Shop verification deadline elapsed. Reload and retry.',503);};
 let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new HandoffLocationError('Shop verification deadline elapsed. Reload and retry.',503));},Math.max(0,deadline-start));});
 const run=async()=>{
  const authorize=async()=>{check();const fresh=await revalidate(controller.signal);check();if(!actorAllowed(fresh)||fresh.legacyId!==context.legacyId||fresh.department!==context.department||fresh.legacyOwner!==context.legacyOwner)throw new HandoffLocationError('Your verified account access changed. Sign in again.',403);};
  await authorize();const before=proofItems(context,request,await read(request.items,controller.signal),now(),start);check();
  await authorize();const after=proofItems(context,request,await read(request.items,controller.signal),now(),start);check();
  if(stable(before.items)!==stable(after.items))unavailable();
  const items=await Promise.all(after.items.map(async({authority,...item})=>({...item,authority_sha256:hex(await crypto.subtle.digest('SHA-256',encoder.encode(stable(authority))))})));
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g)!.map(n=>parseInt(n,16))),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  await authorize();
  const issued=Math.floor(now()/1000),expires=Math.min(issued+30,Math.floor(Math.min(before.validUntil,after.validUntil)/1000));if(expires<=issued)unavailable();
  const payload=JSON.stringify({version:7,key_id:'v1',organization_id:ORG,actor_id:context.legacyId,request_id:request.request_id,purpose:request.purpose,issued_at:issued,expires_at:expires,items});
  const signature=hex(await crypto.subtle.sign('HMAC',key,encoder.encode(payload)));check();return {payload,signature};
 };
 try{return await Promise.race([run(),timeout]);}finally{clearTimeout(timer);controller.abort();options.signal?.removeEventListener('abort',cancel);}
}
