/** Synthetic-only fixture. Default is in-process PGlite; hosted opt-in uses real PG.
 * PGlite serializes queries and never certifies lock/contention behavior.
 * Real PG startup is external to this fixture and restricted by the hosted backend.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {projectReconProviderInventory} from '../../../supabase/functions/_shared/reconProviderInventory.ts';

const proposals=await Promise.all(['reconeyez-owned-metadata-v2.sql','reconeyez-receipt-v2.sql'].map(async name=>({name,sql:await readFile(new URL('../../../database-maintenance/'+name,import.meta.url),'utf8')})));
export const proposalSql=Object.fromEntries(proposals.map(({name,sql})=>[name,sql]));
export const sqlSourceHashes=Object.fromEntries(proposals.map(({name,sql})=>[name,createHash('sha256').update(sql).digest('hex')]));
console.log('Synthetic in-process SQL source SHA256: '+JSON.stringify(sqlSourceHashes));
export const old = '2026-01-01T01:02:03.000Z';
export const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const gid = n => '01' + n.toString(16).toUpperCase().padStart(4,'0') + '0000000000';
export const rawInventory = (count=2,area='Synthetic Field') => [
 {guid:gid(1),type:'bridge_4g',area,name:'Synthetic bridge'},
 ...Array.from({length:count},(_,i)=>({guid:gid(i+2),type:'detector_hdr_xrl',area,name:`Synthetic detector ${i}`,description:'Synthetic description'}))
];
export async function inventoryInput(observedAt,{count=2,area='Synthetic Field'}={}){
 const list=rawInventory(count,area);
 return {p_devices:list.slice(1).map(d=>({external_device_id:d.guid,device_name:d.name,device_model:d.type,
  organization:d.area,activation_state:'active',activation_source:'reconeyez_area',unit_key:d.area,
  source_metadata:{guid:d.guid,area:d.area,description:d.description,reconeyez_type:d.type}})),
  p_identity_inventory:await projectReconProviderInventory(list,observedAt),p_inventory_count:list.length,p_skipped_non_detectors:1};
}
export const family=(namespace='RI')=>({tracker_total:0,field_or_unknown:0,shop:0,retired:0,matched_local_units:0,missing_local_units:0,
 missing_field_units:[],local_unit_namespace:namespace,namespace_inventory_present:false});
export const diagnostics=()=>({'Recon':family(),'Recon 2':family('RII')});
let reportedVersion=false;
const schema=await readFile(new URL('./recon-v2/synthetic-vault-integration.sql',import.meta.url),'utf8');

export async function fixture({absent=false,enabled=true,historicalAudit=false,installV2=true,compactor=false,projector=false}={}){
 const db=process.env.RECON_PROOF_BACKEND==='hosted-postgres'
   ? await (await import('../../../../recon-proof/postgres-engine.mjs')).createEngine()
   : new PGlite();let legacyCredentialIdentity;let installerIdentity;
 try{
  if(!reportedVersion){console.log((db.connectionString?'Hosted real PostgreSQL engine: ':'Synthetic in-process engine: ')+(await db.query('SELECT version() AS version')).rows[0].version);reportedVersion=true;}
  await db.exec(await readFile(new URL('../../legacy/tests/recon-ordering/schema.sql',import.meta.url),'utf8'));
  await db.exec(schema);
  installerIdentity=(await db.query('SELECT oid,rolname,rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
  const legacy=await readFile(new URL('../../../supabase/migrations/20260923_reconeyez_camera_integration.sql',import.meta.url),'utf8');
  await db.exec(legacy.slice(legacy.indexOf('create or replace function public.save_reconeyez_credentials('),legacy.indexOf('create or replace function public.get_reconeyez_integration_secrets()')));
  legacyCredentialIdentity=(await db.query("SELECT proowner,proacl::text,prosecdef FROM pg_proc WHERE oid='public.save_reconeyez_credentials(text,text)'::regprocedure")).rows[0];
  await db.exec(await readFile(new URL('../../../database-maintenance/reconeyez-inventory-sync.sql',import.meta.url),'utf8'));
  if(!absent)await db.query(`INSERT INTO public.camera_integrations(provider,server_host,server_port,enabled,metadata)
   VALUES('reconeyez','synthetic.invalid',9028,$1,$2)`,[enabled,{receiver_tested_at:old,last_webhook_received_at:old,archive:{cursor:'synthetic'},unrelated:['keep']}]);
  if(installV2)await db.exec(proposals[0].sql);
  if(historicalAudit)await db.exec("INSERT INTO public.camera_integration_events(provider,event_type,observed_at,payload) VALUES('reconeyez','Historical synthetic event','2026-01-01T00:00:00Z','{}')");
  if(installV2)await db.exec(proposals[1].sql);
  if(compactor){
   await db.exec(`CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean NOT NULL);CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb);
    GRANT USAGE ON SCHEMA storage TO service_role;GRANT SELECT ON storage.buckets,storage.objects TO service_role;`);
   await db.exec(await readFile(new URL('../../../database-maintenance/archive-recon-event-payloads.sql',import.meta.url),'utf8'));
  }
  if(projector)await db.exec(await readFile(new URL('../../../database-maintenance/reconeyez-event-ordering.sql',import.meta.url),'utf8'));
 }catch(error){await db.close();throw error;}
 const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
 const rpc=async(name,args={},role='service_role')=>db.transaction(async tx=>{
  assert(['service_role','anon','authenticated'].includes(role));await tx.exec('SET LOCAL ROLE '+role);
  return (await tx.query('SELECT public.'+name+'('+Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')+') AS value',Object.values(args))).rows[0]?.value;
 });
 const integration=()=>scalar(`SELECT to_jsonb(i) AS value FROM public.camera_integrations i WHERE provider='reconeyez'`);
 const snapshot=async()=>{
  const state={};for(const table of ['camera_integrations','camera_devices','camera_health_current','camera_health_history','camera_integration_events','app_notifications'])
   state[table]=await scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value FROM public.${table} t`);
  state.vault=await scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY name),'[]'::jsonb) AS value FROM vault.secrets t`);
  state.vault_updates=await scalar(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id,secret),'[]'::jsonb) AS value FROM vault.synthetic_updates t`);
  return state;
 };
 let id=1;
 const begin=(kind='inventory_sync',requestId=uuid(id++))=>rpc('recon_begin_attempt_v2',{p_request_id:requestId,p_kind:kind});
 const finish=(token,input)=>rpc('recon_finish_inventory_v2',{p_attempt_id:token.attempt_id,...input});
 const failure=(token,reason='provider_unavailable')=>rpc('recon_fail_attempt_v2',{p_attempt_id:token.attempt_id,p_reason_code:reason});
 const lookup=token=>rpc('recon_attempt_result_v2',{p_attempt_id:token.attempt_id??token});
 const create=(token,input,credentials={p_username:'synthetic-username',p_password:'synthetic-password'})=>rpc('recon_create_inventory_v2',{
  p_request_id:token.request_id,p_observed_at:token.observed_at,p_expires_at:token.expires_at,p_retain_until:token.retain_until,...input,...credentials});
 const audit=async({startedAt=null,receivedAt=null,observedAt=null,externalGuid=null,cameraDeviceId=null,code=null,kind='ordinary',token=null,type=kind==='receiver_test'?'IntegrationTest':'Synthetic ordinary',provider='reconeyez',payload=null}={})=>{
  startedAt??=new Date(token?Math.max(Date.now(),Date.parse(token.observed_at)+1):Date.now()).toISOString();receivedAt??=startedAt;
  const body=payload??(token?{eventType:'IntegrationTest',deviceGuid:'__camera_health_receiver_test__',timestamp:token.observed_at,source:'Camera Health self-test',cos_receiver_test_v2:{schema_version:2,attempt_id:token.attempt_id}}:{});
  return (await db.query(`INSERT INTO public.camera_integration_events(provider,event_type,received_at,payload,recon_receipt_started_at,recon_receipt_kind,recon_receiver_attempt_id,observed_at,external_device_id,camera_device_id,event_code)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[provider,type,receivedAt,body,startedAt,kind,token?.attempt_id??null,observedAt,externalGuid,cameraDeviceId,code])).rows[0].id;
 };
 return {db,rpc,scalar,integration,snapshot,begin,finish,failure,lookup,create,audit,legacyCredentialIdentity,installerIdentity,close:()=>db.close()};
}
