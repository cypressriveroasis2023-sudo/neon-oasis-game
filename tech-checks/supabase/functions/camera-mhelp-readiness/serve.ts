import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createCameraMhelpReadinessHandler} from './index.ts';
import {createExistingServiceRpc} from '../../../operations/intake/mhelpIntakeTransport.ts';
const LEGACY='https://goqrnolcvqnirjmzaeyk.supabase.co';
Deno.serve(async(req:Request)=>{
  let db:ReturnType<typeof createClient>|undefined;
  const client=()=>{
    if(db)return db;
    const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(Deno.env.get('SUPABASE_URL')!==LEGACY||!key)throw Error('Backend unavailable');
    return db=createClient(LEGACY,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init={})=>fetch(input,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.any([req.signal,AbortSignal.timeout(10000),...(init.signal?[init.signal]:[])])})}});
  };
  return createCameraMhelpReadinessHandler({
    verifyCron:async candidate=>{
      if(!candidate||candidate.length>1024||/\s/.test(candidate))return false;
      const {data,error}=await client().rpc('verify_camera_health_cron_secret',{candidate});return !error&&data===true;
    },
    intakePolicy:signal=>createExistingServiceRpc(client())({action:'policy'},signal),
    pendingScope:(leaseId,signal)=>createExistingServiceRpc(client())({action:'pending_scope',leaseId},signal),
  })(req);
});
