import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {hostedConfiguration} from './postgres-engine.mjs';
const run=promisify(execFile),exec=(command,args)=>run(command,args,{timeout:15000,maxBuffer:1024*1024}),image='postgrest/postgrest:v14.5@sha256:b574528fe109c8343c1247155734d03df8c34b462f342dca0ccc20244fc36ef9';
export async function startPostgrest(f){
 hostedConfiguration();assert(new URL(f.connectionString).pathname.startsWith('/recon_proof_'));
 const name='recon-proof-rest-'+randomUUID(),secret='synthetic-only-'+randomUUID()+'-'+randomUUID();
 const jwt=role=>{
  const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const payload=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role,iss:'recon-hosted-synthetic-proof',exp:Math.floor(Date.now()/1000)+1800});
  return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
 };
 const url='http://127.0.0.1:3000',headers={authorization:'Bearer '+jwt('service_role'),'content-type':'application/json'};
 let attempted=false,closed=false;
 const close=async()=>{if(closed||!attempted)return;
  try{await exec('docker',['rm','-f',name])}catch(error){if(!String(error.stderr??'').includes('No such container'))throw error}
  closed=true;
 };
 try{
  // Only fixture values are passed; no production secrets or host credentials.
  attempted=true;await exec('docker',['run','--rm','-d','--name',name,'--network','host',
   '-e','PGRST_DB_URI='+f.connectionString,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon',
   '-e','PGRST_JWT_SECRET='+secret,'-e','PGRST_SERVER_HOST=127.0.0.1','-e','PGRST_SERVER_PORT=3000',
   '-e','PGOPTIONS=-c statement_timeout=10000 -c lock_timeout=8000','-e','PGRST_DB_POOL=10','-e','PGRST_DB_POOL_ACQUISITION_TIMEOUT=5',image]);
  const until=Date.now()+30000;let ready=false;
  while(Date.now()<until){try{const r=await fetch(url+'/',{headers,signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert(ready,'PostgREST did not become ready');
  return {url,headers,roleHeaders:role=>({authorization:'Bearer '+jwt(role),'content-type':'application/json'}),close,image,
   async reload(){await f.db.query("NOTIFY pgrst,'reload schema'");await new Promise(r=>setTimeout(r,200));}};
 }catch(error){try{await close()}catch(cleanupError){throw new AggregateError([error,cleanupError],'PostgREST startup and cleanup failed')}throw error}
}
