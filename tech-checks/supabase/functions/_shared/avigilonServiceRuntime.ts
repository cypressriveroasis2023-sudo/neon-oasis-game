import {durableAvigilonRunStore} from './avigilonRunStore.ts';
import type {Actor,Endpoint,ProbeResult} from './avigilonCheckRun.ts';
type Options={enabled?:boolean;platformUrl:string;serviceKey:string;fetch?:typeof fetch;probe:(actor:Actor,endpoint:Endpoint,signal:AbortSignal)=>Promise<ProbeResult>;background:(work:Promise<void>)=>void};
const names={claim:'cos_avigilon_run_claim',read_run:'cos_avigilon_run_read',save:'cos_avigilon_run_save'} as const;
/** Server-only adapter. Not configured by serve.ts. Enabling requires reviewed
 * boundary installation AND a compatible guarded checker. Never accept URL/key,
 * actor, tenant, procedure or endpoint configuration from the request body. */
export function createAvigilonServiceRuntime(options:Options){
 if(options.enabled!==true)return undefined;
 const base=new URL(options.platformUrl);if(base.protocol!=='https:'||base.username||base.password||!options.serviceKey||!options.probe||!options.background)throw Error('Reviewed check runtime unavailable');
 const fetcher=options.fetch||fetch;
 return {background:options.background,probe:options.probe,
  store:(actor:Actor)=>durableAvigilonRunStore(actor,async(operation,args)=>{
   const [p_actor_user_id,p_organization_id,value]=args;
   const payload={p_actor_user_id,p_organization_id,...(operation==='read_run'?{p_run_id:value}:{p_run:value})};
   const response=await fetcher(new URL('/rest/v1/rpc/'+names[operation],base),{method:'POST',headers:{apikey:options.serviceKey,Authorization:'Bearer '+options.serviceKey,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Durable check state unavailable');
   let result:unknown;try{result=await response.json();}catch{throw Error('Durable check state unavailable');}
   if(operation==='save'){if(typeof result!=='boolean')throw Error('Invalid durable save receipt');}
   else if(operation==='claim'){if(!result||typeof result!=='object'||typeof (result as any).claimed!=='boolean'||!(result as any).run)throw Error('Invalid durable claim receipt');}
   // Scope validation is repeated even if an upstream route is misconfigured.
   const run=operation==='claim'?(result as any).run:operation==='read_run'?result:null;
   if(run&&(typeof run!=='object'||(run as any).tenantId!==actor.tenantId))throw Error('Run tenant mismatch');
   return result;
  })};
}
