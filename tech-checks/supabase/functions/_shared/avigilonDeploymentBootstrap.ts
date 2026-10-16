import {createAvigilonProductionCandidate} from './avigilonProductionCandidate.ts';
import {createAvigilonEndpointCheck} from './avigilonEndpointCheck.ts';
import {currentAdmittedEndpoint,createBoundedAvigilonTcp,type Connect} from './avigilonEndpointRuntime.ts';
import {configureReviewedAvigilonRuntime} from './avigilonReviewedRuntime.ts';
import type {Actor} from './avigilonCheckRun.ts';
type Bindings={actor:Actor;platformUrl:string;serviceKey:string;legacyUrl:string;legacyServiceKey:string;fetch?:typeof fetch;background:(work:Promise<void>)=>void;connect:Connect};
type Options={enabled:false}|({enabled:true;bindings:Bindings});
/** Explicit server-code gate. No environment flag, request body, or browser
 * input can activate this. Existing reviewed bindings are supplied only after
 * coordinated schema, permission and deployment review. Invalid enabled config
 * throws; it never returns an unconfigured legacy fallback. */
export function createReviewedAvigilonDeployment(options:Options){
 if(options?.enabled===false)return undefined;
 if(options?.enabled!==true)throw Error('Explicit reviewed deployment gate required');
 const b=options.bindings,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!b||!uuid.test(b.actor?.actorId)||!uuid.test(b.actor?.tenantId)||b.actor.canCheck!==true||typeof b.background!=='function'||typeof b.connect!=='function')throw Error('Reviewed deployment bindings unavailable');
 if(b.actor.tenantId!=='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'||new URL(b.platformUrl).origin!=='https://tughscoxralhofrckvxy.supabase.co')throw Error('Reviewed native project or organization mismatch');
 const tcp=createBoundedAvigilonTcp(b.connect);
 let deployment:ReturnType<typeof createAvigilonProductionCandidate>;
 const probe=createAvigilonEndpointCheck({tcp,read:async(actor,id)=>{
  if(!deployment||actor.tenantId!==b.actor.tenantId||actor.canCheck!==true)throw Error('Current endpoint unavailable');
  return currentAdmittedEndpoint(await deployment.checks.readHealth(actor),actor,id);
 }});
 deployment=createAvigilonProductionCandidate({...b,enabled:true,probe});
 if(!deployment)throw Error('Reviewed deployment unavailable');
 configureReviewedAvigilonRuntime(deployment);
 return deployment;
}
