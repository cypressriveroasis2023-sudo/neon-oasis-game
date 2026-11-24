import {read2027ProductIpsFromGoogle} from '../../cos-operations-pages/mhelp2027ProductIpReader.ts';
import type {SheetsAssertionSigner} from '../../cos-operations-pages/googleSheets.ts';
import type {ProtectedSourceIO} from './sourceReader.ts';
/** Concrete bridge for an ALREADY authorized existing server request context.
 * Actor resolution and credential loading stay in their existing owner. No
 * role-switching, header invention, private-table reads or new token exchange
 * code is introduced. Nothing happens until the enabled handler invokes it. */
export function existingNativeProductSourceContext(options:{
 source:Omit<ProtectedSourceIO,'tracker'>;
 googleSheets:{getServiceAccountJson:()=>unknown;signAssertion:SheetsAssertionSigner;fetch:typeof fetch};
 now?:()=>number;
}){
 const source:ProtectedSourceIO={...options.source,tracker:async(candidate,sourceSha256,signal)=>{
  const requestFetch:typeof fetch=async(input,init={})=>{
   if(signal.aborted)throw Error('Source cancelled');
   const controller=new AbortController(),abort=()=>controller.abort();
   signal.addEventListener('abort',abort,{once:true});init.signal?.addEventListener('abort',abort,{once:true});
   if(init.signal?.aborted)controller.abort();
   try{return await options.googleSheets.fetch(input,{...init,signal:controller.signal});}
   finally{signal.removeEventListener('abort',abort);init.signal?.removeEventListener('abort',abort);}
  };
  return await read2027ProductIpsFromGoogle({...options.googleSheets,fetch:requestFetch,candidate,expectedMhelpSourceSha256:sourceSha256,now:options.now});
 }};
 return source;
}
