import {createMhelpReadinessHandler,validReadKey} from './index.ts';
import {createMhelpPartnerHandler} from '../cos-operations-pages/mhelpPartner.ts';
const NATIVE = 'https://tughscoxralhofrckvxy.supabase.co';
const ORGANIZATION = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
// Reuse the existing server-to-server source-read credential. No user grant or new credential.
const partner = createMhelpPartnerHandler({fetch,getConfig:()=>({accessToken:Deno.env.get('COS_MHELP_ACCESS_TOKEN'),portalId:Deno.env.get('COS_MHELP_PORTAL_ID')}),readNativeUnits:async()=>{
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (Deno.env.get('SUPABASE_URL') !== NATIVE || !service) throw Error('Backend unavailable');
  const rows: any[] = [];
  for (let offset=0;offset<10000;offset+=1000) {
    const response = await fetch(NATIVE+'/rest/v1/equipment_units?select=id,unit_number,partner:metadata->mhelpdeskPartner&organization_id=eq.'+ORGANIZATION+'&order=id.asc&limit=1000&offset='+offset,{headers:{apikey:service,Authorization:'Bearer '+service,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('Backend unavailable');
    const text = await response.text(); if (new TextEncoder().encode(text).byteLength > 1048576) throw Error('Backend unavailable');
    const page = JSON.parse(text); if (!Array.isArray(page) || page.length>1000) throw Error('Backend unavailable');
    rows.push(...page.map(r=>({id:r.id,unit_number:r.unit_number,metadata:{mhelpdeskPartner:r.partner}})));
    if (page.length<1000) return rows;
  }
  throw Error('Backend unavailable');
}});
Deno.serve(createMhelpReadinessHandler({authenticate:req=>Deno.env.get('SUPABASE_URL')===NATIVE && validReadKey(Deno.env.get('COS_GEOCODE_SOURCE_READ_KEY'),req.headers.get('x-cos-mhelp-read-key')),partner}));
