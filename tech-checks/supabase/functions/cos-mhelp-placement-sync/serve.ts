import {createPlacementSyncHandler} from './index.ts';
import {readPlacementCustomer,createCustomerReadDiagnostics,createCustomerReadGate} from './customerRead.ts';
import {createMhelpPartnerHandler} from '../cos-operations-pages/mhelpPartner.ts';
import {nativeMhelpTokens} from '../cos-operations-pages/mhelpTokenRuntime.ts';
const NATIVE='https://tughscoxralhofrckvxy.supabase.co',PORTAL='224643';
const tokens=nativeMhelpTokens(name=>Deno.env.get(name));
const partner=createMhelpPartnerHandler({fetch,getConfig:tokens.getPartnerConfig,renewAccess:tokens.renewAccess,readNativeUnits:async()=>[],fullEquipmentReview:true});
async function json(response:Response,max=262144){
 if(!response.ok||!response.body||Number(response.headers.get('Content-Length'))>max)throw Error('Read unavailable');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
 try{while(true){const v=await reader.read();if(v.done)break;size+=v.value.byteLength;if(size>max)throw Error('Read unavailable');raw+=decoder.decode(v.value,{stream:true});}return JSON.parse(raw+decoder.decode());}
 finally{try{void reader.cancel().catch(()=>{});}catch{}}
}
Deno.serve(async request=>{
// Keep fifteen seconds inside the existing scheduler's 120-second timeout for the final RPC.
const deadline=AbortSignal.timeout(105000);
const diagnostics=createCustomerReadDiagnostics();
const gate=createCustomerReadGate({signal:deadline});
let config:{accessToken?:string;portalId?:string}|null=null;
return createPlacementSyncHandler({authenticate:async req=>{
 if(Deno.env.get('SUPABASE_URL')!==NATIVE)return false;
 const secret=req.headers.get('x-camera-cron-secret');if(!secret||secret.length>1024||/\s/.test(secret))return false;
 const v=await json(await fetch('https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness',{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':secret},body:'{"action":"authenticate"}',redirect:'error',signal:AbortSignal.timeout(10000)}),128);
 return v?.authenticated===true&&Object.keys(v).length===1;
},rpc:async(name,body)=>{
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!key)throw Error('Backend unavailable');
 return json(await fetch(NATIVE+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)}),1048576);
},equipment:async()=>{
 const result=await partner('/api/mhelpdesk/partner/preview','POST',{});
 if(result.partial||!result.liveAccessVerified||result.verifiedPortalId!==PORTAL||result.items.length!==result.totalRows)throw Error('Incomplete inventory');
 config=await tokens.getPartnerConfig();return result.items;
},customer:async id=>{
 const current=config;if(!current?.accessToken||current.portalId!==PORTAL)return null;
 return readPlacementCustomer(id,{accessToken:current.accessToken,portalId:PORTAL,signal:deadline,fetch,readJson:json,onAttempt:diagnostics.record,beforeAttempt:gate.acquire,onRateLimit:gate.rateLimited});
},readDiagnostics:diagnostics.snapshot})(request);
});
