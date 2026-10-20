import {createMhelpTokenManager} from './mhelpTokenSession.ts';
import {createMhelpReconnect,MhelpReconnectError} from './mhelpReconnect.ts';
import {createMhelpReadBackoff} from './mhelpReadBackoff.ts';
import {createMhelpRequestBudget,mhelpRequestClass} from './mhelpRequestBudget.ts';
const NATIVE='https://tughscoxralhofrckvxy.supabase.co';
export function nativeMhelpTokens(env:(name:string)=>string|undefined,fetcher:typeof fetch=fetch){
 const options={getConfig:()=>({accessToken:env('COS_MHELP_ACCESS_TOKEN'),refreshToken:env('COS_MHELP_REFRESH_TOKEN'),clientId:env('COS_MHELP_CLIENT_ID'),clientSecret:env('COS_MHELP_CLIENT_SECRET'),portalId:env('COS_MHELP_PORTAL_ID')}),fetch:fetcher,session:async (body:Record<string,unknown>)=>{
  const service=env('SUPABASE_SERVICE_ROLE_KEY');if(env('SUPABASE_URL')!==NATIVE||!service)throw Error('Token storage unavailable');
  const response=await fetcher(NATIVE+'/rest/v1/rpc/cos_mhelp_token_session',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  const reconnectConflict=response.status===409&&['reconnect_claim','reconnect_commit'].includes(String(body.p_action));
  if((!response.ok&&!reconnectConflict)||!response.body||Number(response.headers.get('Content-Length'))>65536)throw Error('Token storage unavailable');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
  try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw Error('Token storage unavailable');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();const result=JSON.parse(raw);if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Token storage unavailable');if(!response.ok){if(reconnectConflict&&result.code==='PT409')throw new MhelpReconnectError(409,true);throw Error('Token storage unavailable');}return result;}
  catch(cause){if(cause instanceof MhelpReconnectError)throw cause;throw Error('Token storage unavailable');}finally{reader.releaseLock();}
 }};
 const backoff=createMhelpReadBackoff({fetch:fetcher,gate:options.session});
 const metadata=async(name:'cos_mhelp_request_budget'|'cos_mhelp_renewal_guard',body:Record<string,unknown>)=>{
  const service=env('SUPABASE_SERVICE_ROLE_KEY');if(env('SUPABASE_URL')!==NATIVE||!service)throw Error('Request allowance unavailable');
  const response=await fetcher(NATIVE+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.body||Number(response.headers.get('Content-Length'))>4096)throw Error('Request allowance unavailable');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4096)throw Error();raw+=decoder.decode(r.value,{stream:true});}const value=JSON.parse(raw+decoder.decode());if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value as Record<string,unknown>;}
  catch{throw Error('Request allowance unavailable');}finally{void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
 };
 const budget=createMhelpRequestBudget({fetch:backoff.fetch,admit:essential=>metadata('cos_mhelp_request_budget',{p_essential:essential})});
 // Outer budget refusals never enter the provider-backoff recorder. Genuine
 // provider 429s still pass through the existing inner durable backoff.
 const guarded={...options,fetch:budget.fetch,renewalGuard:(action:'check'|'reject',lease?:string)=>metadata('cos_mhelp_renewal_guard',{p_action:action,p_lease:lease||null})};
 const manager=createMhelpTokenManager(guarded);
 // Re-read persisted access immediately before ordinary data I/O. Secure
 // reconnect and rotation verification retain their explicit candidate pair.
 const currentFetch:typeof fetch=async(input,init)=>{
  const url=input instanceof Request?input.url:String(input),headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
  if(mhelpRequestClass(input)&&new URL(url).hostname==='connect.mhelpdesk.com'&&headers.has('Authorization')){
   const current=await manager.getPartnerConfig();if(!current.accessToken)throw Error('Stored access unavailable');
   const safeHeaders:Record<string,string>=Object.fromEntries(headers);delete safeHeaders.authorization;safeHeaders.Authorization='Bearer '+current.accessToken;
   return fetcher(input,{...init,headers:safeHeaders});
  }
  return fetcher(input,init);
 };
 const currentBackoff=createMhelpReadBackoff({fetch:currentFetch,gate:options.session});
 const currentBudget=createMhelpRequestBudget({fetch:currentBackoff.fetch,admit:essential=>metadata('cos_mhelp_request_budget',{p_essential:essential})});
 return {...manager,reconnect:createMhelpReconnect(guarded),fetch:currentBudget.fetch,readBackoff:currentBackoff.snapshot};
}
