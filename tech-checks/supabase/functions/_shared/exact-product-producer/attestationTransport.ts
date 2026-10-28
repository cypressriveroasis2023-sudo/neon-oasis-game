import {fleetReadTargets,buildFleetReadPlan} from './fleetReadPlan.ts';
import {PROFILES,RECEIPT_CONTRACT,type GroupProof} from './fullSource.ts';
import {createProtectedSourceReader,type ProtectedSourceIO} from './sourceReader.ts';
import {directPublicHost,boundedRequest} from '../scheduledDirectService.ts';
import type {GroupPlan} from './groupCollector.ts';
const SHA=/^[a-f0-9]{64}$/;
/** Native/source project half. Uses ONLY its existing authorized context; it
 * does not need the legacy service key and never returns raw mHelp/serial data
 * beyond the exact saved physical tuple already accessible to the same actor. */
export function createProductProofHandler(options:{enabled?:boolean;bindExistingContext?:(request:Request)=>Promise<ProtectedSourceIO|null>;now?:()=>number}={}){
 return async(request:Request)=>{
  const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(options.enabled!==true||!options.bindExistingContext)return reply({error:'Product proof extension disabled.'},503);
  if(request.method!=='POST'||new URL(request.url).search||!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'Bounded POST required.'},405);
  try{
   const io=await boundedRequest(()=>options.bindExistingContext!(request),Date.now()+4000);
   if(!io)return reply({error:'Unauthorized.'},403);
   const reader=request.body?.getReader();if(!reader)throw Error();let text='',size=0;const decoder=new TextDecoder(),deadline=Date.now()+4000;
   try{for(;;){const part=await boundedRequest(()=>reader.read(),deadline);if(part.done)break;size+=part.value.length;if(size>4096)throw Error();text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{void reader.cancel().catch(()=>{});}
   const body=JSON.parse(text);if(!body||Object.keys(body).length!==1||!fleetReadTargets(body.productIds))throw Error();
   const now=options.now??Date.now,source=await createProtectedSourceReader(io,now)(request.signal);
   const plan=await buildFleetReadPlan(source,body.productIds,now());
   return reply({contract:'COS_PRODUCT_TCP_SOURCE_V2',productIds:body.productIds,...plan});
  }catch{return reply({error:'Current complete source unavailable.'},409);}
 };
}
export function validateRemoteGroups(value:any,ids:string[],now:number):GroupPlan{
 if(value?.contract!=='COS_PRODUCT_TCP_SOURCE_V2'||JSON.stringify(value.productIds)!==JSON.stringify(ids)||!Array.isArray(value.groups)||!Array.isArray(value.held))throw Error('Incomplete source attestation');
 const returned=[...value.groups,...value.held].map(v=>v?.productId);
 if(returned.length!==ids.length||new Set(returned).size!==ids.length||ids.some(id=>!returned.includes(id)))throw Error('Incomplete source attestation');
 for(const g of value.groups as GroupProof[]){
  if(g.contract!==RECEIPT_CONTRACT||!PROFILES[g.family]||!(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/).test(g.nativeUnitId)||![g.authorityGuard,g.identityGuard,g.bindingGuard,g.sourceSha256,g.trackerSha256,g.epochGuard,g.crosswalkRevision].every(v=>typeof v==='string'&&SHA.test(v))
   ||!Number.isFinite(Date.parse(g.verifiedAt))||Date.parse(g.verifiedAt)>now||now-Date.parse(g.verifiedAt)>30_000||!Array.isArray(g.devices)||g.devices.length<1||g.devices.length>16)throw Error('Invalid group attestation');
  if(!(g.nativeEpoch===null||typeof g.nativeEpoch==='string'&&SHA.test(g.nativeEpoch))||!Array.isArray(g.resourceEpochs)||!g.resourceEpochs.length||new Set(g.resourceEpochs.map(e=>e.unitKey)).size!==g.resourceEpochs.length
   ||g.resourceEpochs.some(e=>typeof e.epoch!=='string'||!SHA.test(e.epoch)||!Array.isArray(e.deviceIds)||new Set(e.deviceIds).size!==e.deviceIds.length||JSON.stringify([...e.deviceIds].sort())!==JSON.stringify(g.devices.filter(d=>d.unitKey===e.unitKey).map(d=>d.id).sort()))
   ||g.devices.some(d=>!g.resourceEpochs.some(e=>e.unitKey===d.unitKey)))throw Error('Incomplete current resource epochs');
  const ids=new Set<string>();
  for(const d of g.devices){
   if(!/^[1-9][0-9]*$/.test(d.id)||ids.has(d.id)||!(/^(0|[1-9][0-9]*)$/).test(d.revision)||directPublicHost(d.ip)!==d.ip||d.ip!==g.devices[0].ip
    ||d.enabled!==true||d.source!=='vigilant_control_center'||d.profile!==PROFILES[g.family]||!['active','deactivated'].includes(d.activation)
    ||!Array.isArray(d.ports)||d.ports.length<1||d.ports.length>32||new Set(d.ports).size!==d.ports.length||d.ports.some(p=>!Number.isInteger(p)||p<1||p>65535)
    ||JSON.stringify([...d.ports].sort((a,b)=>a-b))!==JSON.stringify([...g.devices[0].ports].sort((a,b)=>a-b)))throw Error('Invalid saved group target');
   ids.add(d.id);
  }
 }
 return {groups:value.groups,held:value.held.map((h:any)=>({productId:h.productId,reason:'source_hold'}))};
}
/** Legacy/writer project half: forward the SAME already-verified user bearer to
 * a fixed HTTPS native proof route which reauthenticates the existing actor.
 * Never copy either project's service key to the other, add a role claim, accept
 * proof from the request body, or accept a URL/target from the caller. */
export function createRemoteGroupReader(options:{proofUrl:string;expectedOrigin:string;authorization:string;fetch:typeof fetch;now?:()=>number}){
 const url=new URL(options.proofUrl);
 if(url.protocol!=='https:'||url.origin!==options.expectedOrigin||url.username||url.password||url.search||url.hash
  ||!/^Bearer [^\s]+$/.test(options.authorization)||options.authorization.length>8192)throw Error('Reviewed source route and existing user authorization required');
 return async(ids:string[],signal:AbortSignal)=>{
  if(!fleetReadTargets(ids))throw Error('Invalid source selection');
  const response=await options.fetch(url,{method:'POST',headers:{Authorization:options.authorization,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({productIds:ids}),redirect:'error',cache:'no-store',signal});
  if(!response.ok||!response.body)throw Error('Protected source unavailable');
  const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2097152)throw Error('Oversized proof');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{void reader.cancel().catch(()=>{});}
  return validateRemoteGroups(JSON.parse(text),ids,(options.now??Date.now)());
 };
}
