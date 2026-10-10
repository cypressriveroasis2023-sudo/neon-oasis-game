/** Runtime-only bindings. This module never retrieves, stores, prints or copies a secret. */
import {IntakeFault,type Rpc,type Window,type FaultCode} from './mhelpIntakeRuntime.ts';
import {readBoundedJson,fetchBounded,cancelBody} from './mhelpIntakeHandlers.ts';
import {DEFAULT_RETRY_AFTER_SECONDS,isRetryAfterSeconds,parseRetryAfter} from './mhelpIntakeRetry.ts';
const NATIVE_SOURCE='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-mhelp-ticket-source';
const LEGACY='https://goqrnolcvqnirjmzaeyk.supabase.co';
const TRANSIENT=new Set([408,429,500,502,503,504]);
/** Pass the legacy runtime's existing service client; its built-in key never leaves that project. */
export function createExistingServiceRpc(db:{rpc:(name:string,args:Record<string,unknown>)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown;status?:number}>}}):Rpc {
  return async(input,signal)=>{
    let result;try{result=await db.rpc('camera_mhelp_ticket_intake_v1',{p_request:input}).abortSignal(signal);}catch{throw new IntakeFault('WRITE_UNAVAILABLE',true);}
    if(result.error){const code=typeof result.error==='object'&&result.error!==null?'code' in result.error?(result.error as {code:unknown}).code:null:null;throw new IntakeFault('WRITE_UNAVAILABLE',TRANSIENT.has(result.status??0)||['55P03','40P01','40001'].includes(String(code)));}return result.data;
  };
}
/** Reuses the already-authenticated incoming Camera Health credential in the deployed runtime only. */
function createExistingCredentialSourceTransport(options:{projectUrl:string;request:Request;fetch:typeof fetch}){
  const candidate=options.request.headers.get('x-camera-cron-secret');
  if(options.projectUrl!==LEGACY||!candidate||candidate.length>1024||/\s/.test(candidate))throw new IntakeFault('CONFIGURATION');
  return async(body:Record<string,unknown>,signal:AbortSignal)=>{
    let response:Response;
    try{response=await fetchBounded(options.fetch,NATIVE_SOURCE,{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':candidate},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal},signal);}
    catch{throw new IntakeFault('SOURCE_UNAVAILABLE',true);}
    if(!response.ok){
      let failure:unknown;try{failure=await readBoundedJson(response.body,512,signal);}catch{/* Ignore untrusted error details. */}
      if(failure&&typeof failure==='object'&&!Array.isArray(failure)){
        const value=failure as Record<string,unknown>;
        if(typeof value.code==='string'&&['SOURCE_UNAVAILABLE','SOURCE_INVALID','BATCH_LIMIT','DEADLINE','CONFIGURATION','INTERNAL'].includes(value.code)){
          const code=value.code as FaultCode,valid=Object.keys(value).every(k=>['code','retryable','retryAfterSeconds'].includes(k))&&typeof value.retryable==='boolean'&&(!('retryAfterSeconds' in value)||isRetryAfterSeconds(value.retryAfterSeconds));
          const retryable=valid&&value.retryable===true&&['SOURCE_UNAVAILABLE','DEADLINE'].includes(code),headerDelay=retryable?parseRetryAfter(response.headers.get('Retry-After')):undefined;
          let cooldown=valid?value.retryAfterSeconds as number|undefined:undefined;
          if(headerDelay!==undefined)cooldown=Math.max(cooldown??0,headerDelay);
          if(retryable&&response.status===429&&cooldown===undefined)cooldown=DEFAULT_RETRY_AFTER_SECONDS;
          // A malformed/old error DTO must never upgrade a permanent fault to a retry.
          throw new IntakeFault(code,retryable,cooldown);
        }
      }
      const retryable=TRANSIENT.has(response.status);
      throw new IntakeFault('SOURCE_UNAVAILABLE',retryable,retryable?(parseRetryAfter(response.headers.get('Retry-After'))??DEFAULT_RETRY_AFTER_SECONDS):undefined);
    }
    try{return await readBoundedJson(response.body,3*1048576,signal);}catch{throw new IntakeFault('SOURCE_INVALID');}
  };
}
export function createExistingCredentialSourceRead(options:Parameters<typeof createExistingCredentialSourceTransport>[0]){
  const send=createExistingCredentialSourceTransport(options);
  return (window:Window,signal:AbortSignal)=>send({action:'ticket_batch',createdAfter:window.createdAfter,createdBefore:window.createdBefore},signal);
}
export function createExistingCredentialPendingRead(options:Parameters<typeof createExistingCredentialSourceTransport>[0]){
  const send=createExistingCredentialSourceTransport(options);
  return (leaseId:string,signal:AbortSignal)=>send({action:'ticket_refresh',leaseId},signal);
}
/** Fixed policy read via the original verifier, after its existing Camera Health check. */
export function createExistingCredentialPolicyRead(options:{projectUrl:string;request:Request;fetch:typeof fetch}){
  const candidate=options.request.headers.get('x-camera-cron-secret');
  if(options.projectUrl!=='https://tughscoxralhofrckvxy.supabase.co'||!candidate||candidate.length>1024||/\s/.test(candidate))throw new IntakeFault('CONFIGURATION');
  return async(signal:AbortSignal)=>{
    let response:Response;try{response=await fetchBounded(options.fetch,LEGACY+'/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':candidate},body:JSON.stringify({action:'intake_policy'}),redirect:'error',cache:'no-store',signal},signal);}catch{throw new IntakeFault('SOURCE_UNAVAILABLE',true);}
    if(!response.ok){cancelBody(response.body);throw new IntakeFault('SOURCE_UNAVAILABLE',TRANSIENT.has(response.status));}
    try{return await readBoundedJson(response.body,4096,signal);}catch{throw new IntakeFault('CONFIGURATION');}
  };
}

/** Same fixed verifier and existing cron identity; no arbitrary IDs cross HTTP. */
export function createExistingCredentialPendingScopeRead(options:{projectUrl:string;request:Request;fetch:typeof fetch}){
  const candidate=options.request.headers.get('x-camera-cron-secret');
  if(options.projectUrl!=='https://tughscoxralhofrckvxy.supabase.co'||!candidate||candidate.length>1024||/\s/.test(candidate))throw new IntakeFault('CONFIGURATION');
  return async(leaseId:string,signal:AbortSignal)=>{
    let response:Response;
    try{response=await fetchBounded(options.fetch,LEGACY+'/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':candidate},body:JSON.stringify({action:'intake_pending_scope',leaseId}),redirect:'error',cache:'no-store'},signal);}
    catch{throw new IntakeFault('SOURCE_UNAVAILABLE',true);}
    if(!response.ok){cancelBody(response.body);throw new IntakeFault('SOURCE_UNAVAILABLE',TRANSIENT.has(response.status));}
    return readBoundedJson(response.body,4096,signal);
  };
}
