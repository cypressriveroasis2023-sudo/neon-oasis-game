/** Server-only OAuth renewal; never return this module's credential DTOs to callers. */
const ACCOUNT='https://connect.mhelpdesk.com/api/v1.0/users/me';
const TOKEN='https://login.mhelpdesk.com/connect/token';
type Row=Record<string,unknown>;
type Config={accessToken?:string;refreshToken?:string;clientId?:string;clientSecret?:string;portalId?:string};
const validToken=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=16384&&!/\s/.test(v);
const validPortal=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,14}$/.test(v)&&Number.isSafeInteger(Number(v));
const fail=():never=>{throw Error('mHelpDesk secure token renewal is unavailable');};
async function bounded(response:Response,signal:AbortSignal):Promise<Row>{
 if(!response.ok||!response.body||Number(response.headers.get('Content-Length'))>32768)fail();
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
 try{while(true){if(signal.aborted)fail();const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();fail();}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))fail();return v;}
 catch{fail();}finally{reader.releaseLock();}
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
   const issued=await bounded(await options.fetch(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:form.toString(),redirect:'error',cache:'no-store',signal:controller.signal}),controller.signal);
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
  }catch{fail();}finally{
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
