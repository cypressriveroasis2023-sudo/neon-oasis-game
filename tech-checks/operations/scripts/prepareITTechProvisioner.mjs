import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Temporary, narrowly scoped Auth provisioning source. The only permitted
 * effect is creating this fixed native identity. Auth UUID uniqueness makes
 * creation idempotent across workers; later calls only verify that same user.
 * This is not a durable single-request token store. Disable the deployed helper
 * immediately after the independent Auth readback, even before its expiry.
 *
 * No password/hash, application role, email delivery or login token is supplied
 * or requested. Supabase Auth may generate an undisclosed password internally
 * when an admin create request omits a password; the helper never receives it.
 */
export function createITTechProvisioner(config,{fetcher=globalThis.fetch,now=()=>Date.now(),getEnv=name=>globalThis.Deno.env.get(name)}={}){
 if(!config||Object.keys(config).some(key=>!['tokenSha256','expiresAt'].includes(key))||typeof config.tokenSha256!=='string'||!/^[0-9a-f]{64}$/.test(config.tokenSha256)||typeof config.expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/.test(config.expiresAt)||!Number.isFinite(Date.parse(config.expiresAt)))throw Error('A reviewed bearer hash and fixed UTC expiry are required.');
 const expectedHash=config.tokenSha256,expiry=Date.parse(config.expiresAt);
 const userId='c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7';
 const legacyId='05bf20fe-19f7-4db7-ac05-5b2a5f681fdf';
 const email='ittech@cameras-on-site.invalid',name='Test IT';
 const projectUrl='https://tughscoxralhofrckvxy.supabase.co';
 const contract='COS_ITTECH_NATIVE_AUTH_20261022_V1';
 const userMetadata=Object.freeze({name,full_name:name});
 const appMetadata=Object.freeze({cos_provisioning_contract:contract,cos_legacy_user_id:legacyId});
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 const problem=(status,error)=>({status,body:{ok:false,error}});
 const success=state=>({status:state==='created'?201:200,body:{ok:true,state,userId,displayName:name}});
 const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function sameMetadata(actual,required,generated){
  if(!plain(actual)||Object.keys(required).some(key=>JSON.stringify(actual[key])!==JSON.stringify(required[key])))return false;
  return Object.keys(actual).every(key=>Object.hasOwn(required,key)||Object.hasOwn(generated,key)&&JSON.stringify(actual[key])===JSON.stringify(generated[key]));
 }
 function exactUser(user){
  if(!plain(user)||user.id!==userId||user.email!==email||user.role!=='authenticated'||user.is_anonymous===true||user.deleted_at||user.phone)return false;
  if(typeof user.email_confirmed_at!=='string'||!Number.isFinite(Date.parse(user.email_confirmed_at)))return false;
  if(!sameMetadata(user.user_metadata,userMetadata,{email_verified:true,phone_verified:false,email,sub:userId}))return false;
  if(!sameMetadata(user.app_metadata,{...appMetadata,provider:'email',providers:['email']},{}))return false;
  if(!Array.isArray(user.identities)||user.identities.length!==1)return false;
  const identity=user.identities[0];
  return identity?.user_id===userId&&identity.provider==='email'&&identity.identity_data?.sub===userId&&identity.identity_data?.email===email;
 }
 async function bearerAllowed(request){
  const match=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('authorization')||'');
  if(!match)return false;
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(match[1])));
  const actual=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  let mismatch=0;for(let index=0;index<64;index++)mismatch|=actual.charCodeAt(index)^expectedHash.charCodeAt(index);
  return mismatch===0;
 }
 async function emptyBody(request){
  if(!request.body)return true;
  const reader=request.body.getReader();
  try{for(;;){const chunk=await reader.read();if(chunk.done)return true;if(chunk.value?.byteLength){await reader.cancel();return false;}}}finally{reader.releaseLock();}
 }
 let pending=null;
 async function provision(){
  if(now()>=expiry)return problem(410,'This temporary provisioning authorization has expired.');
  let base,key;
  try{base=getEnv('SUPABASE_URL');key=getEnv('SUPABASE_SERVICE_ROLE_KEY');}catch{return problem(503,'Provisioning configuration is unavailable.');}
  if(typeof base!=='string'||base.replace(/\/$/,'')!==projectUrl||typeof key!=='string'||!key)return problem(503,'Provisioning configuration is unavailable.');
  const headers={apikey:key,authorization:'Bearer '+key,'content-type':'application/json'};
  const invoke=(method,path,body)=>fetcher(projectUrl+'/auth/v1/admin/users'+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(10000),...(body?{body:JSON.stringify(body)}:{})});
  async function lookup(){
   try{
    const response=await invoke('GET','/'+userId);
    if(response.status===404)return {missing:true};
    if(!response.ok)return {unavailable:true};
    const user=await response.json();
    return exactUser(user)?{exact:true}:{conflict:true};
   }catch{return {unavailable:true};}
  }
  const before=await lookup();
  if(before.exact)return success('already_exists');
  if(before.conflict)return problem(409,'The fixed Auth identity does not match the reviewed provisioning record.');
  if(!before.missing)return problem(502,'The current Auth identity could not be verified.');
  if(now()>=expiry)return problem(410,'This temporary provisioning authorization has expired.');
  let submitted=false;
  try{
   const response=await invoke('POST','',{id:userId,email,email_confirm:true,user_metadata:userMetadata,app_metadata:appMetadata});
   submitted=response.ok;
   await response.body?.cancel();
  }catch{/* An uncertain write is checked with a fresh GET, never replayed here. */}
  const after=await lookup();
  if(after.exact)return success(submitted?'created':'confirmed_after_submit');
  if(after.conflict)return problem(409,'Auth readback does not match the reviewed provisioning record.');
  return problem(502,'Auth creation could not be confirmed. No automatic create retry was issued.');
 }
 return async request=>{
  try{
   if(now()>=expiry)return reply(410,{ok:false,error:'This temporary provisioning authorization has expired.'});
   if(request.method!=='POST')return reply(405,{ok:false,error:'Use an empty POST request.'});
   if(!await bearerAllowed(request))return reply(401,{ok:false,error:'Provisioning authorization is required.'});
   if(new URL(request.url).search||!await emptyBody(request))return reply(400,{ok:false,error:'This helper accepts no query parameters or request body.'});
   if(!pending)pending=provision().finally(()=>{pending=null;});
   const result=await pending;return reply(result.status,result.body);
  }catch{return reply(503,{ok:false,error:'Provisioning could not be completed safely.'});}
 };
}

export function renderITTechProvisioner(config){
 createITTechProvisioner(config); // Validate source configuration without I/O.
 return '// Temporary fixed Test IT Auth provisioning. Remove after verified use.\n'+
  'const config=Object.freeze('+JSON.stringify({tokenSha256:config.tokenSha256,expiresAt:new Date(config.expiresAt).toISOString()})+');\n'+
  createITTechProvisioner.toString()+'\nDeno.serve(createITTechProvisioner(config));\n';
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [configPath,output]=process.argv.slice(2);
 if(!configPath||!output)throw Error('Usage: prepareITTechProvisioner.mjs hash-and-expiry-only.json output.ts');
 // The input contains only a hash and expiry, never the secret bearer itself.
 const config=JSON.parse(await readFile(configPath,'utf8'));
 await writeFile(output,renderITTechProvisioner(config),{mode:0o600});
 console.log(JSON.stringify({prepared:true,targetUserId:'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7',expiresAt:new Date(config.expiresAt).toISOString()}));
}
