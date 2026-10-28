import {createProductProofHandler} from './attestationTransport.ts';
import {existingNativeProductSourceContext} from './nativeContextAdapter.ts';
import {existingLegacyProductTcpContext} from './legacyContextAdapter.ts';
import {createProductTcpHandler} from '../../cos-exact-product-tcp/index.ts';
type NativeContext=Parameters<typeof existingNativeProductSourceContext>[0];
type LegacyContext=Pick<Parameters<typeof existingLegacyProductTcpContext>[0],'legacyServiceClient'|'connect'|'canProbe'>;
/** Runnable route composition for the two EXISTING hosts. Approval supplies only
 * the exact pinned route and existing auth/context binders. This module contains
 * no deployment action, credentials, role creation, schedule or public grant.
 * Leave enabled omitted until both exact runtime closures and SQL are approved. */
export function createExistingContextProductRoutes(options:{
 enabled?:boolean;nativeProofUrl:string;nativeOrigin:string;fetch:typeof fetch;
 bindNative:(request:Request)=>Promise<NativeContext|null>;
 bindLegacy:(request:Request)=>Promise<LegacyContext|null>;
 now?:()=>number;
}){
 return {
  source:createProductProofHandler({enabled:options.enabled,now:options.now,bindExistingContext:async request=>{
   const context=await options.bindNative(request);return context?existingNativeProductSourceContext(context):null;
  }}),
  writer:createProductTcpHandler({enabled:options.enabled,now:options.now,bindExistingContext:async request=>{
   const context=await options.bindLegacy(request);if(!context)return null;
   return existingLegacyProductTcpContext({...context,proofUrl:options.nativeProofUrl,expectedOrigin:options.nativeOrigin,
    authorization:request.headers.get('Authorization')??'',fetch:options.fetch,now:options.now});
  }})
 };
}
