import {projectIntakeStatus,PENDING_SCHEDULE_CAPABILITY} from './mhelpIntakeReview.ts';
const LEGACY='https://goqrnolcvqnirjmzaeyk.supabase.co';
const PUBLISHABLE='sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
export class MhelpIntakeReviewError extends Error {
  readonly status:number;
  constructor(status=503){super(status===403?'Your Owner session could not be verified.':'The saved mHelp intake status could not be verified.');this.status=status;}
}
/** Existing genuine legacy Owner session only. No service key or caller-selected target. */
export function createMhelpIntakeReviewBridge(fetcher:typeof fetch){
  return async(authorization:string,requestSignal?:AbortSignal,capability?:typeof PENDING_SCHEDULE_CAPABILITY)=>{
    if(!/^Bearer [^\s]+$/i.test(authorization)||authorization.length>8192)throw new MhelpIntakeReviewError(403);
    if(capability!==undefined&&capability!==PENDING_SCHEDULE_CAPABILITY)throw new MhelpIntakeReviewError();
    const signal=AbortSignal.any([AbortSignal.timeout(12000),...(requestSignal?[requestSignal]:[])]);
    // Bound ignored-abort fetches and body reads; cleanup itself must never extend the deadline.
    const withinDeadline=<T>(start:()=>Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
      const abort=()=>{signal.removeEventListener('abort',abort);reject(new MhelpIntakeReviewError());};
      if(signal.aborted){abort();return;}
      signal.addEventListener('abort',abort,{once:true});
      let pending:Promise<T>;
      try{pending=start();}catch(error){signal.removeEventListener('abort',abort);reject(error);return;}
      pending.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
    const cancel=(stream:{cancel:()=>Promise<unknown>}|null|undefined)=>{try{void stream?.cancel().catch(()=>{});}catch{ /* best-effort only */ }};
    let response:Response;
    try{response=await withinDeadline(async()=>{
      const result=await fetcher(LEGACY+'/functions/v1/camera-mhelp-ticket-intake',{method:'POST',headers:{Authorization:authorization,apikey:PUBLISHABLE,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({action:'review_status',...(capability?{evidenceCapability:capability}:{})}),redirect:'error',cache:'no-store',signal});
      if(signal.aborted){cancel(result.body);throw new MhelpIntakeReviewError();}
      return result;
    });}catch{throw new MhelpIntakeReviewError();}
    if(!response.ok){cancel(response.body);throw new MhelpIntakeReviewError([401,403].includes(response.status)?403:503);}
    if(!response.body||Number(response.headers.get('Content-Length'))>65536){cancel(response.body);throw new MhelpIntakeReviewError();}
    let reader:ReadableStreamDefaultReader<Uint8Array>;
    try{reader=response.body.getReader();}catch{throw new MhelpIntakeReviewError();}
    const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
    try{while(true){if(signal.aborted)throw Error();const {value,done}=await withinDeadline(()=>reader.read());if(done)break;size+=value.byteLength;if(size>65536)throw Error();raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();if(signal.aborted)throw Error();return projectIntakeStatus(JSON.parse(raw),capability);}
    catch{throw new MhelpIntakeReviewError();}
    finally{cancel(reader);try{reader.releaseLock();}catch{ /* never mask a safe result */ }}
  };
}
