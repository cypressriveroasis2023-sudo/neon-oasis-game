/** Fixed, private refresh contracts. No caller-selected source IDs or historical discovery. */
import {IntakeFault,exact,identity,row,utc,validateOperationalTicket,type IntakeTicket} from './mhelpIntakeRuntime.ts';
import {isRetryAfterSeconds} from './mhelpIntakeRetry.ts';
export const PENDING_LIMITS=Object.freeze({maxTickets:10,deadlineMs:30000,maxProviderRequests:20,maxResponseBytes:1048576});
export const PENDING_SCOPE_CONTRACT='cos-mhelp-pending-scope-v1';
export const PENDING_BATCH_CONTRACT='cos-mhelp-pending-batch-v1';
export type PendingScope={contract:typeof PENDING_SCOPE_CONTRACT;leaseId:string;portalId:string;schemaContract:string;activationFloor:string;leaseUntil:string;tickets:{ticketId:string;createdAt:string}[]};
export type PendingFailure={code:'SOURCE_UNAVAILABLE'|'SOURCE_INVALID'|'DEADLINE'|'CONFIGURATION'|'INTERNAL';retryable:boolean;retryAfterSeconds?:number};
export type PendingOutcome={ticketId:string;identityChanged:true}|{ticketId:string;ticket:IntakeTicket}|({ticketId:string}&PendingFailure);
export type PendingBatch={contract:typeof PENDING_BATCH_CONTRACT;leaseId:string;outcomes:PendingOutcome[];budgetExhausted:boolean;failure?:PendingFailure};
export const leaseIdentity=(value:unknown):string=>{if(typeof value!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value))throw new IntakeFault('SOURCE_INVALID');return value;};
export function parsePendingScope(value:unknown,now=Date.now()):PendingScope {
  const v=row(value);exact(v,['contract','leaseId','portalId','schemaContract','activationFloor','leaseUntil','tickets']);
  if(v.contract!==PENDING_SCOPE_CONTRACT||typeof v.schemaContract!=='string'||!v.schemaContract||v.schemaContract.length>128||!Array.isArray(v.tickets)||v.tickets.length>PENDING_LIMITS.maxTickets)throw new IntakeFault('SOURCE_INVALID');
  leaseIdentity(v.leaseId);identity(v.portalId);const floor=Date.parse(utc(v.activationFloor)),until=Date.parse(utc(v.leaseUntil));
  if(floor>now||until<=now||until>now+181000)throw new IntakeFault('SOURCE_INVALID');
  const seen=new Set<string>();for(const input of v.tickets){const item=row(input);exact(item,['ticketId','createdAt']);const id=identity(item.ticketId),created=Date.parse(utc(item.createdAt));if(seen.has(id)||created<floor||created>=now)throw new IntakeFault('SOURCE_INVALID');seen.add(id);}
  return structuredClone(v) as PendingScope;
}
/** A same-key creation-instant contradiction parks the existing receipt, never
 * retains the altered envelope or changes the admitted historical boundary. */
export function pendingIdentityChanged(value:unknown,scope:PendingScope,requestedId:string):boolean {
  const v=row(value),s=row(v.source),item=scope.tickets.find(t=>t.ticketId===requestedId);
  if(!item||v.contract!=='cos-mhelp-legacy-intake-v1'||v.schemaContract!==scope.schemaContract||s.portalId!==scope.portalId||s.ticketId!==requestedId)throw new IntakeFault('SOURCE_INVALID');
  return Date.parse(utc(s.createdAt))!==Date.parse(item.createdAt);
}
export function validatePendingTicket(value:unknown,scope:PendingScope):IntakeTicket {
  const v=row(value),s=row(v.source),item=scope.tickets.find(t=>t.ticketId===s.ticketId);
  if(!item||Date.parse(utc(s.createdAt))!==Date.parse(item.createdAt))throw new IntakeFault('SOURCE_INVALID');
  // Reuse field allowlists only with the one exact admitted creation instant.
  // Discovery's window remains strict and unchanged.
  return validateOperationalTicket(value,{...scope,createdAfter:new Date(Date.parse(item.createdAt)-1).toISOString(),createdBefore:new Date(Date.parse(item.createdAt)+1).toISOString()});
}
export function parsePendingFailure(value:unknown):PendingFailure {
  const v=row(value);exact(v,['code','retryable','retryAfterSeconds']);
  if(!['SOURCE_UNAVAILABLE','SOURCE_INVALID','DEADLINE','CONFIGURATION','INTERNAL'].includes(String(v.code))||typeof v.retryable!=='boolean'||('retryAfterSeconds' in v&&!isRetryAfterSeconds(v.retryAfterSeconds)))throw new IntakeFault('SOURCE_INVALID');
  if(v.retryable&&!['SOURCE_UNAVAILABLE','DEADLINE'].includes(String(v.code)))throw new IntakeFault('SOURCE_INVALID');
  return v as PendingFailure;
}
export function validatePendingBatch(value:unknown,scope:PendingScope):PendingBatch {
  const v=row(value);exact(v,['contract','leaseId','outcomes','budgetExhausted','failure']);
  if(v.contract!==PENDING_BATCH_CONTRACT||v.leaseId!==scope.leaseId||!Array.isArray(v.outcomes)||v.outcomes.length>scope.tickets.length||typeof v.budgetExhausted!=='boolean')throw new IntakeFault('SOURCE_INVALID');
  if(v.failure!==undefined)parsePendingFailure(v.failure);
  const seen=new Set<string>();for(const input of v.outcomes){const outcome=row(input),id=identity(outcome.ticketId);if(seen.has(id)||!scope.tickets.some(t=>t.ticketId===id))throw new IntakeFault('SOURCE_INVALID');seen.add(id);
    if('identityChanged' in outcome){exact(outcome,['ticketId','identityChanged']);if(outcome.identityChanged!==true)throw new IntakeFault('SOURCE_INVALID');}
    else if('ticket' in outcome){exact(outcome,['ticketId','ticket']);const ticket=validatePendingTicket(outcome.ticket,scope);if(ticket.source.ticketId!==id)throw new IntakeFault('SOURCE_INVALID');}
    else{const {ticketId:_,...failure}=outcome;parsePendingFailure(failure);}
  }
  if(v.outcomes.length!==scope.tickets.length&&!v.budgetExhausted&&!v.failure)throw new IntakeFault('SOURCE_INVALID');
  if(new TextEncoder().encode(JSON.stringify(v)).byteLength>PENDING_LIMITS.maxResponseBytes)throw new IntakeFault('SOURCE_INVALID');
  return structuredClone(v) as PendingBatch;
}
