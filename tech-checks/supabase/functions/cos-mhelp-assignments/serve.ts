import {createAssignmentHandler,projectCustomer} from './index.ts';
import {createMhelpPartnerHandler} from '../cos-operations-pages/mhelpPartner.ts';
import {nativeMhelpTokens} from '../cos-operations-pages/mhelpTokenRuntime.ts';
const NATIVE='https://tughscoxralhofrckvxy.supabase.co';
const tokens=nativeMhelpTokens(name=>Deno.env.get(name));
const partner=createMhelpPartnerHandler({fetch,getConfig:tokens.getPartnerConfig,renewAccess:tokens.renewAccess,readNativeUnits:async()=>[],fullEquipmentReview:true});
async function boundedJson(response:Response){
 if(!response.ok||!response.body)throw Error('Provider unavailable');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)throw Error('Oversized provider response');raw+=decoder.decode(value,{stream:true});}return JSON.parse(raw+decoder.decode());}finally{await reader.cancel().catch(()=>{});}
}
Deno.serve(createAssignmentHandler({authenticate:async req=>{
 if(Deno.env.get('SUPABASE_URL')!==NATIVE)return false;
 const candidate=req.headers.get('x-camera-cron-secret');if(!candidate||candidate.length>1024||/\s/.test(candidate))return false;
 const response=await fetch('https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':candidate},body:'{"action":"authenticate"}',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)return false;const raw=await response.text();if(raw.length>128)return false;const v=JSON.parse(raw);return v&&Object.keys(v).length===1&&v.authenticated===true;
},equipment:()=>partner('/api/mhelpdesk/partner/preview','POST',{}),customers:async ids=>{
 const config=await tokens.getPartnerConfig();if(!config.accessToken||!config.portalId||!/^224643$/.test(config.portalId))throw Error('Account unavailable');
 const results:any[]=[];let next=0;
 await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{while(next<ids.length){const id=ids[next++];const response=await fetch('https://connect.mhelpdesk.com/api/v1.0/portal/'+config.portalId+'/customers/'+id+'?fields=customerId,portalId,name,isServiceLocation',{headers:{Authorization:'Bearer '+config.accessToken,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});results.push(projectCustomer(await boundedJson(response),id,config.portalId));}}));
 return results.sort((a,b)=>Number(a.customerId)-Number(b.customerId));
}}));
