import {readMhelpAddressMapPins} from '../../../operations/src/mhelpAddressMapPins.ts';
/** An address-service failure may hide only its overlay, never the native map. */
export async function withMhelpAddressMap(
 snapshot:Record<string,any>,upload:unknown,
 read:(signal:AbortSignal)=>Promise<unknown>,requestSignal?:AbortSignal,budgetMs=2200
):Promise<Record<string,any>>{
 const unavailable=()=>({...snapshot,mhelpAddressMapStatus:'unavailable'});
 const head=upload as Record<string,any>|null;
 // This release represents the complete reviewed October 16 file. A missing,
 // partial or different-size upload cannot authorize an address snapshot read.
 if(!head||!Array.isArray(head.records)||head.records.length!==1001
  ||!/^[a-f0-9]{64}$/.test(head.sourceSha256)||!/^[a-f0-9]{64}$/.test(head.payloadSha256))return unavailable();
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let cancel=()=>{};
 const stopped=new Promise<null>(resolve=>{cancel=()=>{controller.abort();resolve(null);};timer=setTimeout(cancel,budgetMs);requestSignal?.addEventListener('abort',cancel,{once:true});});
 try{
  if(requestSignal?.aborted)return unavailable();
  const raw=await Promise.race([Promise.resolve().then(()=>read(controller.signal)).catch(()=>null),stopped]);
  if(controller.signal.aborted||!readMhelpAddressMapPins(raw,upload))return unavailable();
  return {...snapshot,mhelpAddressMap:raw};
 }finally{clearTimeout(timer);requestSignal?.removeEventListener('abort',cancel);controller.abort();}
}
