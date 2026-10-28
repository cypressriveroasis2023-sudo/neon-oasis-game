import {FLEET_RECEIPT_LIMIT} from './fleetReadPlan.ts';
import {buildProductGroups,type FullSource,type GroupProof} from './fullSource.ts';
import type {IdentityReview} from '../../cos-operations-pages/verifiedHealthIdentity.ts';
import type {ExactProductConnectionEnvelope} from '../../../../operations/src/exactProductConnection.ts';
import {cameraTimestamp} from '../../../../operations/src/cameraEvidence.ts';
const eligible=new Set(['No fresh, completed, exact-target TCP/service-port check is available.','More than one saved endpoint claims this tracker IP; verify exact device ownership.']);
// Match PR314's 6.5s presentation window, reserving that same window for
// response delivery before its 30s discard deadline. This is an optional budget,
// not a promise about network latency or the existing baseline source read.
export const SCOPED_READ_WINDOW_MS=6500;
export const PRODUCT_RESPONSE_CUTOFF_MS=30000-SCOPED_READ_WINDOW_MS;
/** Narrow fallback only. Original conclusive rows and all source/lifecycle/IP
 * conflict holds remain unchanged. Full source proof brackets the receipt read. */
export async function integrateScopedConnections(base:ExactProductConnectionEnvelope,options:{
 readSource:(signal:AbortSignal)=>Promise<FullSource>;readStatuses:(ids:string[],signal:AbortSignal)=>Promise<Record<string,any>[]>;now?:()=>number;
 requestStartedAt?:number;signal?:AbortSignal;
},review?:IdentityReview):Promise<ExactProductConnectionEnvelope>{
 const now=options.now??Date.now,ids=base.items.filter(i=>i.status==='unknown'&&eligible.has(i.reason)).map(i=>i.productId);
 if(!ids.length)return base;
 const started=now(),deadline=Math.min(started+SCOPED_READ_WINDOW_MS,(options.requestStartedAt??started)+PRODUCT_RESPONSE_CUTOFF_MS);
 if(options.signal?.aborted||started>=deadline)return base;
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 let stop!:()=>void;
 const canceled=new Promise<ExactProductConnectionEnvelope>(resolve=>{stop=()=>{controller.abort();resolve(base);};timer=setTimeout(stop,deadline-started);});
 options.signal?.addEventListener('abort',stop,{once:true});
 const check=()=>{if(controller.signal.aborted||now()<started||now()>=deadline)throw Error('Optional receipt budget expired');};
 const read=async<T>(fn:(signal:AbortSignal)=>Promise<T>)=>{check();const result=await fn(controller.signal);check();return result;};
 const work=async():Promise<ExactProductConnectionEnvelope>=>{try{
  const before=await read(options.readSource);
  if(before.upload.sourceSha256!==base.sourceSha256)return base;
  const plans=async(source:FullSource)=>{
   const groups:GroupProof[]=[];for(let i=0;i<ids.length;i+=64){check();groups.push(...(await buildProductGroups(source,ids.slice(i,i+64),now(),review)).groups);check();}
   return new Map(groups.map(g=>[g.productId,g]));
  };
  const first=await plans(before),statuses=new Map<string,Record<string,any>>();
  for(let i=0,selected=[...first.keys()];i<selected.length;i+=FLEET_RECEIPT_LIMIT){
   const batch=selected.slice(i,i+FLEET_RECEIPT_LIMIT),rows=await read(signal=>options.readStatuses(batch,signal));
   if(!Array.isArray(rows)||rows.length!==batch.length||new Set(rows.map(r=>r.productId)).size!==batch.length||rows.some(r=>!batch.includes(r.productId)))return base;
   for(const row of rows)statuses.set(row.productId,row);
  }
  const after=await read(options.readSource);if(after.upload.sourceSha256!==base.sourceSha256)return base;
  const current=await plans(after);check();
  return {...base,items:base.items.map(item=>{
   const a=first.get(item.productId),b=current.get(item.productId),r=statuses.get(item.productId);
   if(!a||!b||!r||a.authorityGuard!==b.authorityGuard||r.authorityGuard!==b.authorityGuard||r.sourceSha256!==base.sourceSha256||r.trackerSha256!==b.trackerSha256
    ||r.resourceId!==b.devices[0].id||r.basis!=='tcp_service_port'||!['online','offline'].includes(r.status)||!cameraTimestamp(r.checkedAt,now()).fresh)return item;
   return {productId:item.productId,status:r.status,basis:'tcp_service_port',checkedAt:r.checkedAt,resourceId:r.resourceId,
    reason:'Completed saved TCP/service-port check for the current reviewed equipment group. Camera video is not verified.'};
  })};
 }catch{return base;}};
 try{return await Promise.race([work(),canceled]);}
 finally{clearTimeout(timer!);options.signal?.removeEventListener('abort',stop);controller.abort();}
}
