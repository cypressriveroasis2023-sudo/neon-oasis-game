import {createMhelpTokenManager} from './mhelpTokenSession.ts';
const NATIVE='https://tughscoxralhofrckvxy.supabase.co';
export function nativeMhelpTokens(env:(name:string)=>string|undefined,fetcher:typeof fetch=fetch){
 return createMhelpTokenManager({getConfig:()=>({accessToken:env('COS_MHELP_ACCESS_TOKEN'),refreshToken:env('COS_MHELP_REFRESH_TOKEN'),clientId:env('COS_MHELP_CLIENT_ID'),clientSecret:env('COS_MHELP_CLIENT_SECRET'),portalId:env('COS_MHELP_PORTAL_ID')}),fetch:fetcher,session:async body=>{
  const service=env('SUPABASE_SERVICE_ROLE_KEY');if(env('SUPABASE_URL')!==NATIVE||!service)throw Error('Token storage unavailable');
  const response=await fetcher(NATIVE+'/rest/v1/rpc/cos_mhelp_token_session',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.body||Number(response.headers.get('Content-Length'))>65536)throw Error('Token storage unavailable');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
  try{while(true){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw Error('Token storage unavailable');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();const result=JSON.parse(raw);if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Token storage unavailable');return result;}
  catch{throw Error('Token storage unavailable');}finally{reader.releaseLock();}
 }});
}
