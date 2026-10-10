/** Server-only OAuth renewal; never return this module's credential DTOs to callers. */
const ACCOUNT='https://connect.mhelpdesk.com/api/v1.0/users/me';
const TOKEN='https://login.mhelpdesk.com/connect/token';
type Row=Record<string,unknown>;
type Config={accessToken?:string;refreshToken?:string;clientId?:string;clientSecret?:string;portalId?:string};
const validToken=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=16384&&!/\s/.test(v);
const validPortal=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,14}$/.test(v)&&Number.isSafeInteger(Number(v));
function fail():never{throw Error('mHelpDesk secure token renewal is unavailable');}
const RENEWAL_STAGES=['token_request','token_response'] as const;
const RENEWAL_REASONS=['transport_failed','deadline','http_error','response_missing','response_too_large','response_invalid'] as const;
// RFC 6749 section 5.2. Never retain error_description, error_uri or unknown errors.
const OAUTH_ERRORS=['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope'] as const;
export type MhelpTokenRenewalDiagnostic={
 stage:typeof RENEWAL_STAGES[number];reason:typeof RENEWAL_REASONS[number];
 httpStatus:number|null;oauthError:typeof OAUTH_ERRORS[number]|null;
};
/** Defense-in-depth projection used again at the existing server-log boundary. */
export function projectMhelpTokenRenewalDiagnostic(value:unknown):MhelpTokenRenewalDiagnostic|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const row=value as Row;
 if(!RENEWAL_STAGES.includes(row.stage as MhelpTokenRenewalDiagnostic['stage'])||!RENEWAL_REASONS.includes(row.reason as MhelpTokenRenewalDiagnostic['reason']))return;
 return {stage:row.stage as MhelpTokenRenewalDiagnostic['stage'],reason:row.reason as MhelpTokenRenewalDiagnostic['reason'],
  httpStatus:typeof row.httpStatus==='number'&&Number.isInteger(row.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599?row.httpStatus:null,
  oauthError:OAUTH_ERRORS.includes(row.oauthError as typeof OAUTH_ERRORS[number])?row.oauthError as typeof OAUTH_ERRORS[number]:null};
}
export class MhelpTokenRenewalError extends Error{
 readonly diagnostic:MhelpTokenRenewalDiagnostic;
 constructor(stage:MhelpTokenRenewalDiagnostic['stage'],reason:MhelpTokenRenewalDiagnostic['reason'],httpStatus:number|null=null,oauthError:unknown=null){
  super('mHelpDesk secure token renewal is unavailable');
  this.diagnostic=Object.freeze(projectMhelpTokenRenewalDiagnostic({stage,reason,httpStatus,oauthError})!);
 }
}
const cancel=(stream:{cancel:()=>Promise<unknown>})=>{try{void stream.cancel().catch(()=>{});}catch{/* Best-effort cleanup only. */}};
/** Abort is an independent deadline even when a transport ignores its signal. */
function tokenDeadline<T>(run:()=>Promise<T>,signal:AbortSignal,stage:MhelpTokenRenewalDiagnostic['stage'],httpStatus:number|null=null,late?:(value:T)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false;
  const expire=()=>{if(settled)return;settled=true;signal.removeEventListener('abort',expire);reject(new MhelpTokenRenewalError(stage,'deadline',httpStatus));};
  if(signal.aborted){expire();return;}
  signal.addEventListener('abort',expire,{once:true});
  Promise.resolve().then(()=>{if(signal.aborted)throw new MhelpTokenRenewalError(stage,'deadline',httpStatus);return run();}).then(value=>{
   if(settled){try{late?.(value);}catch{/* Late cleanup must not surface transport details. */}return;}
   settled=true;signal.removeEventListener('abort',expire);resolve(value);
  },cause=>{if(settled)return;settled=true;signal.removeEventListener('abort',expire);reject(cause);});
 });
}
async function bounded(response:Response,signal:AbortSignal,tokenResponse=false):Promise<Row>{
 const reject=(reason:MhelpTokenRenewalDiagnostic['reason']):never=>{
  if(tokenResponse)throw new MhelpTokenRenewalError('token_response',reason,response.status);
  return fail();
 };
 if(!response.ok&&!tokenResponse)fail();
 if(!response.body)reject('response_missing');
 if(Number(response.headers.get('Content-Length'))>32768){cancel(response.body!);reject('response_too_large');}
 const reader=response.body!.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
 try{
  while(true){if(signal.aborted)reject('deadline');const{value,done}=tokenResponse?await tokenDeadline(()=>reader.read(),signal,'token_response',response.status):await reader.read();if(done)break;size+=value.byteLength;if(size>32768){cancel(reader);reject('response_too_large');}raw+=decoder.decode(value,{stream:true});}
  raw+=decoder.decode();const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))reject('response_invalid');
  if(!response.ok)throw new MhelpTokenRenewalError('token_response','http_error',response.status,v.error);
  return v;
 }catch(cause){if(cause instanceof MhelpTokenRenewalError)throw cause;return reject(signal.aborted?'deadline':'response_invalid');}
 finally{cancel(reader);try{reader.releaseLock();}catch{/* Never replace a sanitized failure with transport details. */}}
}
async function tokenRequest(fetcher:typeof fetch,init:RequestInit,signal:AbortSignal):Promise<Row>{
 let response:Response;
 try{response=await tokenDeadline(()=>fetcher(TOKEN,init),signal,'token_request',null,value=>{if(value.body)cancel(value.body);});}
 catch(cause){if(cause instanceof MhelpTokenRenewalError)throw cause;throw new MhelpTokenRenewalError('token_request',signal.aborted?'deadline':'transport_failed');}
 return bounded(response,signal,true);
}
export function createMhelpTokenManager(options:{getConfig:()=>Config;fetch:typeof fetch;session:(body:Row)=>Promise<Row>}){
 let pending:Promise<{accessToken:string;portalId:string}>|null=null;
 const getPartnerConfig=async()=>{
  const stored=await options.session({p_action:'read'});
  if(stored.configured===false)return {accessToken:options.getConfig().accessToken,portalId:options.getConfig().portalId};
  if(stored.configured!==true||!validToken(stored.access_token)||!validPortal(stored.portal_id))fail();
  return {accessToken:stored.access_token as string,portalId:stored.portal_id as string};
 };
 const renew=async()=>{
  const config=options.getConfig();
  if(!validToken(config.clientId)||!validToken(config.clientSecret))fail();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  let lease:string|null=null,rotated=false;
  try{
   let stored=await options.session({p_action:'read'});
   const readPortal=async(accessToken:string)=>{
    const account=await bounded(await options.fetch(ACCOUNT,{method:'GET',headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal}),controller.signal);
    const portal=typeof account.portalId==='number'&&Number.isSafeInteger(account.portalId)?String(account.portalId):account.portalId;
    if(!validPortal(portal))fail();return portal;
   };
   if(stored.configured===false){
    if(!validToken(config.accessToken)||!validToken(config.refreshToken))fail();
    const portal=await readPortal(config.accessToken);
    if(config.portalId&&config.portalId!==portal)fail();
    stored=await options.session({p_action:'bootstrap',p_access_token:config.accessToken,p_refresh_token:config.refreshToken,p_portal_id:portal});
   }
   if(stored.configured!==true||!validPortal(stored.portal_id))fail();
   const claimed=await options.session({p_action:'claim'});
   if(claimed.configured!==true||!validToken(claimed.refresh_token)||!validPortal(claimed.portal_id)||typeof claimed.lease_id!=='string'||!/^[0-9a-f-]{36}$/i.test(claimed.lease_id))fail();
   lease=claimed.lease_id as string;
   const form=new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token',scope:'openid profile offline_access mhdapi',refresh_token:claimed.refresh_token as string});
   const issued=await tokenRequest(options.fetch,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:form.toString(),redirect:'error',cache:'no-store',signal:controller.signal},controller.signal);
   rotated=true;
   if(!validToken(issued.access_token)||typeof issued.token_type!=='string'||issued.token_type.toLowerCase()!=='bearer'||!Number.isInteger(issued.expires_in)||Number(issued.expires_in)<60||Number(issued.expires_in)>86400)fail();
   const refresh=issued.refresh_token==null?claimed.refresh_token:issued.refresh_token;if(!validToken(refresh))fail();
   const expires=new Date(Date.now()+Number(issued.expires_in)*1000).toISOString();
   const commit={p_action:'commit',p_session:lease,p_access_token:issued.access_token,p_refresh_token:refresh,p_expires_at:expires};
   // Persist the rotated pair before verification; retry a lost acknowledgement idempotently.
   let committed:Row;
   try{committed=await options.session(commit);}catch{committed=await options.session(commit);}
   if(committed.committed!==true)fail();
   lease=null;
   const portal=await readPortal(issued.access_token as string);
   if(portal!==claimed.portal_id)fail();
   return {accessToken:issued.access_token as string,portalId:claimed.portal_id as string};
  }catch(cause){if(cause instanceof MhelpTokenRenewalError)throw cause;fail();}finally{
   clearTimeout(timer);
   // A failed persistence attempt retains its lease until expiry to prevent overlapping rotations.
   if(lease&&!rotated)await options.session({p_action:'release',p_session:lease}).catch(()=>{});
  }
 };
 return {getPartnerConfig,renewAccess:()=>{
  if(!pending)pending=renew().finally(()=>{pending=null;});
  return pending;
 }};
}
