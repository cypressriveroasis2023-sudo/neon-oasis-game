import {createMhelpReadinessHandler,TicketReadinessError} from './index.ts';
import {createMhelpPartnerHandler} from '../cos-operations-pages/mhelpPartner.ts';
import {createMhelpTicketReader,projectMhelpTicketPreview,MhelpTicketError} from '../cos-operations-pages/mhelpTickets.ts';
import {nativeMhelpTokens} from '../cos-operations-pages/mhelpTokenRuntime.ts';
const NATIVE = 'https://tughscoxralhofrckvxy.supabase.co';
const ORGANIZATION = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
// Existing camera-cron authorization is verified by its original project; no credential is copied or created.
const tokens=nativeMhelpTokens(name=>Deno.env.get(name));
const getConfig=tokens.getPartnerConfig;
const tickets=createMhelpTicketReader({fetch,getConfig,renewAccess:tokens.renewAccess});
const readNativeUnits=async()=>{
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
};
const partner = createMhelpPartnerHandler({fetch,getConfig,readNativeUnits,renewAccess:tokens.renewAccess});
const fullPartner = createMhelpPartnerHandler({fetch,getConfig,readNativeUnits,fullEquipmentReview:true,renewAccess:tokens.renewAccess});
const configured=(name:string)=>{const value=Deno.env.get(name);return !!value && value.length<=16384 && !/\s/.test(value)};
Deno.serve(createMhelpReadinessHandler({authenticate:async req=>{
  if (Deno.env.get('SUPABASE_URL')!==NATIVE) return false;
  const candidate=req.headers.get('x-camera-cron-secret');
  if (!candidate || candidate.length>1024 || /\s/.test(candidate)) return false;
  const response=await fetch('https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':candidate},body:JSON.stringify({action:'authenticate'}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if (!response.ok) return false;
  const raw=await response.text(); if (raw.length>128) return false;
  const v=JSON.parse(raw); return v && typeof v==='object' && Object.keys(v).length===1 && v.authenticated===true;
},partner,ticketPreview:async window=>{try{return projectMhelpTicketPreview(await tickets.preview(window));}catch(error){if(error instanceof MhelpTicketError)throw new TicketReadinessError(error.message,error.status,error.provider);throw error;}},fullReview:()=>fullPartner('/api/mhelpdesk/partner/preview','POST',{}),renewAccess:tokens.renewAccess,renewalConfiguration:()=>({refreshTokenConfigured:configured('COS_MHELP_REFRESH_TOKEN'),clientIdConfigured:configured('COS_MHELP_CLIENT_ID'),clientSecretConfigured:configured('COS_MHELP_CLIENT_SECRET')})}));
