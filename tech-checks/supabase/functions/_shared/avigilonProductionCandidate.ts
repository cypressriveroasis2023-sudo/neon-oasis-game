import {createOperationsHandler} from '../cos-operations-pages/index.ts';
import {createAvigilonSourceCoordinator} from './avigilonSourceCoordinator.ts';
import {createAvigilonServiceRuntime} from './avigilonServiceRuntime.ts';
import {createAvigilonCheckRuns} from './avigilonCheckRun.ts';
import {withStableAvigilonRead} from './avigilonReadBoundary.ts';
import type {Actor,Endpoint,ProbeResult} from './avigilonCheckRun.ts';
/** Candidate bootstrap, disabled unless explicitly invoked with enabled:true by
 * reviewed server code. No entrypoint invokes it in this PR. No new credentials
 * are minted. Both configured existing project transports are required. */
export function createAvigilonProductionCandidate(o:{enabled?:boolean;actor:Actor;platformUrl:string;serviceKey:string;legacyUrl:string;legacyServiceKey:string;fetch?:typeof fetch;background?:(work:Promise<void>)=>void;probe:(actor:Actor,endpoint:Endpoint,signal:AbortSignal)=>Promise<ProbeResult>}){
 if(o.enabled!==true)return undefined;
 if(typeof o.background!=='function')throw Error('Reviewed host background lifecycle required');
 if(new URL(o.legacyUrl).origin!=='https://goqrnolcvqnirjmzaeyk.supabase.co')throw Error('Source reader legacy project mismatch');
 const fetcher=o.fetch||fetch;
 const transport=(url:string,key:string)=>{const base=new URL(url);if(base.protocol!=='https:'||base.username||base.password||!key)throw Error('Reviewed project transport required');return async(name:string,payload:any)=>{const response=await fetcher(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Source transport unavailable; durable operation remains pending');return response.json();};};
 const nativeRpc=transport(o.platformUrl,o.serviceKey),legacyRpc=transport(o.legacyUrl,o.legacyServiceKey);
 const actorArgs={p_actor_user_id:o.actor.actorId,p_organization_id:o.actor.tenantId};
 const reader=createOperationsHandler({platformUrl:o.platformUrl,serviceKey:o.serviceKey,fetch:fetcher,mhelpPlacementEnabled:true});
 const readRoster=()=>reader.readAuthorityRoster(o.actor,{apikey:o.legacyServiceKey,Authorization:'Bearer '+o.legacyServiceKey,Accept:'application/json'});
 const sourcesForActor=(actor:Actor)=>createAvigilonSourceCoordinator({actor,native:(p_action,p_payload)=>nativeRpc('cos_avigilon_source_control',{p_actor_user_id:actor.actorId,p_organization_id:actor.tenantId,p_action,p_payload}),applyLegacy:p_ticket=>legacyRpc('cos_avigilon_source_apply',{p_ticket}),readLegacySeal:()=>legacyRpc('cos_avigilon_source_seal',{}),cancelLegacy:p_ticket=>legacyRpc('cos_avigilon_source_cancel',{p_ticket}),readRoster:()=>reader.readAuthorityRoster(actor,{apikey:o.legacyServiceKey,Authorization:'Bearer '+o.legacyServiceKey,Accept:'application/json'})});
 const sources=sourcesForActor(o.actor);
 const recoverSources=async()=>{
  const state=await nativeRpc('cos_avigilon_source_control',{...actorArgs,p_action:'state',p_payload:{}});
  // Resume the durable initiating actor, not the visitor. Every native operation
  // rechecks that actor's current role; revocation intentionally remains closed.
  return sourcesForActor(state.pending?{...o.actor,actorId:state.pending.actorId}:o.actor).reconcile();
 };
 const jobs=new Set<Promise<void>>();
 const checks=createAvigilonServiceRuntime({...o,enabled:true,background:work=>{o.background!(work);jobs.add(work);void work.finally(()=>jobs.delete(work)).catch(()=>{});}})!;
 const checksWithRecovery={...checks,readHealth:async(actor:Actor)=>{if(actor.tenantId!==o.actor.tenantId)throw Error('Tenant mismatch');await recoverSources();return checks.readHealth(actor);}};
 const checkManaged=async()=>{
  await recoverSources();
  const runs=createAvigilonCheckRuns({authorize:async()=>o.actor,store:checks.store(o.actor),roster:async()=> (await withStableAvigilonRead(o.actor.tenantId,()=>checks.readHealth(o.actor),async()=>readRoster())).value,probe:o.probe,background:checks.background,id:()=>crypto.randomUUID()});
  const {run}=await runs.start(new Request('https://internal.invalid'));
  await Promise.all([...jobs]);
  const saved=await runs.read(new Request('https://internal.invalid'),run.id);
  return {run:saved,results:saved.rows.map(row=>({id:row.unitId,name:row.name,status:row.outcome==='online'?'online':row.confirmedOutage?'offline':'verifying',published:!!row.publicationReceipt,publicationReceipt:row.publicationReceipt||null,activated:false,evidence:'service_port_only'})),eligible:saved.rows.length,held:saved.rows.filter(r=>r.outcome==='unverified'),deferred:saved.rows.filter(r=>r.outcome==='pending').length,deadlineReached:saved.state!=='completed'};
 };
 return {sources:{...sources,reconcile:recoverSources},sourcesForActor,checkManaged,checks:checksWithRecovery};
}
