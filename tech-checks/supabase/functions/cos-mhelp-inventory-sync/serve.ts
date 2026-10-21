import {createInventoryComparisonHandler} from './index.ts';
import {createMhelpPartnerHandler} from '../cos-operations-pages/mhelpPartner.ts';
import {nativeMhelpTokens} from '../cos-operations-pages/mhelpTokenRuntime.ts';
import {readInventorySource} from './source.ts';
import {createInventoryCache} from './cache.ts';
const NATIVE='https://tughscoxralhofrckvxy.supabase.co';
const tokens=nativeMhelpTokens(name=>Deno.env.get(name));
const partner=createMhelpPartnerHandler({fetch:tokens.fetch,getConfig:tokens.getPartnerConfig,renewAccess:tokens.renewAccess,readNativeUnits:async()=>[],fullEquipmentReview:true});
async function json(response:Response,max=2097152){
 if(!response.ok||!response.body||Number(response.headers.get('content-length'))>max)throw Error('Read unavailable');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
 try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>max)throw Error('Read unavailable');raw+=decoder.decode(r.value,{stream:true});}return JSON.parse(raw+decoder.decode());}finally{void reader.cancel().catch(()=>{});}
}
async function session(action:string,payload:unknown={}){const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!key||Deno.env.get('SUPABASE_URL')!==NATIVE)throw Error('Backend unavailable');return json(await fetch(NATIVE+'/rest/v1/rpc/cos_mhelp_live_inventory_session',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_payload:payload}),redirect:'error',signal:AbortSignal.timeout(35000)}),16384);}
async function readLease(action:string,lease:string|null=null){const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!key||Deno.env.get('SUPABASE_URL')!==NATIVE)throw Error('Backend unavailable');return json(await fetch(NATIVE+'/rest/v1/rpc/cos_mhelp_inventory_read_lease',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_lease:lease}),redirect:'error',signal:AbortSignal.timeout(10000)}),4096);}
Deno.serve(createInventoryComparisonHandler({authenticate:async req=>{
 if(Deno.env.get('SUPABASE_URL')!==NATIVE)return false;
 const secret=req.headers.get('x-camera-cron-secret');if(!secret||secret.length>1024||/\s/.test(secret))return false;
 const v=await json(await fetch('https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':secret},body:'{"action":"authenticate"}',redirect:'error',signal:AbortSignal.timeout(10000)}),128);
 return v?.authenticated===true&&Object.keys(v).length===1;
},acquireRead:()=>readLease('acquire'),releaseRead:lease=>readLease('release',lease),readEquipment:()=>partner('/api/mhelpdesk/partner/preview','POST',{}),readBaseline:async()=>{
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!key)throw Error('Read unavailable');
 return json(await fetch(NATIVE+'/rest/v1/rpc/cos_mhelp_inventory_baseline',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)}));
},readSource:async(review,baseline)=>{
 const config=await tokens.getPartnerConfig();if(config.portalId!=='224643'||!config.accessToken)throw Error('Source unavailable');const deadline=AbortSignal.timeout(125000);
 const cache=createInventoryCache({cache:async(action,key,payload=null,observedAt?:string)=>{const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!service||Deno.env.get('SUPABASE_URL')!==NATIVE)throw Error('Cache unavailable');return json(await fetch(NATIVE+'/rest/v1/rpc/cos_mhelp_inventory_cache',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_key:key,p_payload:payload,p_observed_at:observedAt}),redirect:'error',signal:AbortSignal.timeout(10000)}),1100000);},read:async path=>{const r=await tokens.fetch('https://connect.mhelpdesk.com/api/v1.0/portal/224643'+path,{headers:{Authorization:'Bearer '+config.accessToken,Accept:'application/json'},redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(12000)])});if(!r.ok){void r.body?.cancel();throw Error('source_http_'+r.status+'_'+(path.startsWith('/equipmentTypes')?'equipment_categories':path.includes('/servicelocations')?'service_locations':'customers'));}return json(r,1048576);}});
 return readInventorySource({review,baseline,read:cache.read,observedAt:cache.observedAt,readStats:cache.stats,verifyEquipment:()=>partner('/api/mhelpdesk/partner/preview','POST',{})});
},writeSource:(action,source,baseline)=>session(action,{portalId:source.portalId,complete:source.complete,records:source.records,readAt:source.readAt,baselineSourceSha256:baseline.sourceSha256}),status:()=>session('status'),recordFailure:code=>session('fail',{errorCode:code})}));
