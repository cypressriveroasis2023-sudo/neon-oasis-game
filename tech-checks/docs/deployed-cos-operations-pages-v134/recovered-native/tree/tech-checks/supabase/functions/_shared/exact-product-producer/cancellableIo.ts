import {boundedRequest} from '../scheduledDirectService.ts';
/** Races even transports which ignore abort. Late results cannot advance work.
 * A canceled mutation may have committed: callers must reconcile, never retry. */
export function cancellableIo(deadline:number,now:()=>number,parent?:AbortSignal){
 const started=now();
 const check=()=>{if(parent?.aborted)throw Error('Request cancelled');if(now()<started||now()>=deadline)throw Error('Request deadline');};
 const request=async<T>(fn:(signal:AbortSignal)=>PromiseLike<T>,timeout=4000):Promise<T>=>{
  check();
  return boundedRequest(async timeoutSignal=>{
   const controller=new AbortController();let cancel!:()=>void;
   const aborted=new Promise<T>((_,reject)=>{cancel=()=>{controller.abort();reject(Error('Request cancelled'));};});
   parent?.addEventListener('abort',cancel,{once:true});timeoutSignal.addEventListener('abort',cancel,{once:true});
   try{check();if(timeoutSignal.aborted)throw Error('Request deadline');const value=await Promise.race([Promise.resolve(fn(controller.signal)),aborted]);check();return value;}
   finally{parent?.removeEventListener('abort',cancel);timeoutSignal.removeEventListener('abort',cancel);controller.abort();}
  },deadline,now,timeout);
 };
 return {check,request};
}
