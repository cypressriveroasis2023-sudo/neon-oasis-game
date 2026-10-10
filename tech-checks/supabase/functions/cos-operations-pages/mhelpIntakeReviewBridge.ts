import {projectIntakeReview} from './mhelpIntakeReview.ts';
const LEGACY='https://goqrnolcvqnirjmzaeyk.supabase.co';
const PUBLISHABLE='sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
export class MhelpIntakeReviewError extends Error {
  readonly status:number;
  constructor(status=503){super(status===403?'Your Owner session could not be verified.':'The saved mHelp intake status could not be verified.');this.status=status;}
}
/** Existing genuine legacy Owner session only. No service key or caller-selected target. */
export function createMhelpIntakeReviewBridge(fetcher:typeof fetch){
  return async(authorization:string,requestSignal?:AbortSignal)=>{
    if(!/^Bearer [^\s]+$/i.test(authorization)||authorization.length>8192)throw new MhelpIntakeReviewError(403);
    const signal=AbortSignal.any([AbortSignal.timeout(12000),...(requestSignal?[requestSignal]:[])]);
    let response:Response;
    try{response=await fetcher(LEGACY+'/functions/v1/camera-mhelp-ticket-intake',{method:'POST',headers:{Authorization:authorization,apikey:PUBLISHABLE,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({action:'review_status'}),redirect:'error',cache:'no-store',signal});}
    catch{throw new MhelpIntakeReviewError();}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw new MhelpIntakeReviewError([401,403].includes(response.status)?403:503);}
    if(!response.body||Number(response.headers.get('Content-Length'))>65536){await response.body?.cancel().catch(()=>{});throw new MhelpIntakeReviewError();}
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
    const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
    try{while(true){if(signal.aborted)throw Error();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error();raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();if(signal.aborted)throw Error();return projectIntakeReview(JSON.parse(raw));}
    catch{throw new MhelpIntakeReviewError();}
    finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
  };
}
