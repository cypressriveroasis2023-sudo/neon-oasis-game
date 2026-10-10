import {BATCH_CONTRACT,INTAKE_LIMITS,IntakeFault,exact,identity,row,utc,validateOperationalTicket,type IntakeTicket,type OperationalBatch,type Window} from './mhelpIntakeRuntime.ts';
export type IntakePolicy={state:'ready';portalId:string;activationFloor:string;schemaContract:string;schemaEvidence:string;typeMappingsVerified:true;identityMappingsVerified:true;statusPoliciesVerified:true};
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
  if(r.state!=='ready'||!('typeMappingsVerified' in r)||r.typeMappingsVerified!==true||r.identityMappingsVerified!==true||r.statusPoliciesVerified!==true)throw new IntakeFault('CONFIGURATION');
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
