/** Runtime-only bindings. This module never retrieves, stores, prints or copies a secret. */
import {IntakeFault,type Rpc,type Window,type FaultCode} from './mhelpIntakeRuntime.ts';
import {readBoundedJson} from './mhelpIntakeHandlers.ts';
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
export function createExistingCredentialSourceRead(options:{projectUrl:string;request:Request;fetch:typeof fetch}){
  const candidate=options.request.headers.get('x-camera-cron-secret');
  if(options.projectUrl!==LEGACY||!candidate||candidate.length>1024||/\s/.test(candidate))throw new IntakeFault('CONFIGURATION');
  return async(window:Window,signal:AbortSignal)=>{
    let response:Response;
    try{response=await options.fetch(NATIVE_SOURCE,{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':candidate},body:JSON.stringify({action:'ticket_batch',createdAfter:window.createdAfter,createdBefore:window.createdBefore}),redirect:'error',cache:'no-store',signal});}
    catch{throw new IntakeFault('SOURCE_UNAVAILABLE',true);}
    if(!response.ok){
      let code:FaultCode='SOURCE_UNAVAILABLE';try{const failure=await readBoundedJson(response.body,512,signal) as {code?:unknown};if(failure&&typeof failure.code==='string'&&['SOURCE_UNAVAILABLE','SOURCE_INVALID','BATCH_LIMIT','DEADLINE','CONFIGURATION','INTERNAL'].includes(failure.code))code=failure.code as FaultCode;}catch{/* Ignore untrusted error details. */}
      throw new IntakeFault(code,['SOURCE_UNAVAILABLE','DEADLINE'].includes(code)&&TRANSIENT.has(response.status));
    }
    try{return await readBoundedJson(response.body,3*1048576,signal);}catch{throw new IntakeFault('SOURCE_INVALID');}
  };
}
/** Fixed policy read via the original verifier, after its existing Camera Health check. */
export function createExistingCredentialPolicyRead(options:{projectUrl:string;request:Request;fetch:typeof fetch}){
  const candidate=options.request.headers.get('x-camera-cron-secret');
  if(options.projectUrl!=='https://tughscoxralhofrckvxy.supabase.co'||!candidate||candidate.length>1024||/\s/.test(candidate))throw new IntakeFault('CONFIGURATION');
  return async(signal:AbortSignal)=>{
    let response:Response;try{response=await options.fetch(LEGACY+'/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':candidate},body:JSON.stringify({action:'intake_policy'}),redirect:'error',cache:'no-store',signal});}catch{throw new IntakeFault('SOURCE_UNAVAILABLE',true);}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw new IntakeFault('SOURCE_UNAVAILABLE',TRANSIENT.has(response.status));}
    try{return await readBoundedJson(response.body,4096,signal);}catch{throw new IntakeFault('CONFIGURATION');}
  };
}
