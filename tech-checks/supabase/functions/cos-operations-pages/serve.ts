import {createOperationsHandler} from './index.ts';
Deno.serve(createOperationsHandler({
  platformUrl:Deno.env.get('SUPABASE_URL'),
  serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  vrmEmbeds:Deno.env.get('COS_VRM_EMBEDS'),
  inhandPilot: { enabled: true, contractReviewed: true, getAccessToken: () => Deno.env.get('COS_INHAND_PILOT_ACCESS_TOKEN') },
  mhelpPartner: { getConfig: () => ({portalId: Deno.env.get('COS_MHELP_PORTAL_ID'), accessToken: Deno.env.get('COS_MHELP_ACCESS_TOKEN')}) },
}));

