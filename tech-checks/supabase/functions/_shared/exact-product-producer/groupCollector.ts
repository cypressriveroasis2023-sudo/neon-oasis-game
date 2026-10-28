import type {IdentityReview} from '../../cos-operations-pages/verifiedHealthIdentity.ts';
import {boundedRequest} from '../scheduledDirectService.ts';
import {buildProductGroups,consumeProductReceipt,RECEIPT_CONTRACT,type FullSource,type GroupProof} from './fullSource.ts';
import {createReceiptStore,receiptKeyFor,type ReceiptRpc} from './receiptAdapter.ts';
import {targetsValid} from './model.ts';
export type GroupPlan=Awaited<ReturnType<typeof buildProductGroups>>;
export type GroupRuntime={read?:(signal:AbortSignal)=>Promise<FullSource>;readGroups?:(ids:string[],signal:AbortSignal)=>Promise<GroupPlan>;rpc:ReceiptRpc;
 probe:(host:string,port:number,timeout:number,signal:AbortSignal)=>Promise<unknown>};
/** Explicit bounded manual run only; this does not create or edit a schedule. */
export async function collectProductGroups(runtime:GroupRuntime,ids:string[],runId:string,now=Date.now,review?:IdentityReview){
 if(!targetsValid(ids)||ids.length>8||!(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/).test(runId))throw Error('Bounded exact IDs and run UUID required');
 const started=now(),deadline=started+48_000,store=createReceiptStore(runtime.rpc),outcomes:Record<string,unknown>[]=[];
 const request=<T>(fn:(signal:AbortSignal)=>PromiseLike<T>,timeout=4000)=>boundedRequest(fn,deadline,now,timeout);
 const readPlan=async(selected:string[])=>runtime.readGroups?await request(s=>runtime.readGroups!(selected,s),20_000):await buildProductGroups(await request(runtime.read!,20_000),selected,now(),review);
 let groups:GroupProof[];
 try{const plan=await readPlan(ids);groups=plan.groups;outcomes.push(...plan.held.map(h=>({...h,state:'held'})));}
 catch{return {complete:false,outcomes:ids.map(productId=>({productId,state:'held',reason:'source_unavailable'}))};}
 for(const group of groups){
  const receiptKey=await receiptKeyFor(runId,group.productId);
  const hold=(reason:string,state='held')=>outcomes.push({productId:group.productId,state,reason,receiptKey});
  if(now()<started||now()+3300>=deadline){hold('deadline');continue;}
  const ports:Record<string,unknown>={},configured=group.devices[0].ports;let cursor=0,incomplete=false;
  await Promise.all(Array.from({length:Math.min(4,configured.length)},async()=>{
   while(!incomplete&&cursor<configured.length){const port=configured[cursor++];try{ports[String(port)]=await request(s=>runtime.probe(group.devices[0].ip,port,2200,s),2300);}catch{incomplete=true;}}
  }));
  const checkedAt=new Date(now()).toISOString();
  if(incomplete||Object.keys(ports).length!==configured.length||now()>=deadline){hold('probe_incomplete');continue;}
  // Use the actual strict consumer before persisting anything.
  if(!consumeProductReceipt({...group,verifiedAt:checkedAt},{state:'accepted',payload:{contract:RECEIPT_CONTRACT,proof:group,ports,checkedAt}},now())){hold('probe_incomplete');continue;}
  let fresh:GroupProof|undefined;
  try{fresh=(await readPlan([group.productId])).groups[0];}catch{hold('source_unavailable');continue;}
  if(!fresh||fresh.authorityGuard!==group.authorityGuard){hold('source_or_config_changed');continue;}
  const payload={contract:RECEIPT_CONTRACT,runId,proof:fresh,ports,checkedAt};
  let ack;
  try{ack=await request(s=>store.stage(payload,s));}catch{hold('stage_receipt_uncertain','publication_uncertain');continue;}
  if(!ack.ok){hold(ack.reason??'stage_rejected');continue;}
  // A second remote verification AFTER staging: stage is never displayable.
  try{fresh=(await readPlan([group.productId])).groups[0];}catch{hold('pending_source_unavailable');continue;}
  if(!fresh||fresh.authorityGuard!==group.authorityGuard){hold('pending_source_changed');continue;}
  try{
   const accepted=await request(s=>store.accept(ack,fresh!.authorityGuard,s));
   if(!accepted.ok){hold(accepted.reason??'accept_rejected');continue;}
   outcomes.push({productId:group.productId,state:'accepted',receiptKey:accepted.receiptKey,deviceCount:group.devices.length});
  }catch{hold('accept_receipt_uncertain','publication_uncertain');}
 }
 return {complete:outcomes.length===ids.length&&outcomes.every(o=>o.state==='accepted'),outcomes};
}
/** Backend consumption rereads complete authority after reading the receipt.
 * No global health fallback and no raw IP/config/serial leaves this function. */
export async function readProductGroupStatuses(runtime:Pick<GroupRuntime,'read'|'readGroups'|'rpc'>,ids:string[],now=Date.now,review?:IdentityReview,parentSignal?:AbortSignal){
 if(!targetsValid(ids)||ids.length>8)throw Error('Bounded exact IDs required');
 const deadline=now()+6500,store=createReceiptStore(runtime.rpc);
 const request=async<T>(fn:(s:AbortSignal)=>PromiseLike<T>):Promise<T>=>{
  if(parentSignal?.aborted)throw Error('Receipt read canceled');
  return boundedRequest(async timeoutSignal=>{
   const controller=new AbortController();let cancel!:()=>void;
   const aborted=new Promise<T>((_,reject)=>{cancel=()=>{controller.abort();reject(Error('Receipt read canceled'));};});
   parentSignal?.addEventListener('abort',cancel,{once:true});timeoutSignal.addEventListener('abort',cancel,{once:true});
   try{const value=await Promise.race([Promise.resolve(fn(controller.signal)),aborted]);if(parentSignal?.aborted||now()>=deadline)throw Error('Receipt read expired');return value;}
   finally{parentSignal?.removeEventListener('abort',cancel);timeoutSignal.removeEventListener('abort',cancel);controller.abort();}
  },deadline,now,6500);
 };
 const readPlan=async()=>runtime.readGroups?await request(s=>runtime.readGroups!(ids,s)):await buildProductGroups(await request(runtime.read!),ids,now(),review);
 const initial=await readPlan();
 const receipts=await Promise.all(initial.groups.map(g=>request(s=>store.read(g,s))));
 const fresh=await readPlan();
 return ids.map(productId=>{
  const first=initial.groups.find(g=>g.productId===productId),current=fresh.groups.find(g=>g.productId===productId);
  const receipt=first?receipts[initial.groups.indexOf(first)]:null;
  const status=first&&current&&first.authorityGuard===current.authorityGuard&&receipt?consumeProductReceipt(current,receipt,now()):null;
  return status??{productId,status:'unknown',basis:'tcp_service_port',checkedAt:null,reason:'Current complete Product-ID/group/receipt proof is unavailable.'};
 });
}
