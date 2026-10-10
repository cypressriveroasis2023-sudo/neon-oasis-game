import {BATCH_CONTRACT,INTAKE_LIMITS,IntakeFault,exact,identity,row,utc,validateOperationalTicket,type IntakeTicket,type OperationalBatch,type Window} from './mhelpIntakeRuntime.ts';
export type IntakePolicy={state:'ready';portalId:string;activationFloor:string;schemaContract:string;schemaEvidence:string;typeMappingsVerified:boolean;identityMappingsVerified:boolean;statusPoliciesVerified:boolean};
/** Trusted binding only: uses the native existing mHelp token manager and fixed vendor endpoints. */
export type VerifiedSourceAdapter={
  schemaContract:string;
  schemaEvidence:string;
  open?:(portalId:string,signal:AbortSignal)=>Promise<void>;
  readPage:(input:Window&{portalId:string;offset:number;pageSize:50},signal:AbortSignal)=>Promise<{totalRows:number;rows:unknown[]}>;
  projectTicket:(row:unknown,scope:IntakePolicy)=>IntakeTicket;
};
export function projectIntakePolicyResponse(value:unknown){
  const r=row(value);
  if(r.state==='disabled'||r.state==='review_needed'){exact(r,['state']);return {state:r.state};}
  exact(r,['state','portalId','activationFloor','schemaContract','schemaEvidence','typeMappingsVerified','identityMappingsVerified','statusPoliciesVerified']);
  if(r.state!=='ready')throw new IntakeFault('CONFIGURATION');
  identity(r.portalId);utc(r.activationFloor);
  if(typeof r.schemaContract!=='string'||!r.schemaContract||r.schemaContract.length>128||typeof r.schemaEvidence!=='string'||!r.schemaEvidence.trim()||r.schemaEvidence.length>1000||typeof r.typeMappingsVerified!=='boolean'||typeof r.identityMappingsVerified!=='boolean'||typeof r.statusPoliciesVerified!=='boolean')throw new IntakeFault('CONFIGURATION');
  return {state:'ready' as const,portalId:r.portalId as string,activationFloor:r.activationFloor as string,schemaContract:r.schemaContract,schemaEvidence:r.schemaEvidence,typeMappingsVerified:r.typeMappingsVerified,identityMappingsVerified:r.identityMappingsVerified,statusPoliciesVerified:r.statusPoliciesVerified};
}
export function parseIntakePolicy(value:unknown):IntakePolicy {
  const r=projectIntakePolicyResponse(value);
  // Ready authorizes only bounded discovery under the reviewed source schema.
  // Coverage flags are diagnostics: unknown per-ticket mappings must reach the
  // private writer as durable holds, without blocking unrelated eligible work.
  if(r.state!=='ready'||!('typeMappingsVerified' in r))throw new IntakeFault('CONFIGURATION');
  return r as IntakePolicy;
}
/** There are currently NO approved operational schema adapters. Environment flags cannot invent one. */
export const APPROVED_OPERATIONAL_ADAPTERS:Readonly<Record<string,never>>=Object.freeze({});
export const productionAdapterFor=(_policy:IntakePolicy,_access?:unknown):VerifiedSourceAdapter|null=>null;
/** One legacy watermark is authoritative. Native independently validates fixed portal/floor/bounds. */
export function createBoundedMhelpSource(options:{getPolicy:(signal:AbortSignal)=>Promise<unknown>;adapterFor:(policy:IntakePolicy)=>VerifiedSourceAdapter|null;now?:()=>number}){
  return async (window:Window,signal:AbortSignal):Promise<OperationalBatch>=>{
    const policy=parseIntakePolicy(await options.getPolicy(signal));
    const after=Date.parse(utc(window.createdAfter)),before=Date.parse(utc(window.createdBefore)),floor=Date.parse(policy.activationFloor),now=(options.now??Date.now)();
    if(floor>now||after<floor-1||before<=after||before>now||before-after>INTAKE_LIMITS.maxWindowMs)throw new IntakeFault('CONFIGURATION');
    const adapter=options.adapterFor(policy);
    if(!adapter||adapter.schemaContract!==policy.schemaContract||adapter.schemaEvidence!==policy.schemaEvidence)throw new IntakeFault('CONFIGURATION');
    await adapter.open?.(policy.portalId,signal);
    const tickets:IntakeTicket[]=[];let total:number|undefined,lastId=0n,bytes=0;
    for(let page=0;page<INTAKE_LIMITS.maxPages;page++){
      if(signal.aborted)throw new IntakeFault('DEADLINE',true);
      const value=row(await adapter.readPage({...window,portalId:policy.portalId,offset:tickets.length,pageSize:50},signal));exact(value,['totalRows','rows']);
      if(!Number.isSafeInteger(value.totalRows)||Number(value.totalRows)<0||!Array.isArray(value.rows))throw new IntakeFault('SOURCE_INVALID');
      if(Number(value.totalRows)>INTAKE_LIMITS.maxTickets)throw new IntakeFault('BATCH_LIMIT');
      if(total!==undefined&&total!==value.totalRows)throw new IntakeFault('SOURCE_INVALID');total=Number(value.totalRows);
      if(value.rows.length!==Math.min(INTAKE_LIMITS.pageSize,total-tickets.length))throw new IntakeFault('SOURCE_INVALID');
      for(const input of value.rows){
        const ticket=validateOperationalTicket(adapter.projectTicket(input,policy),{...window,...policy});
        const id=BigInt(ticket.source.ticketId);if(id<=lastId)throw new IntakeFault('SOURCE_INVALID');lastId=id;
        bytes+=new TextEncoder().encode(JSON.stringify(ticket)).byteLength;if(bytes>INTAKE_LIMITS.maxResponseBytes-4096)throw new IntakeFault('BATCH_LIMIT');tickets.push(ticket);
      }
      if(tickets.length===total)return {contract:BATCH_CONTRACT,portalId:policy.portalId,schemaContract:policy.schemaContract,window:{createdAfter:window.createdAfter,createdBefore:window.createdBefore},totalRows:total,partial:false,tickets};
    }
    throw new IntakeFault('BATCH_LIMIT');
  };
}

import {PENDING_LIMITS,PENDING_BATCH_CONTRACT,parsePendingScope,pendingIdentityChanged,validatePendingTicket,validatePendingBatch,type PendingScope,type PendingFailure,type PendingOutcome} from './mhelpIntakePending.ts';
import {deadline} from './mhelpIntakeRuntime.ts';
/** Only a verified adapter may classify an error as isolated to one ticket.
 * Unknown errors, authentication faults and provider cooldowns stop the batch. */
export class PendingTicketFault extends IntakeFault {}
class PendingBudgetFault extends IntakeFault {constructor(){super('DEADLINE',true);}}
export type PendingProviderRequest=<T>(work:()=>Promise<T>)=>Promise<T>;
export type PendingSourceAdapter=VerifiedSourceAdapter&{
  openPending?:(portalId:string,signal:AbortSignal,request:PendingProviderRequest)=>Promise<void>;
  readPendingTicket:(input:{portalId:string;ticketId:string},signal:AbortSignal,request:PendingProviderRequest)=>Promise<unknown>;
};
/** No production adapter is registered. Every future provider GET, including
 * auth/open and appointment pagination, MUST use the shared request allowance. */
export function createBoundedPendingSource(options:{
  getPolicy:(signal:AbortSignal)=>Promise<unknown>;
  getScope:(leaseId:string,signal:AbortSignal)=>Promise<unknown>;
  adapterFor:(policy:IntakePolicy)=>PendingSourceAdapter|null;
  now?:()=>number;sleep?:(ms:number,signal:AbortSignal)=>Promise<void>;
}){
  return async(leaseId:string,signal:AbortSignal)=>{
    signal=AbortSignal.any([signal,AbortSignal.timeout(PENDING_LIMITS.deadlineMs-1000)]);
    const now=options.now??Date.now;
    const scope=parsePendingScope(await deadline(()=>options.getScope(leaseId,signal),signal),now());
    if(scope.leaseId!==leaseId)throw new IntakeFault('CONFIGURATION');
    const policy=parseIntakePolicy(await deadline(()=>options.getPolicy(signal),signal));
    if(policy.portalId!==scope.portalId||policy.activationFloor!==scope.activationFloor||policy.schemaContract!==scope.schemaContract)throw new IntakeFault('CONFIGURATION');
    const adapter=options.adapterFor(policy);
    if(!adapter||adapter.schemaContract!==policy.schemaContract||adapter.schemaEvidence!==policy.schemaEvidence)throw new IntakeFault('CONFIGURATION');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),PENDING_LIMITS.deadlineMs-1000);
    const bounded=AbortSignal.any([signal,controller.signal]);let requests=0,budgetExhausted=false,failure:PendingFailure|undefined;
    const outcomes:PendingOutcome[]=[];
    const sleep=options.sleep??((ms:number,s:AbortSignal)=>new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(t);reject(new PendingBudgetFault());};const t=setTimeout(()=>{s.removeEventListener('abort',abort);resolve();},ms);s.addEventListener('abort',abort,{once:true});}));
    const request:PendingProviderRequest=async work=>{
      for(let attempt=0;;attempt++){
        if(bounded.aborted||requests>=PENDING_LIMITS.maxProviderRequests)throw new PendingBudgetFault();
        requests++;
        try{return await deadline(work,bounded);}catch(error){
          if(bounded.aborted)throw new PendingBudgetFault();
          if(!(error instanceof IntakeFault)||!error.retryable||error.retryAfterSeconds!==undefined||attempt>=2)throw error;
          await deadline(()=>sleep(250*2**attempt,bounded),bounded);
        }
      }
    };
    const safeFailure=(error:unknown):PendingFailure=>{const e=error instanceof IntakeFault?error:new IntakeFault('INTERNAL');
      const code=['SOURCE_UNAVAILABLE','SOURCE_INVALID','DEADLINE','CONFIGURATION','INTERNAL'].includes(e.code)?e.code as PendingFailure['code']:'INTERNAL';
      return {code,retryable:e.retryable&&['SOURCE_UNAVAILABLE','DEADLINE'].includes(code),...(e.retryAfterSeconds!==undefined?{retryAfterSeconds:e.retryAfterSeconds}:{})};};
    try{
      if(scope.tickets.length)await deadline(()=>adapter.openPending?.(scope.portalId,bounded,request)??Promise.resolve(),bounded);
      for(const item of scope.tickets){
        if(bounded.aborted||requests>=PENDING_LIMITS.maxProviderRequests){budgetExhausted=true;break;}
        try{
          const raw=await deadline(()=>adapter.readPendingTicket({portalId:scope.portalId,ticketId:item.ticketId},bounded,request),bounded);
          const projected=adapter.projectTicket(raw,policy);
          if(pendingIdentityChanged(projected,scope,item.ticketId)){outcomes.push({ticketId:item.ticketId,identityChanged:true});continue;}
          const ticket=validatePendingTicket(projected,scope);
          if(ticket.source.ticketId!==item.ticketId)throw new IntakeFault('SOURCE_INVALID');
          outcomes.push({ticketId:item.ticketId,ticket});
        }catch(error){
          if(error instanceof PendingBudgetFault||bounded.aborted){budgetExhausted=true;break;}
          const safe=safeFailure(error);outcomes.push({ticketId:item.ticketId,...safe});
          if(!(error instanceof PendingTicketFault)||safe.retryAfterSeconds!==undefined){failure=safe;break;}
        }
      }
    }catch(error){if(error instanceof PendingBudgetFault||bounded.aborted)budgetExhausted=true;else failure=safeFailure(error);}
    finally{clearTimeout(timer);controller.abort();}
    const batch=validatePendingBatch({contract:PENDING_BATCH_CONTRACT,leaseId,outcomes,budgetExhausted,...(failure?{failure}:{})},scope);
    return {scope,batch};
  };
}
