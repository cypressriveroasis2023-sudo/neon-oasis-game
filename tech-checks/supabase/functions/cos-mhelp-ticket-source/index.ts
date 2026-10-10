import {nativeMhelpTokens} from '../cos-operations-pages/mhelpTokenRuntime.ts';
import {createNativeIntakeSourceHandler,readBoundedJson,fetchBounded,cancelBody} from '../../../operations/intake/mhelpIntakeHandlers.ts';
import {createBoundedMhelpSource,createBoundedPendingSource,productionAdapterFor} from '../../../operations/intake/mhelpIntakeSource.ts';
import {createExistingCredentialPolicyRead,createExistingCredentialPendingScopeRead} from '../../../operations/intake/mhelpIntakeTransport.ts';
import {createNativeMhelpTicketAccess} from '../../../operations/intake/mhelpIntakeTokenAccess.ts';
import {deadline} from '../../../operations/intake/mhelpIntakeRuntime.ts';
const NATIVE='https://tughscoxralhofrckvxy.supabase.co';
export function createProtectedNativeIntakeSource(options:{env:(name:string)=>string|undefined;fetch:typeof fetch;tokens?:ReturnType<typeof nativeMhelpTokens>}){
  const tokens=options.tokens??nativeMhelpTokens(options.env,options.fetch);
  const access=createNativeMhelpTicketAccess({...options,tokens});
  return createNativeIntakeSourceHandler({
    authenticate:async req=>{
      if(options.env('SUPABASE_URL')!==NATIVE||req.headers.has('origin')||req.headers.has('authorization'))return false;
      const candidate=req.headers.get('x-camera-cron-secret');if(!candidate||candidate.length>1024||/\s/.test(candidate))return false;
      const signal=AbortSignal.any([req.signal,AbortSignal.timeout(10000)]);
      return deadline(async()=>{
        const response=await fetchBounded(options.fetch,'https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':candidate},body:JSON.stringify({action:'authenticate'}),redirect:'error',cache:'no-store',signal},signal);
        if(!response.ok){cancelBody(response.body);return false;}
        const value=await readBoundedJson(response.body,128,signal);return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&(value as {authenticated?:unknown}).authenticated===true;
      },signal);
    },
    refresh:(leaseId,req,signal)=>createBoundedPendingSource({
      getScope:createExistingCredentialPendingScopeRead({projectUrl:NATIVE,request:req,fetch:options.fetch}),
      getPolicy:createExistingCredentialPolicyRead({projectUrl:NATIVE,request:req,fetch:options.fetch}),
      // Deliberately unregistered until actual ticket/appointment semantics are verified.
      adapterFor:()=>null,
    })(leaseId,signal),
    read:(window,req,signal)=>createBoundedMhelpSource({
      getPolicy:createExistingCredentialPolicyRead({projectUrl:NATIVE,request:req,fetch:options.fetch}),
      // Original token-managed access is wired, but no approved production mapper exists.
      adapterFor:policy=>productionAdapterFor(policy,access),
    })(window,signal),
  });
}
