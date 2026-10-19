import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createDepartmentAlertHandler} from './index.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const options={auth:{persistSession:false,autoRefreshToken:false}};
Deno.serve(createDepartmentAlertHandler({
  admin:createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,options),
  env:(name:string)=>Deno.env.get(name),
}));
