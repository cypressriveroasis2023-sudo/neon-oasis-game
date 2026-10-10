import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createCameraMhelpTicketIntakeHandler} from './index.ts';
import {verifyLegacyOwner} from './authorization.ts';
import {runMhelpIntake} from '../../../operations/intake/mhelpIntakeRuntime.ts';
import {createExistingServiceRpc,createExistingCredentialSourceRead,createExistingCredentialPendingRead} from '../../../operations/intake/mhelpIntakeTransport.ts';
const LEGACY='https://goqrnolcvqnirjmzaeyk.supabase.co';
Deno.serve(async(req:Request)=>{
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(Deno.env.get('SUPABASE_URL')!==LEGACY||!key)return new Response(JSON.stringify({error:'Intake unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  // Each request keeps its own AbortSignal. The existing SDK client retains the service identity;
  // the verified user's JWT is used ONLY for getUser(), never as a service-client global header.
  const db=createClient(LEGACY,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init={})=>fetch(input,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.any([req.signal,AbortSignal.timeout(10000),...(init.signal?[init.signal]:[])])})}});
  const rpc=createExistingServiceRpc(db);
  return createCameraMhelpTicketIntakeHandler({
    verifyCron:async(candidate,signal)=>{const {data,error}=await db.rpc('verify_camera_health_cron_secret',{candidate}).abortSignal(signal);return !error&&data===true;},
    verifyOwner:(authorization,signal)=>verifyLegacyOwner(db,authorization,signal),
    run:request=>runMhelpIntake({enabled:true,rpc,readSource:createExistingCredentialSourceRead({projectUrl:LEGACY,request,fetch}),readPending:createExistingCredentialPendingRead({projectUrl:LEGACY,request,fetch})}),
    review:signal=>rpc({action:'review_status'},signal),
    pendingStatus:signal=>rpc({action:'pending_status'},signal),
  })(req);
});
