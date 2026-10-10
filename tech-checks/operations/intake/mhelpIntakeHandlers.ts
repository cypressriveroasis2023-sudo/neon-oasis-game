import {INTAKE_CONTRACT,INTAKE_LIMITS,IntakeFault,exact,row,utc,identity,validateBatch,deadline,type RunResult,type Window} from './mhelpIntakeRuntime.ts';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function readBoundedJson(body:ReadableStream<Uint8Array>|null,maxBytes:number,signal?:AbortSignal):Promise<unknown>{
  const reader=body?.getReader();if(!reader)throw new IntakeFault('SOURCE_INVALID');const chunks:Uint8Array[]=[];let size=0;const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  try{while(true){if(signal?.aborted)throw new IntakeFault('DEADLINE',true);const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new IntakeFault('SOURCE_INVALID');chunks.push(value);}}
  finally{signal?.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
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
  if(Object.values(counts).some(n=>!Number.isSafeInteger(n)||n<0||n>INTAKE_LIMITS.maxTickets)||counts.created+counts.existing+counts.reviewNeeded>counts.scanned||typeof input.watermarkAdvanced!=='boolean'||input.watermarkAdvanced!==(input.state==='complete'))throw new IntakeFault('INTERNAL');
  const code=input.code;if(code!==undefined&&!['SOURCE_UNAVAILABLE','SOURCE_INVALID','BATCH_LIMIT','WRITE_UNAVAILABLE','RECEIPT_INVALID','DEADLINE','CONFIGURATION','INTERNAL'].includes(code))throw new IntakeFault('INTERNAL');
  return {contract:INTAKE_CONTRACT,state:input.state,...counts,watermarkAdvanced:input.watermarkAdvanced,...(input.completionUncertain===true?{completionUncertain:true}:{}),...(code?{code}:{})};
}
export function createLegacyIntakeHandler(options:{authenticate:(req:Request)=>Promise<boolean>|boolean;run:(req:Request)=>Promise<RunResult>}){
  return async(req:Request)=>{
    if(!await authenticated(req,options.authenticate))return response({error:'Forbidden'},403);
    try{const input=await requestBody(req);exact(input,['action']);if(input.action!=='run')throw Error();}catch{return response({error:'Invalid intake request'},400);}
    try{return response(projectRunResult(await options.run(req)));}catch{return response({error:'Intake unavailable',code:'INTERNAL'},503);}
  };
}
/** Operational detail is returned ONLY server-to-server, never through pg_net or the Owner preview. */
export function createNativeIntakeSourceHandler(options:{authenticate:(req:Request)=>Promise<boolean>|boolean;read:(window:Window,req:Request,signal:AbortSignal)=>Promise<unknown>}){
  return async(req:Request)=>{
    if(!await authenticated(req,options.authenticate))return response({error:'Forbidden'},403);
    let window:Window;
    try{const input=await requestBody(req);exact(input,['action','createdAfter','createdBefore']);if(input.action!=='ticket_batch')throw Error();window={createdAfter:utc(input.createdAfter),createdBefore:utc(input.createdBefore)};}catch{return response({error:'Invalid intake request'},400);}
    try{
      const signal=AbortSignal.any([req.signal,AbortSignal.timeout(INTAKE_LIMITS.deadlineMs-2000)]);
      const value=row(await deadline(()=>options.read(window,req,signal),signal));identity(value.portalId);
      if(typeof value.schemaContract!=='string')throw new IntakeFault('SOURCE_INVALID');
      const projected=validateBatch(value,{state:'leased',leaseId:'',portalId:value.portalId as string,schemaContract:value.schemaContract,activationFloor:new Date(Date.parse(window.createdAfter)+1).toISOString(),leaseUntil:window.createdBefore,...window});
      return response(projected);
    }catch(error){return response({error:'Intake source unavailable',code:error instanceof IntakeFault?error.code:'INTERNAL'},503);}
  };
}
