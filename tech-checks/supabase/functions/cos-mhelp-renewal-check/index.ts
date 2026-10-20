/** Protected maintenance check. No credential DTO or provider body may leave this handler. */
const NATIVE='https://tughscoxralhofrckvxy.supabase.co';
const AUTH='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness';
const PORTAL='224643';
type Row=Record<string,unknown>;
type Options={env:(name:string)=>string|undefined;fetch:typeof fetch;renewAccess:()=>Promise<unknown>};
const stages=['token_request','token_response'];
const reasons=['transport_failed','deadline','http_error','response_missing','response_too_large','response_invalid'];
const oauthErrors=['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope'];
const row=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const reply=(body:Row,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function safeDiagnostic(cause:unknown):Row|undefined{
 try{
  if(!row(cause)||!row(cause.diagnostic))return;
  const v=cause.diagnostic;
  if(!stages.includes(v.stage as string)||!reasons.includes(v.reason as string))return;
  return {stage:v.stage,reason:v.reason,httpStatus:typeof v.httpStatus==='number'&&Number.isInteger(v.httpStatus)&&v.httpStatus>=100&&v.httpStatus<=599?v.httpStatus:null,oauthError:oauthErrors.includes(v.oauthError as string)?v.oauthError:null};
 }catch{return;}
}
export async function boundedJson(input:Request|Response,maximum:number,deadlineMs=3000):Promise<unknown>{
 if(!input.body||Number(input.headers.get('Content-Length'))>maximum)throw Error('Invalid body');
 const reader=input.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let length=0,raw='';
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Body deadline')),deadlineMs);});
 try{
  for(;;){const result=await Promise.race([reader.read(),deadline]);if(result.done)break;length+=result.value.byteLength;if(length>maximum)throw Error('Invalid body');raw+=decoder.decode(result.value,{stream:true});}
  return JSON.parse(raw+decoder.decode());
 }finally{if(timer)clearTimeout(timer);try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
}
export function createRenewalCheck(options:Options){
 return async(req:Request):Promise<Response>=>{
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  if(options.env('SUPABASE_URL')!==NATIVE)return reply({error:'Maintenance check unavailable'},503);
  const secret=req.headers.get('x-camera-cron-secret');
  if(!secret||secret.length>4096||/\s/.test(secret))return reply({error:'Forbidden'},403);
  try{
   const auth=await options.fetch(AUTH,{method:'POST',headers:{'Content-Type':'application/json','x-camera-cron-secret':secret},body:'{"action":"authenticate"}',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(auth.status!==200)throw Error('Forbidden');
   const proof=await boundedJson(auth,256);
   if(!row(proof)||proof.authenticated!==true||Object.keys(proof).length!==1)throw Error('Forbidden');
  }catch{return reply({error:'Forbidden'},403);}
  try{
   const input=await boundedJson(req,512);
   if(new URL(req.url).search||!row(input)||Object.keys(input).length!==1||input.action!=='renew_access')throw Error('Invalid request');
  }catch{return reply({error:'Invalid maintenance request'},400);}
  try{
   const result=await options.renewAccess();
   if(!row(result)||result.portalId!==PORTAL)throw Error('Unverified renewal');
   return reply({ok:true,tokenRenewalVerified:true,verifiedPortalId:PORTAL,sourceRefreshed:false});
  }catch(cause){
   const diagnostic=safeDiagnostic(cause);
   return reply({ok:false,tokenRenewalVerified:false,sourceRefreshed:false,error:'mHelpDesk secure token renewal failed',...(diagnostic?{diagnostic}: {})},503);
  }
 };
}
