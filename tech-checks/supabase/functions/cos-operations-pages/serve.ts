import {createOperationsHandler} from './index.ts';
Deno.serve(createOperationsHandler({
  platformUrl:Deno.env.get('SUPABASE_URL'),
  serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
}));
