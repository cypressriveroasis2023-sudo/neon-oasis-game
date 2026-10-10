import {INTAKE_CONTRACT,INTAKE_LIMITS,IntakeFault,exact,row,utc,identity,validateBatch,deadline,type RunResult,type Window} from './mhelpIntakeRuntime.ts';
import {leaseIdentity,parsePendingScope,validatePendingBatch,PENDING_LIMITS} from './mhelpIntakePending.ts';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
/** Cancellation is best-effort: hostile streams may throw or never settle. */
export function cancelBody(body:ReadableStream<Uint8Array>|null|undefined){try{void body?.cancel().catch(()=>{});}catch{/* already locked/closed */}}
export async function fetchBounded(fetcher:typeof fetch,input:RequestInfo|URL,init:RequestInit,signal:AbortSignal):Promise<Response>{
  // A transport may ignore AbortSignal. Consume a late response without leaking
  // it or waiting for cancellation, while deadline returns on the abort itself.
  if(signal.aborted)throw new IntakeFault('DEADLINE',true);
  const promise=Promise.resolve().then(()=>{if(signal.aborted)throw new IntakeFault('DEADLINE',true);return fetcher(input,{...init,signal});});
  void promise.then(response=>{if(signal.aborted)cancelBody(response.body);},()=>{});
  return deadline(()=>promise,signal);
}
export async function readBoundedJson(body:ReadableStream<Uint8Array>|null,maxBytes:number,signal?:AbortSignal):Promise<unknown>{
  const reader=body?.getReader();if(!reader)throw new IntakeFault('SOURCE_INVALID');const chunks:Uint8Array[]=[];let size=0;
  const cancel=()=>{try{void reader.cancel().catch(()=>{});}catch{/* best effort */}};signal?.addEventListener('abort',cancel,{once:true});
  try{while(true){if(signal?.aborted)throw new IntakeFault('DEADLINE',true);const read=()=>reader.read();const {done,value}=await (signal?deadline(read,signal):read());if(done)break;size+=value.byteLength;if(size>maxBytes)throw new IntakeFault('SOURCE_INVALID');chunks.push(value);}}
  finally{signal?.removeEventListener('abort',cancel);cancel();try{reader.releaseLock();}catch{/* a broken stream may retain a pending read */}}
  if(signal?.aborted)throw new IntakeFault('DEADLINE',true);
  const bytes=new Uint8Array(size);let at=0;for(const value of chunks){bytes.set(value,at);at+=value.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function requestBody(req:Request){
  if(req.method!=='POST'||new URL(req.url).search||!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||''))throw new IntakeFault('SOURCE_INVALID');
  return row(await readBoundedJson(req.body,256,AbortSignal.any([req.signal,AbortSignal.timeout(10000)])));
}
const authenticated=async(req:Request,verify:(req:Request)=>Promise<boolean>|boolean)=>{try{return await verify(req)===true;}catch{return false;}};
/** The only scheduler-facing response is a fixed allowlist of counts and codes, safe for pg_net storage. */
export function projectRunResult(input:RunResult){
  if(input.contract!==INTAKE_CONTRACT||!['disabled','busy','backoff','idle','complete','failed'].includes(input.state))throw new IntakeFault('INTERNAL');
  const counts={scanned:input.scanned,created:input.created,existing:input.existing,reviewNeeded:input.reviewNeeded};
  if(Object.values(counts).some(n=>!Number.isSafeInteger(n)||n<0||n>INTAKE_LIMITS.maxTickets)||counts.created+counts.existing+counts.reviewNeeded>counts.scanned||typeof input.watermarkAdvanced!=='boolean'||(input.state==='complete'&&!input.watermarkAdvanced)||(input.watermarkAdvanced&&!['complete','failed'].includes(input.state)))throw new IntakeFault('INTERNAL');
  let pending;
  if(input.pending!==undefined){
    const p=row(input.pending);exact(p,['attempted','created','existing','reviewNeeded','deferred','state','code']);
    if(!['complete','deferred','failed'].includes(String(p.state))||['attempted','created','existing','reviewNeeded','deferred'].some(k=>!Number.isSafeInteger(p[k])||Number(p[k])<0||Number(p[k])>PENDING_LIMITS.maxTickets)||Number(p.created)+Number(p.existing)+Number(p.reviewNeeded)+Number(p.deferred)!==p.attempted||!input.watermarkAdvanced)throw new IntakeFault('INTERNAL');
    if(p.code!==undefined&&!['SOURCE_UNAVAILABLE','SOURCE_INVALID','BATCH_LIMIT','WRITE_UNAVAILABLE','RECEIPT_INVALID','DEADLINE','CONFIGURATION','INTERNAL'].includes(String(p.code)))throw new IntakeFault('INTERNAL');
    pending={attempted:p.attempted,created:p.created,existing:p.existing,reviewNeeded:p.reviewNeeded,deferred:p.deferred,state:p.state,...(p.code?{code:p.code}:{})};
  }
  const code=input.code;if(code!==undefined&&!['SOURCE_UNAVAILABLE','SOURCE_INVALID','BATCH_LIMIT','WRITE_UNAVAILABLE','RECEIPT_INVALID','DEADLINE','CONFIGURATION','INTERNAL'].includes(code))throw new IntakeFault('INTERNAL');
  return {contract:INTAKE_CONTRACT,state:input.state,...counts,watermarkAdvanced:input.watermarkAdvanced,...(input.completionUncertain===true?{completionUncertain:true}:{}),...(code?{code}:{}),...(pending?{pending}:{})};
}
export function createLegacyIntakeHandler(options:{authenticate:(req:Request)=>Promise<boolean>|boolean;run:(req:Request)=>Promise<RunResult>}){
  return async(req:Request)=>{
    if(!await authenticated(req,options.authenticate))return response({error:'Forbidden'},403);
    try{const input=await requestBody(req);exact(input,['action']);if(input.action!=='run')throw Error();}catch{return response({error:'Invalid intake request'},400);}
    try{return response(projectRunResult(await options.run(req)));}catch{return response({error:'Intake unavailable',code:'INTERNAL'},503);}
  };
}
/** Operational detail is returned ONLY server-to-server, never through pg_net or the Owner preview. */
export function createNativeIntakeSourceHandler(options:{authenticate:(req:Request)=>Promise<boolean>|boolean;read:(window:Window,req:Request,signal:AbortSignal)=>Promise<unknown>;refresh?:(leaseId:string,req:Request,signal:AbortSignal)=>Promise<{scope:unknown;batch:unknown}>}){
  return async(req:Request)=>{
    if(!await authenticated(req,options.authenticate))return response({error:'Forbidden'},403);
    let window:Window|undefined,leaseId:string|undefined;
    try{const input=await requestBody(req);if(input.action==='ticket_refresh'){exact(input,['action','leaseId']);leaseId=leaseIdentity(input.leaseId);}else{exact(input,['action','createdAfter','createdBefore']);if(input.action!=='ticket_batch')throw Error();window={createdAfter:utc(input.createdAfter),createdBefore:utc(input.createdBefore)};}}catch{return response({error:'Invalid intake request'},400);}
    try{
      const signal=AbortSignal.any([req.signal,AbortSignal.timeout(INTAKE_LIMITS.deadlineMs-2000)]);
      if(leaseId){if(!options.refresh)throw new IntakeFault('CONFIGURATION');const refreshed=await deadline(()=>options.refresh!(leaseId!,req,signal),signal);const scope=parsePendingScope(refreshed.scope);if(scope.leaseId!==leaseId)throw new IntakeFault('SOURCE_INVALID');return response(validatePendingBatch(refreshed.batch,scope));}
      if(!window)throw new IntakeFault('SOURCE_INVALID');
      const selected=window;const value=row(await deadline(()=>options.read(selected,req,signal),signal));identity(value.portalId);
      if(typeof value.schemaContract!=='string')throw new IntakeFault('SOURCE_INVALID');
      const projected=validateBatch(value,{state:'leased',leaseId:'',portalId:value.portalId as string,schemaContract:value.schemaContract,activationFloor:new Date(Date.parse(window.createdAfter)+1).toISOString(),leaseUntil:window.createdBefore,...window});
      return response(projected);
    }catch(error){const failure=error instanceof IntakeFault?error:new IntakeFault('INTERNAL');return response({code:failure.code,retryable:failure.retryable,...(failure.retryAfterSeconds!==undefined?{retryAfterSeconds:failure.retryAfterSeconds}:{})},503);}
  };
}
