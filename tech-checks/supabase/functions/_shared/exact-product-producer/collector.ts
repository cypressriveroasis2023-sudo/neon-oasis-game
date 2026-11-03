import {boundedRequest} from '../scheduledDirectService.ts';
import {CONTRACT,completedObservation,digest,planExactProductChecks,targetsValid,
 type Snapshot,type Candidate,type PortOutcome} from './model.ts';

export type Publication={
 contract:typeof CONTRACT;receiptKey:string;payloadSha256:string;runId:string;
 productId:string;deviceId:string;expectedAuthorityGuard:string;authorityEpoch:string;
 identity:Candidate['identity'];
 config:Pick<Candidate['device'],'publicIp'|'expectedPorts'|'connectionRevision'|'source'|'monitoringProfile'>;
 observation:NonNullable<ReturnType<typeof completedObservation>>;
};
export type Receipt={ok:boolean;receiptKey:string;payloadSha256:string;reason?:string};
export type Adapters={
 /** Protected COMPLETE mHelp, current tracker, unfiltered endpoint and committed
  * identity reads; independently verified by the future server adapter. */
 read:(signal:AbortSignal)=>Promise<Snapshot>;
 /** Must cancel sockets on signal and close late connections. Only the supplied
  * saved public literal and port may be contacted. No DNS/provider/auth access. */
 probe:(host:string,port:number,timeoutMs:number,signal:AbortSignal)=>Promise<PortOutcome>;
 /** REQUIRED future atomic authority+identity+endpoint CAS and idempotent receipt.
  * Do NOT bind this directly to publish_camera_connection_v1: that RPC does not
  * validate this cross-source authority contract. See the review contract. */
 publishAtomic:(request:Publication,signal:AbortSignal)=>Promise<Receipt>;
};
export type Outcome={productId:string;state:'published'|'held'|'publication_uncertain';reason?:string;receiptKey?:string};
export const LIMITS={runMs:48_000,ioMs:4_000,probeMs:2_200,portWorkers:4,maxTargets:64} as const;
/** No entrypoint/import from a runtime: explicitly selected IDs only, one target
 * at a time, at most four sockets. No direct DB writes, retries or counters. */
export async function collectExactProductChecks(adapters:Adapters,options:{productIds:readonly string[];runId:string;now?:()=>number}){
 if(!targetsValid(options.productIds)||!(/^[a-zA-Z0-9_-]{16,80}$/).test(options.runId))throw Error('Invalid bounded run');
 const now=options.now??Date.now,started=now(),deadline=started+LIMITS.runMs;
 const request=<T>(make:(signal:AbortSignal)=>PromiseLike<T>,timeout:number=LIMITS.ioMs)=>boundedRequest(make,deadline,now,timeout);
 const outcomes:Outcome[]=[];
 let first:Snapshot,plan:Awaited<ReturnType<typeof planExactProductChecks>>;
 try{first=structuredClone(await request(adapters.read));plan=await planExactProductChecks(first,options.productIds,now());}
 catch{return {outcomes:options.productIds.map(productId=>({productId,state:'held',reason:'source_unavailable'})),complete:false};}
 outcomes.push(...plan.held.map(h=>({...h,state:'held' as const})));
 for(const c of plan.selected){
  const hold=(reason:string)=>outcomes.push({productId:c.productId,state:'held',reason});
  if(now()<started||now()+LIMITS.probeMs+1000>=deadline){hold('deadline');continue;}
  const ports:Record<string,PortOutcome>={},began=now();let cursor=0,incomplete=false;
  await Promise.all(Array.from({length:Math.min(LIMITS.portWorkers,c.device.expectedPorts.length)},async()=>{
   while(!incomplete&&cursor<c.device.expectedPorts.length){
    const port=c.device.expectedPorts[cursor++];
    try{
     const outcome=await request(signal=>adapters.probe(c.device.publicIp!,port,LIMITS.probeMs,signal),LIMITS.probeMs+100);
     if(!outcome||outcome.attempted!==true||typeof outcome.online!=='boolean'
      ||!(outcome.latency_ms===null||typeof outcome.latency_ms==='number'&&Number.isFinite(outcome.latency_ms)&&outcome.latency_ms>=0))throw Error();
     ports[String(port)]=outcome;
    }catch{incomplete=true;}
   }
  }));
  const at=now();
  if(incomplete||at<began||at>=deadline||Object.keys(ports).length!==c.device.expectedPorts.length){hold('probe_incomplete');continue;}
  const observation=completedObservation(c,ports,at);
  if(!observation){hold('probe_incomplete');continue;}
  // Independent full reread, including collisions and every reservation, AFTER
  // all sockets settle and immediately before the atomic publisher call.
  let fresh:Snapshot,current:Candidate|undefined;
  try{fresh=structuredClone(await request(adapters.read));current=(await planExactProductChecks(fresh,[c.productId],now())).selected[0];}
  catch{hold('revalidation_unavailable');continue;}
  if(!current||current.guard!==c.guard){hold('source_identity_or_config_changed');continue;}
  if(now()<at||now()>=deadline||now()-at>10_000){hold('observation_expired');continue;}
  const receiptKey=await digest([CONTRACT,options.runId,c.productId,c.guard]);
  const body:Omit<Publication,'payloadSha256'>={contract:CONTRACT,receiptKey,runId:options.runId,productId:c.productId,deviceId:String(c.device.deviceId),
   expectedAuthorityGuard:c.guard,authorityEpoch:fresh.authorityEpoch,identity:c.identity,
   config:{publicIp:c.device.publicIp,expectedPorts:c.device.expectedPorts,connectionRevision:c.device.connectionRevision,
    source:c.device.source,monitoringProfile:c.device.monitoringProfile},observation};
  const publication:Publication={...body,payloadSha256:await digest(body)};
  if(now()>=deadline){hold('deadline');continue;}
  try{
   const receipt=await request(signal=>adapters.publishAtomic(publication,signal));
   if(receipt?.ok===false){hold('atomic_publication_rejected');continue;}
   if(receipt?.ok!==true||receipt.receiptKey!==receiptKey||receipt.payloadSha256!==publication.payloadSha256)throw Error();
   outcomes.push({productId:c.productId,state:'published',receiptKey});
  }catch{
   // An aborted HTTP response cannot establish whether a commit happened. Never
   // retry or turn it into an Offline observation; reconcile the receipt first.
   outcomes.push({productId:c.productId,state:'publication_uncertain',reason:'receipt_unverified',receiptKey});
  }
 }
 return {outcomes,complete:outcomes.length===options.productIds.length&&outcomes.every(o=>o.state==='published')};
}
