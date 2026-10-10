/** Owner route invokes this server-only flow. Secret DTOs never cross its result boundary. */
const ACCOUNT='https://connect.mhelpdesk.com/api/v1.0/users/me';
const TOKEN='https://login.mhelpdesk.com/connect/token';
const CONTRACT='cos-mhelpdesk-reconnect-v1';
type Row=Record<string,unknown>;
type Config={clientId?:string;clientSecret?:string;portalId?:string};
const object=(v:unknown):v is Row=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const token=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=16384&&!/[\s\x00-\x1f\x7f]/.test(v);
const portal=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,14}$/.test(v)&&Number.isSafeInteger(Number(v));
const revision=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<Number.MAX_SAFE_INTEGER;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export class MhelpReconnectError extends Error{
 readonly status:number;
 constructor(status=503){super(status===403?'The active COS Owner authorization changed. Reopen reconnect after signing in.':status===400?'Enter a fresh matching token pair and reopen the reconnect form if its connection revision changed.':status===409?'A token update is already running. Check the reconnect result before trying again.':'Reconnect could not be confirmed. Check the reconnect result before trying again.');this.status=status;}
}
function fail(status=503):never{throw new MhelpReconnectError(status);}
function checkedRequest(value:unknown,credentials:boolean):Row{
 if(!object(value))fail(400);
 const keys=credentials?['accessToken','refreshToken','expectedRevision','requestId']:['expectedRevision','requestId'];
 if(Object.keys(value).some(k=>!keys.includes(k)))fail(400);
 if(credentials||Object.keys(value).length){if(!revision(value.expectedRevision)||!uuid(value.requestId))fail(400);}
 if(credentials&&(!token(value.accessToken)||!token(value.refreshToken)))fail(400);
 return value;
}
const cancel=(s:{cancel:()=>Promise<unknown>})=>{try{void s.cancel().catch(()=>{});}catch{/* No transport details. */}};
function deadline<T>(run:()=>Promise<T>,signal:AbortSignal,late?:(value:T)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  let done=false;const abort=()=>{if(done)return;done=true;signal.removeEventListener('abort',abort);reject(new MhelpReconnectError());};
  if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{if(signal.aborted)fail();return run();}).then(value=>{if(done){try{late?.(value);}catch{}return;}done=true;signal.removeEventListener('abort',abort);resolve(value);},cause=>{if(done)return;done=true;signal.removeEventListener('abort',abort);reject(cause instanceof MhelpReconnectError?cause:new MhelpReconnectError());});
 });
}
async function bounded(fetcher:typeof fetch,url:string,init:RequestInit,signal:AbortSignal):Promise<Row>{
 const response=await deadline(()=>fetcher(url,{...init,redirect:'error',cache:'no-store',signal}),signal,r=>{if(r.body)cancel(r.body);});
 if(!response.ok||!response.body||Number(response.headers.get('Content-Length'))>32768){if(response.body)cancel(response.body);fail();}
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
 try{while(true){const{value,done}=await deadline(()=>reader.read(),signal);if(done)break;size+=value.byteLength;if(size>32768)fail();raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();const result=JSON.parse(raw);if(!object(result))fail();return result;}
 catch{return fail();}finally{cancel(reader);try{reader.releaseLock();}catch{}}
}
export function createMhelpReconnect(options:{getConfig:()=>Config;fetch:typeof fetch;session:(body:Row)=>Promise<Row>}){
 let pending=false;
 const result=(row:Row,request:Row={})=>{
  if(row.configured===false)return {contract:CONTRACT,state:'unavailable',portalId:null,revision:null,renewalVerified:false};
  if(!portal(row.portal_id)||!revision(row.revision))fail();
  const committed=row.committed===true;
  if(committed&&(!revision(request.expectedRevision)||row.revision!==request.expectedRevision+1||!uuid(request.requestId)))fail();
  return {contract:CONTRACT,state:committed?'committed':row.in_progress===true?'pending':'ready',portalId:row.portal_id,revision:row.revision,renewalVerified:committed,...(request.requestId?{requestId:request.requestId}:{})};
 };
 const status=async(value:unknown)=>{
  const request=checkedRequest(value,false),signal=AbortSignal.timeout(12000);
  const row=await deadline(()=>options.session({p_action:'reconnect_status',...(request.requestId?{p_request_id:request.requestId,p_expected_revision:request.expectedRevision}:{})}),signal);
  return result(row,request);
 };
 const reconnect=async(value:unknown,reauthorize:()=>Promise<void>=async()=>fail(403))=>{
  const request=checkedRequest(value,true);
  if(pending)fail(409);pending=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  let lease:string|null=null,rotationAttempted=false;
  const authorized=()=>deadline(reauthorize,controller.signal);
  try{
   await authorized();
   const config=options.getConfig();if(!token(config.clientId)||!token(config.clientSecret))fail();
   const claimed=await deadline(()=>options.session({p_action:'reconnect_claim',p_expected_revision:request.expectedRevision,p_request_id:request.requestId}),controller.signal);
   if(claimed.committed===true)return result(claimed,request);
   if(claimed.configured!==true||!portal(claimed.portal_id)||claimed.revision!==request.expectedRevision||!uuid(claimed.lease_id))fail();
   lease=claimed.lease_id;
   if(config.portalId&&config.portalId!==claimed.portal_id)fail();
   const readPortal=async(accessToken:string)=>{
    const row=await bounded(options.fetch,ACCOUNT,{method:'GET',headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'}},controller.signal);
    const id=typeof row.portalId==='number'&&Number.isSafeInteger(row.portalId)?String(row.portalId):row.portalId;
    if(!portal(id)||id!==claimed.portal_id)fail();
   };
   await authorized();
   await readPortal(request.accessToken as string);
   await authorized();
   const body=new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token',scope:'openid profile offline_access mhdapi',refresh_token:request.refreshToken as string}).toString();
   // Any attempt can rotate upstream, even if its response is lost. Never replay it.
   rotationAttempted=true;
   const issued=await bounded(options.fetch,TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body},controller.signal);
   if(!token(issued.access_token)||typeof issued.token_type!=='string'||issued.token_type.toLowerCase()!=='bearer'||!Number.isInteger(issued.expires_in)||Number(issued.expires_in)<60||Number(issued.expires_in)>86400)fail();
   const refresh=issued.refresh_token==null?request.refreshToken:issued.refresh_token;if(!token(refresh))fail();
   // Validate the renewed pair in the unchanged portal before replacing the old pair.
   await readPortal(issued.access_token);
   const commit={p_action:'reconnect_commit',p_session:lease,p_request_id:request.requestId,p_expected_revision:request.expectedRevision,p_portal_id:claimed.portal_id,p_access_token:issued.access_token,p_refresh_token:refresh,p_expires_at:new Date(Date.now()+Number(issued.expires_in)*1000).toISOString()};
   let saved:Row;
   await authorized();
   try{saved=await deadline(()=>options.session(commit),controller.signal);}catch{await authorized();saved=await deadline(()=>options.session(commit),controller.signal);}
   if(saved.committed!==true)fail();
   lease=null;return result(saved,request);
  }catch(cause){if(cause instanceof MhelpReconnectError)throw cause;fail();}
  finally{
   clearTimeout(timer);controller.abort();
   // Preserve the old pair. Hold uncertain upstream/commit attempts until the shared lease expires.
   if(lease&&!rotationAttempted){await deadline(()=>options.session({p_action:'release',p_session:lease}),AbortSignal.timeout(10000)).catch(()=>{});}
   pending=false;
  }
 };
 return {status,reconnect};
}
