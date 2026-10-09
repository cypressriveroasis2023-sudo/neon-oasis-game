import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createCameraMhelpReadinessHandler} from './index.ts';
const LEGACY='https://goqrnolcvqnirjmzaeyk.supabase.co';
Deno.serve(createCameraMhelpReadinessHandler({
  verifyCron:async candidate=>{
    if (Deno.env.get('SUPABASE_URL')!==LEGACY || !candidate) return false;
    const db=createClient(LEGACY,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{global:{fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});
    const {data,error}=await db.rpc('verify_camera_health_cron_secret',{candidate});return !error && data===true;
  },
}));
