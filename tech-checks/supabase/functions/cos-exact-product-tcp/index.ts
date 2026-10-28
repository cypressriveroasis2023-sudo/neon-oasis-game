import {boundedRequest} from '../_shared/scheduledDirectService.ts';
import {createSavedTcpProbe,type TcpConnect} from '../_shared/exact-product-producer/tcpProbe.ts';
import {collectProductGroups,readProductGroupStatuses} from '../_shared/exact-product-producer/groupCollector.ts';
import type {ReceiptRpc} from '../_shared/exact-product-producer/receiptAdapter.ts';
type BoundContext={readGroups:import('../_shared/exact-product-producer/groupCollector.ts').GroupRuntime['readGroups'];receiptRpc:ReceiptRpc;connect:TcpConnect;canProbe:boolean};
/** Mount only inside an existing authenticated server context after approval.
 * The binder must reuse existing authorization/actor resolution and privileged
 * clients; there is no role, credential, actor ID or endpoint in the body.
 * Not an added public grant or an authorization implementation. */
export function createProductTcpHandler(options:{enabled?:boolean;bindExistingContext?:(request:Request)=>Promise<BoundContext|null>;now?:()=>number}={}){
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 return async(request:Request)=>{
  if(options.enabled!==true||!options.bindExistingContext)return reply({error:'Exact Product-ID TCP extension is disabled.'},503);
  if(request.method!=='POST'||new URL(request.url).search)return reply({error:'Bounded POST required.'},405);
  let context:BoundContext|null;
  try{context=await boundedRequest(()=>options.bindExistingContext!(request),Date.now()+4000);}catch{return reply({error:'Unauthorized.'},403);}
  if(!context)return reply({error:'Unauthorized.'},403);
  let body:any;
  try{
   if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();
   const reader=request.body?.getReader();if(!reader)throw Error();let bytes=0,text='';const decoder=new TextDecoder(),bodyDeadline=Date.now()+4000;
   try{for(;;){const next=await boundedRequest(()=>reader.read(),bodyDeadline);if(next.done)break;bytes+=next.value.length;if(bytes>2048)throw Error();text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();}finally{void reader.cancel().catch(()=>{});}
   body=JSON.parse(text);
   const keys=body.action==='run'?['action','productIds','runId']:['action','productIds'];
   if(!body||typeof body!=='object'||Array.isArray(body)||!['run','read'].includes(body.action)||Object.keys(body).length!==keys.length||Object.keys(body).some(k=>!keys.includes(k)))throw Error();
   if(body.action==='run'&&!context.canProbe)return reply({error:'Existing probe authorization required.'},403);
  }catch{return reply({error:'Invalid bounded request.'},400);}
  const now=options.now??Date.now;
  if(!context.readGroups)return reply({error:'Protected source context unavailable.'},503);
  const runtime={readGroups:context.readGroups,rpc:context.receiptRpc,probe:createSavedTcpProbe(context.connect)};
  try{return reply(body.action==='run'?await collectProductGroups(runtime,body.productIds,body.runId,now):{items:await readProductGroupStatuses(runtime,body.productIds,now,undefined,request.signal)});}
  catch{return reply({error:'Current complete source or receipt unavailable.'},409);}
 };
}
