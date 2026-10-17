import {createOperationsHandler} from './index.ts';
import {nativeMhelpTokens} from './mhelpTokenRuntime.ts';
import {signSheetsAssertion} from './googleSheetsRuntime.ts';
const mhelpTokens=nativeMhelpTokens(name=>Deno.env.get(name));
Deno.serve(createOperationsHandler({
  fetch:mhelpTokens.fetch,
  platformUrl:Deno.env.get('SUPABASE_URL'),
  serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  ittechNativeActorId:Deno.env.get('COS_ITTECH_NATIVE_ACTOR_ID'),
  vrmEmbeds:Deno.env.get('COS_VRM_EMBEDS'),
  vrm: { getAccessToken: () => Deno.env.get('COS_VRM_ACCESS_TOKEN') },
  inhandPilot: { enabled: true, contractReviewed: true, getAccessToken: () => Deno.env.get('COS_INHAND_PILOT_ACCESS_TOKEN') },
  mhelpPartner: { getConfig:mhelpTokens.getPartnerConfig,renewAccess:mhelpTokens.renewAccess },
  mhelpReconnect:mhelpTokens.reconnect,
  mhelpPlacementEnabled:true,
  handoffLocation:{getSecret:()=>Deno.env.get('COS_HANDOFF_LOCATION_HMAC_V1')},
  googleSheets: { getServiceAccountJson:()=>Deno.env.get('COS_GOOGLE_SERVICE_ACCOUNT_JSON'),signAssertion:signSheetsAssertion },
}));

