/** Public CI constants. None are production credentials or endpoints. */
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {assertHostedPostgres} from '../lib/database.mjs';

export const HTTP_ORIGIN='http://127.0.0.1:3000';
export const RPC_PATH='/rpc/publish_camera_connection_v1';
export const JWT_TEST_KEY='direct-ip-proof-public-ci-key-20261014-not-a-secret';
export const AUTHENTICATOR='direct_ip_http_authenticator';
export const FIXTURE_META=new URL('./fixture-metadata.generated.json',import.meta.url);
export const REPORT_PATH=new URL('./postgrest-report.generated.json',import.meta.url);
export const PUBLISHER='public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text)';
export function assertHostedHttp(){
 assertHostedPostgres();
 assert.equal(process.env.DIRECT_IP_PROOF_HTTP,'1','Actual PostgREST HTTP execution needs the explicit hosted HTTP gate.');
}
export function token(role='service_role',{key=JWT_TEST_KEY,expires=4102444800,algorithm='HS256'}={}){
 const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const value=part({alg:algorithm,typ:'JWT'})+'.'+part({role,iss:'synthetic-direct-ip-proof',exp:expires});
 return value+'.'+(algorithm==='none'?'':createHmac('sha256',key).update(value).digest('base64url'));
}
export async function request(path,{method='GET',body,token:jwt=token(),headers={},origin=HTTP_ORIGIN}={}){
 // The harness deliberately offers no arbitrary network destination.
 assert.equal(origin,HTTP_ORIGIN);
 assert.ok(path.startsWith('/')&&!path.startsWith('//'));
 const response=await fetch(origin+path,{method,redirect:'error',signal:AbortSignal.timeout(10_000),
  headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(jwt===null?{}:{Authorization:'Bearer '+jwt}),...headers},
  body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();let data;
 try{data=JSON.parse(text);}catch{data=text;}
 return {status:response.status,headers:Object.fromEntries(response.headers),data};
}
export const rpc=(args,options={})=>request(RPC_PATH,{method:'POST',body:args,...options});
export const operation=(metadata,op,id,{sequence,result}={})=>({...metadata.baseArgs,p_health:{direct_attempt:{version:1,op,attempt_id:id,
 binding:metadata.binding,...(sequence===undefined?{}:{sequence}),...(result===undefined?{}:{result})}}});
export async function publisherIdentity(pg){
 return (await pg.query(`select proowner::regrole::text as owner,proacl::text as acl,
 encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') as definition_sha256
 from pg_proc where oid=$1::regprocedure`,[PUBLISHER])).rows[0];
}
export async function snapshot(pg){
 // One statement gives a single database snapshot; identity-sequence counters are
 // intentionally excluded because PostgreSQL sequences are not transactional.
 return (await pg.query(`select jsonb_build_object(
 'devices',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.camera_devices t),
 'health',(select coalesce(jsonb_agg(to_jsonb(t) order by camera_device_id),'[]'::jsonb) from public.camera_health_current t),
 'history',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.camera_health_history t),
 'state',(select coalesce(jsonb_agg(to_jsonb(t) order by camera_device_id),'[]'::jsonb) from camera_direct_health_private.attempt_state t),
 'receipts',(select coalesce(jsonb_agg(to_jsonb(t) order by attempt_id),'[]'::jsonb) from camera_direct_health_private.attempt_receipts t)
 ) as snapshot`)).rows[0].snapshot;
}
