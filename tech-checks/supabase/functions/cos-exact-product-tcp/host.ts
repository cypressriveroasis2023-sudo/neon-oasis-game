import {createFleetVerifier} from '../camera-field-geocode/fleetAuthorization.ts';
import {createProductTcpHandler} from './index.ts';
import {existingLegacyProductTcpContext} from '../_shared/exact-product-producer/legacyContextAdapter.ts';
import type {TcpConnect} from '../_shared/exact-product-producer/tcpProbe.ts';
/** Uses the established legacy fleet verifier. Native proof endpoint separately
 * rechecks same-person native role; no service-role source impersonation. */
export function createLegacyProductTcpHost(options:{enabled?:boolean;legacyUrl:string;serviceKey:string;nativeProofUrl:string;nativeOrigin:string;fetch:typeof fetch;connect:TcpConnect}){
 const verify=createFleetVerifier(async(path,init)=>{
  const response=await options.fetch(options.legacyUrl+path,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw Error('Existing fleet authorization unavailable');return await response.json();
 },options.serviceKey);
 return createProductTcpHandler({enabled:options.enabled,bindExistingContext:async request=>{
  if(!await verify(request.headers.get('Authorization')??''))return null;
  const client={rpc:(name:string,args:Record<string,unknown>)=>({abortSignal:async(signal:AbortSignal)=>{
   const response=await options.fetch(options.legacyUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:options.serviceKey,Authorization:'Bearer '+options.serviceKey,'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',cache:'no-store',signal});
   return {data:response.ok?await response.json():null,error:response.ok?null:'receipt_http'};
  }})};
  return existingLegacyProductTcpContext({proofUrl:options.nativeProofUrl,expectedOrigin:options.nativeOrigin,authorization:request.headers.get('Authorization')!,fetch:options.fetch,legacyServiceClient:client,connect:options.connect,canProbe:true});
 }});
}
