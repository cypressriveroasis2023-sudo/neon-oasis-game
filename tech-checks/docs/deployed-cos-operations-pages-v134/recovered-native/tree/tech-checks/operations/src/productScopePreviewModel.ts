import {readConnectionDiagnostic,type ConnectionDiagnostic} from './connectionDiagnostics';
export type ScopeDevice={id:string;ip:string;ports:number[];revision:string;profile:string};
export type ScopeGroup={productId:string;nativeUnitId:string;family:string;verifiedAt:string;devices:ScopeDevice[];authorityGuard:string;sourceSha256:string;trackerSha256:string;identityGuard:string;bindingGuard:string;epochGuard:string;crosswalkRevision:string};
export type ScopePreview={kind:'eligible';group:ScopeGroup}|{kind:'held';reason:string;diagnostic?:ConnectionDiagnostic};
export type PreviewState={status:'idle'|'loading'|'error'|'ready';result?:ScopePreview;message?:string;diagnostic?:ConnectionDiagnostic};
export type PreviewApi={captureSession:()=>()=>boolean;post:(path:string,body:unknown,options:{signal:AbortSignal})=>Promise<{data:unknown}>};
const productIdValid=(id:string)=>/^[1-9][0-9]{0,14}$/.test(id);
const guards=['authorityGuard','sourceSha256','trackerSha256','identityGuard','bindingGuard','epochGuard','crosswalkRevision'] as const;
/** Display only: this response is never authorization for a probe or a status. */
export function readScopePreview(value:unknown,productId:string):ScopePreview{
 const v=value as any;
 if(!productIdValid(productId)||v?.contract!=='COS_PRODUCT_TCP_PREVIEW_V1'||!Array.isArray(v.productIds)||v.productIds.length!==1||v.productIds[0]!==productId||!Array.isArray(v.groups)||!Array.isArray(v.held)||v.groups.length+v.held.length!==1)throw Error('Incomplete exact-product preview.');
 if(v.held.length){const h=v.held[0];if(h?.productId!==productId||typeof h.reason!=='string'||!h.reason.trim()||h.reason.length>2000)throw Error('Invalid hold evidence.');const diagnostic=readConnectionDiagnostic(h.diagnostic);return {kind:'held',reason:h.reason,...(diagnostic?.stage==='product_native_binding'?{diagnostic}:{})};}
 const g=v.groups[0];
 if(g?.productId!==productId||typeof g.nativeUnitId!=='string'||!/^[a-f0-9-]{36}$/i.test(g.nativeUnitId)||typeof g.family!=='string'||!g.family||typeof g.verifiedAt!=='string'||!Number.isFinite(Date.parse(g.verifiedAt))||guards.some(k=>typeof g[k]!=='string'||!/^[a-f0-9]{64}$/.test(g[k]))||!Array.isArray(g.devices)||!g.devices.length||g.devices.length>64)throw Error('Incomplete source scope.');
 const devices:ScopeDevice[]=g.devices.map((d:any)=>{
  if(typeof d?.id!=='string'||!d.id||typeof d.ip!=='string'||!/^\d{1,3}(\.\d{1,3}){3}$/.test(d.ip)||d.ip.split('.').some((n:string)=>Number(n)>255)||typeof d.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(d.revision)||typeof d.profile!=='string'||!d.profile||!Array.isArray(d.ports)||!d.ports.length||d.ports.length>32||d.ports.some((p:unknown)=>!Number.isInteger(p)||Number(p)<1||Number(p)>65535)||new Set(d.ports).size!==d.ports.length)throw Error('Incomplete saved endpoint scope.');
  return {id:d.id,ip:d.ip,ports:[...d.ports],revision:d.revision,profile:d.profile};
 });
 if(new Set(devices.map(d=>d.id)).size!==devices.length)throw Error('Duplicate saved endpoint scope.');
 return {kind:'eligible',group:{productId,nativeUnitId:g.nativeUnitId,family:g.family,verifiedAt:g.verifiedAt,devices,...Object.fromEntries(guards.map(k=>[k,g[k]]))} as ScopeGroup};
}
export function createScopePreview(api:PreviewApi,productId:string,notify:(state:PreviewState)=>void){
 let revision=0,controller:AbortController|null=null,disposed=false;
 const clear=()=>{revision++;controller?.abort();controller=null;if(!disposed)notify({status:'idle'});};
 return {clear,dispose:()=>{disposed=true;clear();},async load(){
  if(disposed||controller||!productIdValid(productId))return;
  const ticket=++revision,currentSession=api.captureSession(),request=new AbortController();controller=request;notify({status:'loading'});
  const current=()=>!disposed&&ticket===revision&&!request.signal.aborted&&currentSession();
  try{const response=await api.post('/api/product-tcp-preview',{productIds:[productId]},{signal:request.signal});if(current())notify({status:'ready',result:readScopePreview(response.data,productId)});}
  catch(cause){if(current())notify({status:'error',message:'Saved scope could not be verified. No camera test was run.',...(readConnectionDiagnostic((cause as any)?.diagnostic)?{diagnostic:readConnectionDiagnostic((cause as any).diagnostic)}:{})});}
  finally{if(ticket===revision){controller=null;if(!disposed&&!currentSession())notify({status:'idle'});}}
 }};
}
