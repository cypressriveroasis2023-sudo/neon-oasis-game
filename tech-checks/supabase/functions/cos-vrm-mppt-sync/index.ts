import {createMpptSyncHandler} from './mppt.ts';
Deno.serve(createMpptSyncHandler({
  platformUrl: Deno.env.get('SUPABASE_URL')!,
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  getAccessToken: () => Deno.env.get('COS_VRM_ACCESS_TOKEN'),
}));
