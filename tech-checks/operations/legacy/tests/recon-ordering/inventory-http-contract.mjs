// FUTURE actual PostgREST v2 HTTP gate against a newly created disposable loopback database.
// This is source preparation only until separately authorized to open loopback
// sockets/start the executable. node --check does not execute this gate.
// Run with node --import tsx and both RECON_INVENTORY_TEST_DATABASE_URL and
// RECON_INVENTORY_TEST_POSTGREST_BINARY (an existing local PostgREST executable).
// No provider requests, live records, project credentials or runtime retry changes.
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createServer} from 'node:net';
import {isAbsolute, join} from 'node:path';
import {randomUUID, webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {validateInventoryTestUrl} from './inventory-concurrency.mjs';
import {prepareReconInventory, syncReconInventory} from '../../../../supabase/functions/reconeyez-connect/inventorySync.ts';
import * as owned from '../../../../supabase/functions/_shared/reconOwnedMetadataV2.ts';
const list = [
 {guid:'AA00000100000001',type:'bridge_4g',area:'Synthetic Field',name:'Synthetic bridge'},
 {guid:'BB00000100000001',type:'detector',area:'Synthetic Field',name:'Synthetic detector'}
];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = promise => promise.then(value => ({value}), error => ({error}));

export function validatePostgrestBinary(path) {
 if (typeof path !== 'string' || !isAbsolute(path) || /[\r\n\0]/.test(path))
  throw Error('Set RECON_INVENTORY_TEST_POSTGREST_BINARY to an existing absolute local executable path.');
 return path;
}

async function availablePort() {
 const server = createServer();
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
 const port = server.address().port;
 await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
 return port;
}

async function stopChild(child) {
 if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
 const ended = once(child, 'exit');
 child.kill('SIGTERM');
 if (await Promise.race([ended.then(() => true), delay(3000).then(() => false)])) return;
 child.kill('SIGKILL'); await ended;
}

// Feed actual HTTP error JSON through the real v2 helper and transpiled current
// Edge source. This is a SYNTHETIC SDK/auth/provider adapter, not actual Deno or
// deployed Edge runtime evidence. Its RESULT is pending, so genuine 40001 must
// recover/retry the SAME token/input once, then report uncertainty without a
// global failure write; PT409 must stop immediately.
async function edgeResponse(action, actualRpcError) {
 const calls = []; let handler, attempt, publicationInput, helperError;
 const db = {
  auth:{getUser:async () => ({data:{user:{id:'synthetic-owner'}}})},
  from:table => ({select:() => ({eq:() => ({maybeSingle:async () => ({data:table === 'profiles' ? {role:'owner',active:true} : {metadata:{synthetic:true}}})})})}),
  rpc:async (name,args) => {
   calls.push(name);
   if (name === 'recon_begin_attempt_v2') {
    const observed_at=new Date().toISOString();
    attempt={schema_version:2,outcome:'begun',request_id:args.p_request_id,kind:args.p_kind,
     attempt_id:'00000000-0000-4000-8000-000000000001',ordinal:1,observed_at,
     expires_at:new Date(Date.parse(observed_at)+120000).toISOString(),
     retain_until:new Date(Date.parse(observed_at)+600000).toISOString(),expected_config_revision:0};
    return {data:attempt,error:null};
   }
   if (name === 'get_reconeyez_integration_secrets') return {data:{username:'synthetic',password:'synthetic',webhook_secret:null,server_host:'synthetic.invalid',server_port:9028},error:null};
   if (name === 'recon_finish_inventory_v2') {
    assert.equal(args.p_attempt_id,attempt.attempt_id);
    const input=JSON.stringify(args);
    if(publicationInput===undefined)publicationInput=input;
    else assert.equal(input,publicationInput,'serialization recovery must retry the exact same publication input');
    return {data:null,error:actualRpcError};
   }
   if (name === 'recon_attempt_result_v2') {
    assert.equal(args.p_attempt_id,attempt.attempt_id);
    return {data:{schema_version:2,attempt_id:attempt.attempt_id,kind:attempt.kind,ordinal:attempt.ordinal,
     observed_at:attempt.observed_at,state:'pending',current:false,terminal:null},error:null};
   }
   throw Error('Unexpected synthetic RPC');
  }
 };
 const source = (await readFile(new URL('../../../../supabase/functions/reconeyez-connect/index.ts', import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'');
 const compiled = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const invokeRealHelper=async(...args)=>{
  try{return await syncReconInventory(...args);}catch(error){helperError=error;throw error;}
 };
 vm.runInNewContext(compiled, {
  exports:{},Request,Response,URL,btoa,AbortController,AbortSignal,TextEncoder,
  setTimeout,clearTimeout,crypto:globalThis.crypto??webcrypto,
  Deno:{env:{get:() => 'synthetic-only'},serve:fn => { handler = fn; }},
  createClient:() => db,syncReconInventory:invokeRealHelper,...owned,
  fetch:async () => new Response(JSON.stringify(list),{status:200})
 });
 const response = await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:JSON.stringify({action,username:'synthetic',password:'synthetic'})}));
 return {status:response.status,body:await response.json(),calls,helperError};
}

export async function runInventoryHttpContract({raw = process.env.RECON_INVENTORY_TEST_DATABASE_URL,
 binary = process.env.RECON_INVENTORY_TEST_POSTGREST_BINARY} = {}) {
 const url = validateInventoryTestUrl(raw);
 validatePostgrestBinary(binary); await access(binary, constants.X_OK);
 const binaryVersion = await new Promise((resolve, reject) => execFile(binary,['--version'],{timeout:3000},(error,stdout) => {
  const version = stdout?.match(/^PostgREST [\d.]+(?:[-+\w.]+)?/);
  if (error || !version) reject(Error('The local executable did not identify itself as PostgREST.'));
  else resolve(version[0]);
 }));
 const database = url.pathname.slice(1), adminUrl = new URL(url); adminUrl.pathname = '/postgres';
 const {default:pg} = await import('pg');
 const admin = new pg.Client({connectionString:adminUrl.href,application_name:'inventory_http_create'});
 const clients = []; const passes = []; let created = false,child,scratch,db,controller,baseUrl;
 const queryOne = async (client,sql,values = []) => (await client.query(sql,values)).rows[0];
 const snapshot = async () => {
  const rows = {};
  for (const table of ['camera_integrations','camera_devices','camera_health_current','camera_health_history','camera_integration_events','app_notifications'])
   rows[table] = (await queryOne(db,`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value FROM public.${table} t`)).value;
  rows.vault=(await queryOne(db,"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY name),'[]'::jsonb) AS value FROM vault.secrets t")).value;
  rows.vault_updates=(await queryOne(db,"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id,secret),'[]'::jsonb) AS value FROM vault.synthetic_updates t")).value;
  return rows;
 };
 const rpc = async (name,args) => {
  assert(['recon_begin_attempt_v2','recon_finish_inventory_v2','recon_attempt_result_v2','recon_fail_attempt_v2'].includes(name));
  const response = await fetch(baseUrl + '/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  return {status:response.status,body:await response.json()};
 };
 async function waitRowLock() {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
   const row = await queryOne(db,`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query LIKE '%recon_finish_inventory_v2%'`,[database]);
   if (row.count > 0) return;
   await delay(20);
  }
  throw Error('Expected the actual PostgREST RPC to wait on the controlled PostgreSQL row lock.');
 }
 try {
  await admin.connect();
  // Refuse to reuse a supplied name; teardown drops only a database this run created.
  await admin.query('CREATE DATABASE "' + database + '" TEMPLATE template0 ENCODING \'UTF8\''); created = true;
  for (const name of ['setup','controller']) {
   const client = new pg.Client({connectionString:url.href,application_name:'inventory_http_' + name});
   await client.connect(); clients.push(client);
   await client.query("SET statement_timeout='12s'; SET lock_timeout='8s'; SET time zone 'UTC'");
  }
  [db,controller] = clients;
  const version = (await queryOne(db,'SHOW server_version')).server_version;
  assert(Number((await queryOne(db,'SHOW server_version_num')).server_version_num) >= 170000,'requires actual PostgreSQL17 or newer');
  let schema = await readFile(new URL('schema.sql',import.meta.url),'utf8');
  schema = schema.replace(/CREATE ROLE (anon|authenticated|service_role) NOLOGIN(?: BYPASSRLS)?;/g,(_,role) =>
   `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN${role === 'service_role' ? ' BYPASSRLS' : ''}; END IF; END $$;`);
  await db.query(schema);
  // Shared synthetic-only transactional Vault fixture. No real Vault extension,
  // project credentials or production data are read by this harness.
  await db.query(await readFile(new URL('../../../tests/fixtures/recon-v2/synthetic-vault-integration.sql',import.meta.url),'utf8'));
  const legacy=await readFile(new URL('../../../../supabase/migrations/20260923_reconeyez_camera_integration.sql',import.meta.url),'utf8');
  const credentialStart=legacy.indexOf('create or replace function public.save_reconeyez_credentials(');
  const credentialEnd=legacy.indexOf('create or replace function public.get_reconeyez_integration_secrets()');
  assert(credentialStart>=0&&credentialEnd>credentialStart,'legacy synthetic Vault authority fixture was not found');
  await db.query(legacy.slice(credentialStart,credentialEnd));
  await db.query(await readFile(new URL('../../../../database-maintenance/reconeyez-inventory-sync.sql',import.meta.url),'utf8'));
  // Seed before installing the fail-closed coordinated-v2 integration guard.
  await db.query("INSERT INTO public.camera_integrations(provider,server_host,server_port,enabled,metadata) VALUES('reconeyez','synthetic.invalid',9028,true,'{\"unrelated\":true}')");
  for(const name of ['reconeyez-owned-metadata-v2.sql','reconeyez-receipt-v2.sql'])
   await db.query(await readFile(new URL('../../../../database-maintenance/'+name,import.meta.url),'utf8'));
  await db.query(`CREATE FUNCTION public.inventory_http_target_v2() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT pg_catalog.current_database() $$;
   REVOKE ALL ON FUNCTION public.inventory_http_target_v2() FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.inventory_http_target_v2() TO service_role;`);
  // Scoped only to this new disposable DB; never alter shared role settings.
  await db.query("ALTER FUNCTION public.recon_finish_inventory_v2(uuid,jsonb,jsonb,integer,integer,text,text) SET default_transaction_isolation TO 'serializable'");
  const port = await availablePort(); baseUrl = 'http://127.0.0.1:' + port;
  scratch = await mkdtemp(fileURLToPath(new URL('../../../../../work/inventory-http-',import.meta.url)));
  const configPath = join(scratch,'postgrest.conf');
  // JSON quoting produces a compatible quoted config string without shell evaluation.
  await writeFile(configPath,[`db-uri = ${JSON.stringify(url.href)}`,'db-schemas = "public"','db-anon-role = "service_role"','db-config = false','db-pool = 2','server-host = "127.0.0.1"',`server-port = ${port}`,'log-level = "error"'].join('\n') + '\n',{mode:0o600});
  const childEnv = {...process.env};
  for (const key of Object.keys(childEnv)) if (key.startsWith('PGRST_')) delete childEnv[key];
  child = spawn(binary,[configPath],{env:childEnv,stdio:['ignore','ignore','pipe']});
  let childError; child.on('error',error => { childError = error; });
  // Drain logs without printing connection strings or inherited environment values.
  child.stderr.resume();
  const until = Date.now() + 10000; let ready = false;
  while (Date.now() < until) {
   if (childError) throw childError;
   if (child.exitCode !== null) throw Error('Local PostgREST exited before readiness.');
   try {
    // Confirm the dynamically chosen endpoint serves this fresh database before
    // any mutating HTTP request; a port-allocation race cannot target another service.
    const probe = await fetch(baseUrl + '/rpc/inventory_http_target_v2',{signal:AbortSignal.timeout(300)});
    if (probe.ok && await probe.json() === database) { ready = true; break; }
   } catch {}
   await delay(30);
  }
  assert(ready,'local PostgREST did not become ready');
  const begin=async()=>{
   const requestId=randomUUID(),response=await rpc('recon_begin_attempt_v2',{p_request_id:requestId,p_kind:'inventory_sync'});
   assert.equal(response.status,200);
   return owned.validateReconBegin(response.body,{requestId,kind:'inventory_sync'});
  };
  const finishArgs=async(token,resources=list)=>{
   const {p_observed_at,...args}=await prepareReconInventory(resources,token.observed_at);
   return {p_attempt_id:token.attempt_id,...args};
  };
  const older=await begin(),newer=await begin();
  const initial=await finishArgs(newer);
  const applied=await rpc('recon_finish_inventory_v2',initial);
  assert.equal(applied.status,200);assert.equal(applied.body.outcome,'applied');
  const before=await snapshot();let conflictError;
  // V2 orders distinct attempts by DB ordinal. Equal-token identical input is
  // idempotent; conflicting equal-token input and older success are PT409.
  const altered=list.map(row=>({...row,...(row.type.startsWith('detector')?{name:row.name+' changed'}:{})}));
  for(const args of [await finishArgs(older),await finishArgs(newer,altered)]) {
   const response=await rpc('recon_finish_inventory_v2',args);
   assert.equal(response.status,409); assert.equal(response.body.code,'PT409');
   assert.equal(response.body.message,'Reconeyez inventory refresh was superseded.');
   assert.deepEqual(await snapshot(),before); conflictError = response.body;
  }
  const replay=await rpc('recon_finish_inventory_v2',initial);
  assert.equal(replay.status,200);assert.equal(replay.body.outcome,'duplicate');
  assert.equal(replay.body.input_fingerprint,applied.body.input_fingerprint);
  assert.deepEqual(replay.body.result,applied.body.result);assert.deepEqual(await snapshot(),before);
  passes.push('actual v2 HTTP stale/equal-conflicting successes return409/PT409; identical replay is200 without renewal');
  const serializationToken=await begin(),args=await finishArgs(serializationToken);
  const beforeSerialization=await snapshot();
  await controller.query('BEGIN');
  await controller.query("UPDATE public.camera_integrations SET metadata=metadata||'{\"synthetic_concurrent_control\":true}'::jsonb WHERE provider='reconeyez'");
  const pending = settle(rpc('recon_finish_inventory_v2',args)); await waitRowLock();
  await controller.query('COMMIT');
  const result = await pending; assert.ifError(result.error);
  assert.equal(result.value.status,500); assert.equal(result.value.body.code,'40001');
  const afterSerialization = await snapshot();
  for (const table of ['camera_devices','camera_health_current','camera_health_history','camera_integration_events','app_notifications','vault','vault_updates'])
   assert.deepEqual(afterSerialization[table],beforeSerialization[table]);
  assert.equal(afterSerialization.camera_integrations[0].last_sync_at,beforeSerialization.camera_integrations[0].last_sync_at);
  assert.deepEqual(afterSerialization.camera_integrations[0].metadata.identity_inventory_v1,beforeSerialization.camera_integrations[0].metadata.identity_inventory_v1);
  assert.deepEqual(afterSerialization.camera_integrations[0].metadata.recon_attempt_state_v2,beforeSerialization.camera_integrations[0].metadata.recon_attempt_state_v2);
  passes.push('actual PostgreSQL serialization conflict through guarded v2 HTTP RPC remains500/40001 with pending token');
  for (const action of ['connect','sync']) {
   const conflict = await edgeResponse(action,conflictError);
   assert.equal(conflict.status,409); assert.equal(conflict.body.code,'PT409');
   assert(conflict.helperError instanceof owned.ReconOwnedConflict);
   assert.equal(conflict.calls.filter(name => name === 'recon_begin_attempt_v2').length,1);
   assert.equal(conflict.calls.filter(name => name === 'recon_finish_inventory_v2').length,1);
   assert(!conflict.calls.includes('recon_fail_attempt_v2'));
   assert(!conflict.calls.includes('recon_attempt_result_v2'));
   const serialization = await edgeResponse(action,result.value.body);
   assert.equal(serialization.status,502); assert.equal(serialization.body.code,undefined);
   assert(serialization.helperError instanceof owned.ReconOwnedUnknown);
   assert.equal(serialization.helperError.databaseCode,'40001');
   assert.equal(serialization.calls.filter(name => name === 'recon_begin_attempt_v2').length,1);
   assert.equal(serialization.calls.filter(name => name === 'recon_finish_inventory_v2').length,2);
   assert.equal(serialization.calls.filter(name => name === 'recon_attempt_result_v2').length,2);
   assert(!serialization.calls.includes('recon_fail_attempt_v2'));
   assert(!serialization.calls.includes('save_reconeyez_credentials'));
  }
  passes.push('actual HTTP error JSON preserves synthetic SDK/transpiled Edge409 versus502;40001 recovers same token, never invents failure');
  console.log('PostgreSQL ' + version + '; ' + binaryVersion + '; actual loopback HTTP SQL gate plus separately labeled synthetic SDK/transpiled Edge adapters (not Deno).');
  for (const name of passes) console.log('PASS ' + name);
  return passes;
 } finally {
  await stopChild(child);
  for (const client of clients) await client.query('ROLLBACK').catch(() => {});
  await Promise.all(clients.map(client => client.end()));
  if (created) await admin.query('DROP DATABASE "' + database + '"');
  await admin.end(); if (scratch) await rm(scratch,{recursive:true,force:true});
 }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await runInventoryHttpContract();
