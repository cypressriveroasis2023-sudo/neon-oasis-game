import {createOperationsHandler} from './index.ts';
import {nativeMhelpTokens} from './mhelpTokenRuntime.ts';
import {signSheetsAssertion} from './googleSheetsRuntime.ts';
const mhelpTokens=nativeMhelpTokens(name=>Deno.env.get(name));
Deno.serve(createOperationsHandler({
  platformUrl:Deno.env.get('SUPABASE_URL'),
  serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  vrmEmbeds:Deno.env.get('COS_VRM_EMBEDS'),
  vrm: { getAccessToken: () => Deno.env.get('COS_VRM_ACCESS_TOKEN') },
  inhandPilot: { enabled: true, contractReviewed: true, getAccessToken: () => Deno.env.get('COS_INHAND_PILOT_ACCESS_TOKEN') },
  mhelpPartner: { getConfig:mhelpTokens.getPartnerConfig,renewAccess:mhelpTokens.renewAccess },
  mhelpReconnect:mhelpTokens.reconnect,
  googleSheets: { getServiceAccountJson:()=>Deno.env.get('COS_GOOGLE_SERVICE_ACCOUNT_JSON'),signAssertion:signSheetsAssertion },
}));

