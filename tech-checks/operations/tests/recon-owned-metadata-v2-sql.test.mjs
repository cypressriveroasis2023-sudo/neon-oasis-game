/** Actual proposed SQL, in-process PGlite and synthetic Vault/auth only.
 * These serialized interleavings are not PostgreSQL contention or HTTP proof.
 * C01–C03/C20–C24/C27 actual PG/HTTP/full-webhook gates remain pending.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,inventoryInput,diagnostics,family,uuid,gid,old,proposalSql,sqlSourceHashes} from './fixtures/recon-owned-metadata-v2.mjs';

const manifestBytes=await readFile(new URL('../../database-maintenance/reconeyez-owned-metadata-v2-acl.json',import.meta.url),'utf8');
const aclManifest=JSON.parse(manifestBytes);
console.log('Exact callable/trigger ACL manifest SHA256: '+createHash('sha256').update(manifestBytes).digest('hex'));
const beginKeys=['schema_version','outcome','request_id','kind','attempt_id','ordinal','observed_at','expires_at','retain_until','expected_config_revision'];
const finishKeys=['schema_version','attempt_id','kind','ordinal','observed_at','outcome','applied','terminal_outcome','current','input_fingerprint','reason_code','result'];
const resultKeys=['schema_version','attempt_id','kind','ordinal','observed_at','state','current','terminal'];
const receiptKeys=['schema_version','event_id','receipt_started_at','outcome','applied'];
const keys=(object,expected)=>assert.deepEqual(Object.keys(object).sort(),[...expected].sort());
const denied=(promise,code='PT409')=>assert.rejects(promise,error=>{assert.equal(error.code,code);return true});
const withFixture=(name,run,options)=>test(name,async t=>{const f=await fixture(options);try{await run(f,t)}finally{await f.close()}});
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const digest=value=>createHash('sha256').update(canonical(value),'utf8').digest('hex');
const state=row=>row.metadata.recon_attempt_state_v2;
const assertToken=(token,kind='inventory_sync')=>{
 keys(token,beginKeys);assert.equal(token.schema_version,2);assert.equal(token.kind,kind);assert.equal(token.outcome,'begun');
 assert.match(token.attempt_id,/^[0-9a-f-]{36}$/);assert(Number.isSafeInteger(token.ordinal)&&token.ordinal>0);
 assert.equal(Date.parse(token.expires_at)-Date.parse(token.observed_at),kind==='receiver_test'?60000:120000);
 assert.equal(Date.parse(token.retain_until)-Date.parse(token.observed_at),600000);
};
const assertTerminal=(value,token,outcome='success')=>{
 keys(value,finishKeys);assert.equal(value.schema_version,2);assert.equal(value.attempt_id,token.attempt_id);assert.equal(value.kind,token.kind);
 assert.equal(value.ordinal,token.ordinal);assert.equal(value.observed_at,token.observed_at);assert.equal(value.terminal_outcome,outcome);
 assert.match(value.input_fingerprint,/^[0-9a-f]{64}$/);
};
// Compare exact instants, not host-timezone spellings; microseconds remain strict.
import {timestampMicros as timestampKey} from './fixtures/recon-timestamp-micros.mjs';
const assertProof=(row,input,token)=>{assert.deepEqual(row.metadata.identity_inventory_v1,input.p_identity_inventory);assert.equal(timestampKey(row.last_sync_at),timestampKey(token.observed_at));assert.equal(row.last_sync_status,'ok');assert.equal(row.last_error,null)};
const receipt=(f,id)=>f.rpc('recon_record_webhook_receipt_v2',{p_event_id:id});
const ack=(f,token,id)=>f.rpc('recon_finish_receiver_ack_v2',{p_attempt_id:token.attempt_id,p_event_id:id});

withFixture('C08/C11: begin is stable, bounded, closed and does not publish status/proof',async f=>{
 const before=await f.integration(),a=await f.begin();assertToken(a);
 const row=await f.integration();for(const key of ['enabled','last_sync_at','last_sync_status','last_error','recon_config_revision'])assert.deepEqual(row[key],before[key],key);
 for(const [key,value]of Object.entries(before.metadata))assert.deepEqual(row.metadata[key],value,key);
 const duplicate=await f.begin('inventory_sync',a.request_id);keys(duplicate,beginKeys);assert.deepEqual(duplicate,{...a,outcome:'duplicate'});
 await denied(f.begin('receiver_test',a.request_id));
 const b=await f.begin();assert(b.ordinal>a.ordinal);const input=await inventoryInput(a.observed_at);await f.finish(a,input);assertProof(await f.integration(),input,a);
 const pending=await f.lookup(b);keys(pending,resultKeys);assert.equal(pending.state,'pending');assert.equal(pending.terminal,null);
});

withFixture('C09/C13: a newer completed failure orders stale success before any device writes',async f=>{
 const a=await f.begin(),b=await f.begin(),failure=await f.failure(b);
 assertTerminal(failure,b,'failure');assert.equal(failure.reason_code,'provider_unavailable');assert.equal(failure.result,null);
 const before=await f.snapshot();await denied(f.finish(a,await inventoryInput(a.observed_at)));assert.deepEqual(await f.snapshot(),before);
 await denied(f.finish(b,await inventoryInput(b.observed_at)));assert.deepEqual(await f.snapshot(),before);
 const oldFailure=await f.failure(a);keys(oldFailure,finishKeys);assert.equal(oldFailure.outcome,'superseded');assert.equal(oldFailure.terminal_outcome,null);assert.equal(oldFailure.input_fingerprint,null);assert.equal(oldFailure.result,null);assert.equal(oldFailure.current,false);
 assert.deepEqual(await f.snapshot(),before);
});

withFixture('C07/C12/C13: compact success replays survive newer completions; failure cannot replace success',async f=>{
 const a=await f.begin(),input=await inventoryInput(a.observed_at),applied=await f.finish(a,input);assertTerminal(applied,a);
 assert.equal(applied.outcome,'applied');assert.equal(applied.applied,true);assert.equal(applied.current,true);
 keys(applied.result,['imported','active','shop','skipped_non_detectors']);assert.deepEqual(applied.result,{imported:2,active:2,shop:0,skipped_non_detectors:1});
 const once=await f.snapshot(),duplicate=await f.finish(a,input);assert.deepEqual(duplicate,{...applied,outcome:'duplicate',applied:false});assert.deepEqual(await f.snapshot(),once);
 const failure=await f.failure(a);assert.deepEqual(failure,duplicate);assert.deepEqual(await f.snapshot(),once);
 const b=await f.begin();await f.failure(b,'source_read_failed');const current=await f.snapshot();
 const historical=await f.finish(a,input);assert.deepEqual(historical,{...duplicate,current:false});assert.deepEqual(await f.snapshot(),current);
 const lookup=await f.lookup(a);keys(lookup,resultKeys);assert.equal(lookup.state,'success');assert.equal(lookup.current,false);assert.deepEqual(lookup.terminal,historical);
 const different=structuredClone(input);different.p_devices[0].device_name='Different validated name';await denied(f.finish(a,different));assert.deepEqual(await f.snapshot(),current);
});

withFixture('inventory mutates identity without renewing independent camera, battery, or health clocks',async f=>{
 const metadata={guid:gid(2),area:'Synthetic Field',description:'Old',reconeyez_type:'detector_hdr_xrl',battery_percent:22,battery_updated_at:old,battery_status_updated_at:old,last_event_at:old,custom:{preserve:true}};
 await f.db.query(`INSERT INTO public.camera_devices(id,device_serial,external_device_id,device_name,source,monitoring_profile,expected_ports,unit_key,organization,activation_state,source_status,source_last_seen_at,last_health_checked_at,last_online_at,last_probe_online_at,source_metadata)
 VALUES(101,$1,$2,'Synthetic saved detector','reconeyez','camv',ARRAY[9028],'Synthetic Field','Manual','active','offline',$3,$3,$3,$3,$4)`,['reconeyez:'+gid(2),gid(2),old,metadata]);
 await f.db.query(`INSERT INTO public.camera_health_current(camera_device_id,overall_status,checked_at,detail) VALUES(101,'offline',$1,'Synthetic unchanged health')`,[old]);
 const before=await f.snapshot(),a=await f.begin(),input=await inventoryInput(a.observed_at);await f.finish(a,input);const after=await f.snapshot();
 const prior=before.camera_devices.find(row=>row.id===101),current=after.camera_devices.find(row=>row.id===101);
 for(const key of ['source_status','source_last_seen_at','last_health_checked_at','last_online_at','last_probe_online_at'])assert.deepEqual(current[key],prior[key],key);
 for(const key of ['battery_percent','battery_updated_at','battery_status_updated_at','last_event_at','custom'])assert.deepEqual(current.source_metadata[key],prior.source_metadata[key],key);
 assert.deepEqual(after.camera_health_current.find(row=>row.camera_device_id===101),before.camera_health_current[0]);
 assert.equal(after.camera_health_history.length,before.camera_health_history.length);assertProof((await f.integration()),input,a);
});

for(const change of ["enabled=false","server_host='new-synthetic.invalid',server_port=9030"]){
 withFixture('C34/C35: intervening config '+change+' blocks publication and old failures',async f=>{
  const a=await f.begin('inventory_connect'),input=await inventoryInput(a.observed_at);await f.db.exec('UPDATE public.camera_integrations SET '+change+" WHERE provider='reconeyez'");
  await f.db.exec("UPDATE vault.synthetic_faults SET fail_name='reconeyez_username'");const before=await f.snapshot();await denied(f.rpc('recon_finish_inventory_v2',{p_attempt_id:a.attempt_id,...input,p_username:'synthetic-new-user',p_password:'synthetic-new-password'}));assert.deepEqual(await f.snapshot(),before);
  const result=await f.failure(a);assert.equal(result.outcome,'superseded');assert.equal(result.reason_code,'configuration_changed');assert.deepEqual(await f.snapshot(),before);
 });
}

withFixture('C36: same-ID credential updates advance revision and supersede old attempt before a second Vault write',async f=>{
 await f.rpc('save_reconeyez_credentials',{p_username:'synthetic-old-user',p_password:'synthetic-old-password'});
 const oldConfig=await f.integration(),a=await f.begin('inventory_connect');
 await f.rpc('save_reconeyez_credentials',{p_username:'synthetic-new-user',p_password:'synthetic-new-password'});const changed=await f.integration();
 for(const key of ['username_secret_id','password_secret_id','webhook_secret_id'])assert.equal(changed[key],oldConfig[key]);assert(changed.recon_config_revision>oldConfig.recon_config_revision);
 await f.db.exec("UPDATE vault.synthetic_faults SET fail_name='reconeyez_username'");const before=await f.snapshot();await denied(f.rpc('recon_finish_inventory_v2',{p_attempt_id:a.attempt_id,...await inventoryInput(a.observed_at),p_username:'synthetic-stale-user',p_password:'synthetic-stale-password'}));assert.deepEqual(await f.snapshot(),before);
 assert.equal((await f.failure(a)).outcome,'superseded');assert.deepEqual(await f.snapshot(),before);
});

withFixture('C37: initially disabled inventory success retains auto-enable and original host/port',async f=>{
 const before=await f.integration(),a=await f.begin(),input=await inventoryInput(a.observed_at);await f.finish(a,input);const after=await f.integration();
 assert.equal(after.enabled,true);assert.equal(after.server_host,before.server_host);assert.equal(after.server_port,before.server_port);assert(after.recon_config_revision>before.recon_config_revision);assertProof(after,input,a);
 const duplicate=await f.finish(a,input);assert.equal(duplicate.outcome,'duplicate');assert.equal(duplicate.current,true);
},{enabled:false});

withFixture('C31/C32/C33: absent begin creates nothing; CAS commits once and different creator loses before Vault',async f=>{
 const initial=await f.snapshot(),a=await f.begin('inventory_connect'),b=await f.begin('inventory_connect');
 keys(a,beginKeys);assert.equal(a.outcome,'absent');assert.equal(a.attempt_id,null);assert.equal(a.ordinal,null);assert.equal(a.expected_config_revision,null);assert.deepEqual(await f.snapshot(),initial);
 const input=await inventoryInput(a.observed_at),applied=await f.create(a,input);assert.equal(applied.kind,'inventory_connect');assert.equal(applied.attempt_id,a.request_id);assert.equal(applied.observed_at,a.observed_at);
 const committed=await f.snapshot();assert.equal(committed.vault.length,3);assertProof(await f.integration(),input,a);
 const duplicate=await f.create(a,input);assert.deepEqual(duplicate,{...applied,outcome:'duplicate',applied:false});assert.deepEqual(await f.snapshot(),committed);
 await f.db.exec("UPDATE vault.synthetic_faults SET fail_name='reconeyez_username'");await denied(f.create(b,await inventoryInput(b.observed_at)));assert.deepEqual(await f.snapshot(),committed);
 // An absent request has no attempt token; a late provider error cannot publish to the winner.
 await denied(f.rpc('recon_fail_attempt_v2',{p_attempt_id:b.request_id,p_reason_code:'provider_unavailable'}));assert.deepEqual(await f.snapshot(),committed);
},{absent:true});

for(const stage of ['vault','device','health','proof','terminal']){
 withFixture('C26/C33: initial creation '+stage+' failure rolls back integration, Vault, devices and result',async f=>{
  const a=await f.begin('inventory_connect'),input=await inventoryInput(a.observed_at);
  if(stage==='vault')await f.db.exec("UPDATE vault.synthetic_faults SET fail_name='reconeyez_password'");
  else if(stage==='device'||stage==='health')await f.db.exec(`CREATE FUNCTION public.synthetic_device_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic projection failure';END$$;
   CREATE TRIGGER synthetic_device_failure BEFORE INSERT ON public.${stage==='device'?'camera_devices':'camera_health_current'} FOR EACH ROW EXECUTE FUNCTION public.synthetic_device_failure()`);
  else await f.db.exec(`CREATE FUNCTION public.synthetic_publication_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
   IF ${stage==='proof'?"NEW.metadata ? 'identity_inventory_v1'":"NEW.metadata->'recon_attempt_state_v2'->'records'->0->'terminal'->>'outcome'='success'"} THEN RAISE EXCEPTION 'Synthetic publication storage failure';END IF;RETURN NEW;END$$;
   CREATE TRIGGER synthetic_publication_failure BEFORE UPDATE ON public.camera_integrations FOR EACH ROW EXECUTE FUNCTION public.synthetic_publication_failure()`);
  const before=await f.snapshot();await assert.rejects(f.create(a,input),/Synthetic/);assert.deepEqual(await f.snapshot(),before);assert.equal(await f.integration(),undefined);
 },{absent:true});
}

withFixture('C27 injected SQLSTATE only:40001 propagates distinctly and rolls back the whole finish',async f=>{
 const a=await f.begin(),input=await inventoryInput(a.observed_at);await f.db.exec(`CREATE FUNCTION public.synthetic_serialization_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Synthetic serialization class injection';END$$;
  CREATE TRIGGER synthetic_serialization_failure BEFORE INSERT ON public.camera_devices FOR EACH ROW EXECUTE FUNCTION public.synthetic_serialization_failure()`);
 const before=await f.snapshot();await denied(f.finish(a,input),'40001');assert.deepEqual(await f.snapshot(),before);
});

withFixture('C28: legacy protected snapshots, direct status writes, row deletion and provider renaming fail closed',async f=>{
 const a=await f.begin();await f.finish(a,await inventoryInput(a.observed_at));const before=await f.snapshot();
 for(const query of ["UPDATE public.camera_integrations SET last_sync_status='failed'",`UPDATE public.camera_integrations SET metadata=metadata||'{"receiver_tested_at":"2026-10-10T12:00:00Z"}'::jsonb`,"DELETE FROM public.camera_integrations WHERE provider='reconeyez'","UPDATE public.camera_integrations SET provider='synthetic-other'"]){
  await assert.rejects(f.db.exec(query));assert.deepEqual(await f.snapshot(),before);
 }
 await f.db.exec("UPDATE public.camera_integrations SET metadata=metadata||'{\"unknown_future_key\":true}'::jsonb,server_port=9030");assert.equal((await f.integration()).metadata.unknown_future_key,true);
});

withFixture('C29: all29 callables and2 triggers match exact manifest, owner, invoker and effective/browser ACL contract',async f=>{
 assert.deepEqual(Object.fromEntries(Object.entries(aclManifest.source_sql_sha256).map(([path,hash])=>[path.split('/').at(-1),hash])),sqlSourceHashes,'manifest describes the exact loaded SQL bytes');
 const functions=[...aclManifest.callable_functions,...aclManifest.trigger_functions];
 const declarations=Object.values(proposalSql).flatMap(sql=>[...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/g)].map(match=>match[1])).filter(name=>name!=='save_reconeyez_credentials');assert.deepEqual(declarations.sort(),functions.map(row=>row.name).sort(),'all new declarations included in manifest');assert.equal(aclManifest.callable_functions.length,29);assert.equal(aclManifest.trigger_functions.length,2);assert.equal(functions.filter(row=>row.category==='input_only_helper').length,20);assert.equal(functions.filter(row=>row.category==='caller_api').length,9);
 const rows=(await f.db.query(`SELECT p.oid,p.proname,p.proowner,p.prosecdef,p.prorettype AS return_oid,
  has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service,has_function_privilege('service_role',p.oid,'EXECUTE WITH GRANT OPTION') service_grant_option,
  has_function_privilege(p.proowner,p.oid,'execute') owner_exec,oidvectortypes(p.proargtypes) argtypes
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND left(p.proname,6)='recon_'`)).rows;
 const expectedOids=(await f.db.query("SELECT (value->>'identity_signature')::regprocedure::oid AS oid FROM jsonb_array_elements($1::jsonb)",[functions])).rows.map(row=>row.oid).sort((a,b)=>a-b);
 assert.equal(rows.length,31);assert.deepEqual(rows.map(row=>row.oid).sort((a,b)=>a-b),expectedOids);
 for(const descriptor of functions){
  const row=rows.find(row=>row.proname===descriptor.name),trigger=descriptor.category==='trigger_runtime_routine';
  assert.equal(row.proowner,f.installerIdentity.oid,descriptor.identity_signature+' installer ownership');assert.equal(row.prosecdef,false,descriptor.identity_signature);assert.equal(row.return_oid,await f.scalar('SELECT $1::regtype::oid AS value',[descriptor.returns]),descriptor.identity_signature);
  assert.deepEqual({anon:row.anon,authenticated:row.authenticated,service:row.service},{anon:false,authenticated:false,service:!trigger},descriptor.identity_signature);assert.equal(row.owner_exec,true,'owners retain administrative EXECUTE capability');assert.equal(row.service_grant_option,false,descriptor.identity_signature+' nonowner service cannot delegate');
  const acl=(await f.db.query(`SELECT a.grantee,a.privilege_type,a.is_grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1 AND a.privilege_type='EXECUTE'`,[row.oid])).rows;
  const serviceOid=Number(await f.scalar("SELECT oid::integer AS value FROM pg_roles WHERE rolname='service_role'"));assert.deepEqual(acl.map(value=>Number(value.grantee)).sort((a,b)=>a-b),[Number(row.proowner),...trigger?[]:[serviceOid]].sort((a,b)=>a-b),descriptor.identity_signature+' raw ACL');
  const nonnull={uuid:"'00000000-0000-4000-8000-000000000001'::uuid",text:"'synthetic'::text",jsonb:"'{}'::jsonb",'text[]':"ARRAY['synthetic']::text[]",'timestamp with time zone':"'2026-01-01T00:00:00Z'::timestamptz",integer:'1::integer',bigint:'1::bigint',numeric:'1::numeric',boolean:'true'};
  for(const entry of acl)if(Number(entry.grantee)!==Number(row.proowner))assert.equal(entry.is_grantable,false,descriptor.identity_signature+' raw nonowner grant option');
  const unexpected=(await f.db.query(`SELECT r.rolname FROM pg_roles r WHERE NOT r.rolsuper AND r.oid<>$1 AND ($2::boolean OR r.rolname<>'service_role') AND has_function_privilege(r.oid,$3,'EXECUTE')`,[row.proowner,trigger,row.oid])).rows;assert.deepEqual(unexpected,[],descriptor.identity_signature+' inherited effective callers');
  const direct=`SELECT public.${row.proname}(${row.argtypes?row.argtypes.split(', ').map(type=>{assert(nonnull[type],type);return nonnull[type]}).join(','):''})`;
  for(const role of ['anon','authenticated',...trigger?['service_role']:[]])await assert.rejects(f.db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE '+role);return tx.query(direct);}),error=>error.code==='42501',descriptor.identity_signature+' as '+role);
 }
 assert.equal(f.installerIdentity.rolsuper,true,'fixture installer is administrative; no only-service claim against owner/superuser');
 const credentialIdentity=(await f.db.query("SELECT proowner,proacl::text,prosecdef FROM pg_proc WHERE oid='public.save_reconeyez_credentials(text,text)'::regprocedure")).rows[0];assert.deepEqual(credentialIdentity,f.legacyCredentialIdentity);
 // Trigger firing is permitted without ordinary service EXECUTE, and guards still enforce ownership.
 const a=await f.begin();await f.finish(a,await inventoryInput(a.observed_at));const event=await f.audit();assert.equal((await receipt(f,event)).outcome,'applied');
 await denied(f.db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');return tx.exec("UPDATE public.camera_integrations SET last_sync_status='forged'");}));
});

withFixture('C29: every one of20 input-only helper EXECUTE grants is required by an intended invoker API',async(f,t)=>{
 const older=await f.begin(),published=await f.begin();await f.finish(published,await inventoryInput(published.observed_at));
 const inventory=await f.begin(),inventoryArgs=await inventoryInput(inventory.observed_at),reconcile=await f.begin('inventory_reconcile'),reconcileArgs=await reconcileInput(reconcile);Object.assign(reconcileArgs.p_diagnostics,{matched_local_detectors:2,unmatched_provider_detectors:0,local_active:2});
 const failure=await f.begin(),baseline=await f.snapshot();
 const inventoryNames=new Set(['recon_v2_check_result','recon_v2_digest','recon_v2_config_matches','recon_v2_validate_identity','recon_v2_validate_devices','recon_v2_enrich_identity']);
 for(const descriptor of aclManifest.callable_functions.filter(row=>row.category==='input_only_helper'))await t.test(descriptor.identity_signature,async()=>{
  await f.db.exec('REVOKE EXECUTE ON FUNCTION '+descriptor.identity_signature+' FROM service_role');
  try{
   const request=descriptor.name==='recon_v2_validate_diagnostics'?f.rpc('recon_finish_reconcile_v2',reconcileArgs):descriptor.name==='recon_v2_safe_error'?f.failure(failure):descriptor.name==='recon_v2_superseded'?f.failure(older):['recon_v2_current','recon_v2_finish_response'].includes(descriptor.name)?f.lookup(published):inventoryNames.has(descriptor.name)?f.finish(inventory,inventoryArgs):f.begin();
   await denied(request,'42501');assert.deepEqual(await f.snapshot(),baseline);
  }finally{await f.db.exec('GRANT EXECUTE ON FUNCTION '+descriptor.identity_signature+' TO service_role');}
 });
});

async function installExactV2(f){for(const sql of Object.values(proposalSql))await f.db.exec(sql);}
async function deniedInstallation(f,source=proposalSql['reconeyez-owned-metadata-v2.sql']){
 const before=await f.snapshot(),authority=f.legacyCredentialIdentity,defaults=(await f.db.query('SELECT * FROM pg_default_acl ORDER BY oid')).rows,memberships=(await f.db.query('SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member')).rows;
 await assert.rejects(f.db.exec(source),error=>['42501','P0001'].includes(error.code));await f.db.exec('ROLLBACK');assert.deepEqual(await f.snapshot(),before);
 assert.deepEqual((await f.db.query('SELECT * FROM pg_default_acl ORDER BY oid')).rows,defaults);assert.deepEqual((await f.db.query('SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member')).rows,memberships);
 assert.deepEqual((await f.db.query("SELECT proowner,proacl::text,prosecdef FROM pg_proc WHERE oid='public.save_reconeyez_credentials(text,text)'::regprocedure")).rows[0],authority);
}
withFixture('C29: unexpected custom default EXECUTE fails closed and leaves owner/defaults/memberships untouched',async f=>{
 await f.db.exec('CREATE ROLE synthetic_recon_acl_reader NOLOGIN;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO synthetic_recon_acl_reader');await deniedInstallation(f);
},{installV2:false});
for(const inheritor of ['authenticated','synthetic_recon_acl_reader'])withFixture('C29: inherited service EXECUTE by '+inheritor+' fails closed without membership repair',async f=>{
 if(inheritor.startsWith('synthetic_'))await f.db.exec('CREATE ROLE '+inheritor+' NOLOGIN INHERIT');await f.db.exec('GRANT service_role TO '+inheritor);await deniedInstallation(f);
},{installV2:false});
withFixture('C29: service inheritance from trigger owner fails closed despite explicit direct revocation',async f=>{
 await f.db.exec(`CREATE ROLE synthetic_recon_trigger_owner NOLOGIN;GRANT USAGE,CREATE ON SCHEMA public TO synthetic_recon_trigger_owner;
  CREATE FUNCTION public.recon_owned_integration_guard_v2() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;
  ALTER FUNCTION public.recon_owned_integration_guard_v2() OWNER TO synthetic_recon_trigger_owner;GRANT synthetic_recon_trigger_owner TO service_role`);
 const owner=(await f.db.query("SELECT proowner FROM pg_proc WHERE oid='public.recon_owned_integration_guard_v2()'::regprocedure")).rows[0].proowner;await deniedInstallation(f);assert.equal((await f.db.query("SELECT proowner FROM pg_proc WHERE oid='public.recon_owned_integration_guard_v2()'::regprocedure")).rows[0].proowner,owner);
},{installV2:false});
withFixture('C29: browser default grants are revoked on exact new signatures while default policy itself is preserved',async f=>{
 await f.db.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated');const defaults=(await f.db.query('SELECT * FROM pg_default_acl ORDER BY oid')).rows;await installExactV2(f);
 assert.deepEqual((await f.db.query('SELECT * FROM pg_default_acl ORDER BY oid')).rows,defaults);
 for(const descriptor of [...aclManifest.callable_functions,...aclManifest.trigger_functions])assert.equal(await f.scalar("SELECT has_function_privilege('authenticated',$1::regprocedure,'EXECUTE') AS value",[descriptor.identity_signature]),false,descriptor.identity_signature);
},{installV2:false});

for(const sourceName of ['reconeyez-owned-metadata-v2.sql','reconeyez-receipt-v2.sql'])for(const variant of ['preexisting','default','inherited_owner'])withFixture('C29: '+sourceName+' rejects '+variant+' service EXECUTE grant option without authority repair',async f=>{
 const receiptSource=sourceName==='reconeyez-receipt-v2.sql';if(receiptSource)await f.db.exec(proposalSql['reconeyez-owned-metadata-v2.sql']);
 const signature=receiptSource?'public.recon_record_webhook_receipt_v2(bigint)':'public.recon_v2_time(timestamptz)';
 if(variant==='default')await f.db.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role WITH GRANT OPTION');
 else{
  const declaration=receiptSource?"public.recon_record_webhook_receipt_v2(p_event_id bigint) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$":"public.recon_v2_time(p_time timestamptz) RETURNS text LANGUAGE sql AS $$SELECT 'synthetic'::text$$";
  await f.db.exec('CREATE FUNCTION '+declaration);
  if(variant==='preexisting')await f.db.exec('GRANT EXECUTE ON FUNCTION '+signature+' TO service_role WITH GRANT OPTION');
  else await f.db.exec('CREATE ROLE synthetic_recon_callable_owner NOLOGIN;GRANT USAGE,CREATE ON SCHEMA public TO synthetic_recon_callable_owner;ALTER FUNCTION '+signature+' OWNER TO synthetic_recon_callable_owner;GRANT synthetic_recon_callable_owner TO service_role');
 }
 const prior=variant==='default'?null:(await f.db.query('SELECT proowner,proacl::text FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0];
 assert.equal(await f.scalar("SELECT has_function_privilege('service_role',$1::regprocedure,'EXECUTE WITH GRANT OPTION') AS value",[variant==='default'?'public.save_reconeyez_credentials(text,text)':signature]),variant==='default'?false:true);
 await deniedInstallation(f,proposalSql[sourceName]);if(prior)assert.deepEqual((await f.db.query('SELECT proowner,proacl::text FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0],prior);
},{installV2:false});

withFixture('canonical JS and SQL hashes include every escaped/multibyte owned input value',async f=>{
 for(const value of [null,{z:['á','漢字','"\\\n',0,true,null],a:{z:2,a:1}},['001','é','é'],{integer:9007199254740991,negative:-1}]){
  assert.equal(await f.scalar('SELECT public.recon_v2_canonical($1::jsonb) AS value',[JSON.stringify(value)]),canonical(value));
  assert.equal(await f.scalar('SELECT public.recon_v2_digest($1::jsonb) AS value',[JSON.stringify(value)]),digest(value));
 }
});

const auditRow=(f,id)=>f.scalar('SELECT to_jsonb(e) AS value FROM public.camera_integration_events e WHERE id=$1',[id]);
withFixture('C16: durable A/B/A replay stays duplicate while never-applied old deliveries stay superseded',async f=>{
 const originalEntry='2026-01-01T01:03:00.000Z',laterEntry=new Date().toISOString();
 const a=await f.audit({startedAt:originalEntry}),b=await f.audit({startedAt:laterEntry});
 const appliedA=await receipt(f,a);keys(appliedA,receiptKeys);assert.equal(appliedA.outcome,'applied');assert.equal((await auditRow(f,a)).recon_receipt_metadata_applied,true);
 assert.equal((await receipt(f,b)).outcome,'applied');const current=await f.snapshot();
 // The accepted audit may be older than the attempt ledger's600-second retention.
 assert.deepEqual(await receipt(f,a),{...appliedA,outcome:'duplicate',applied:false});assert.deepEqual(await f.snapshot(),current);
 const never=await f.audit({startedAt:'2026-01-01T01:02:59.000Z'}),before=await f.snapshot();
 for(let retry=0;retry<2;retry++){const result=await receipt(f,never);assert.equal(result.outcome,'superseded');assert.equal(result.applied,false);assert.equal((await auditRow(f,never)).recon_receipt_metadata_applied,null);assert.deepEqual(await f.snapshot(),before);}
 assert.equal((await f.integration()).metadata.recon_receipt_state_v2.event_id,b);
 assert.equal((await f.integration()).metadata.receiver_tested_at,old);
});

withFixture('C16: equal entry times use event IDs; discarded committed acknowledgements replay without renewal',async f=>{
 const entry=new Date().toISOString(),a=await f.audit({startedAt:entry}),b=await f.audit({startedAt:entry});assert(b>a);
 await receipt(f,a); // Deliberately discard the committed reply; this is not a transport/runtime test.
 await receipt(f,b);const before=await f.snapshot(),retry=await receipt(f,a);assert.equal(retry.outcome,'duplicate');assert.equal(Date.parse(retry.receipt_started_at),Date.parse(entry));assert.deepEqual(await f.snapshot(),before);
 const c=await f.audit({startedAt:entry}),d=await f.audit({startedAt:entry});await receipt(f,d);const after=await f.snapshot();assert.equal((await receipt(f,c)).outcome,'superseded');assert.equal((await auditRow(f,c)).recon_receipt_metadata_applied,null);assert.deepEqual(await f.snapshot(),after);
});

withFixture('C16: missing retained audit fails closed; unmarked deletion cannot reset accepted event identity',async f=>{
 const applied=await f.audit();await receipt(f,applied);const before=await f.snapshot();await denied(f.db.query('DELETE FROM public.camera_integration_events WHERE id=$1',[applied]),'22023');assert.deepEqual(await f.snapshot(),before);
 await denied(receipt(f,999999),'22023');assert.deepEqual(await f.snapshot(),before);
 const pending=await f.audit();await f.db.query('DELETE FROM public.camera_integration_events WHERE id=$1',[pending]);const removed=await f.snapshot();await denied(receipt(f,pending),'22023');assert.deepEqual(await f.snapshot(),removed);
});

withFixture('C16: marker inserts, direct transitions, forged writer GUC, resets and ID changes are rejected',async f=>{
 const pending=await f.audit();
 for(const marker of [true,false])await denied(f.db.query(`INSERT INTO public.camera_integration_events(provider,event_type,recon_receipt_started_at,recon_receipt_kind,recon_receipt_metadata_applied)
  VALUES('reconeyez','Synthetic ordinary',clock_timestamp(),'ordinary',$1)`,[marker]),'22023');
 const before=await f.snapshot();
 for(const marker of [true,false])await denied(f.db.query('UPDATE public.camera_integration_events SET recon_receipt_metadata_applied=$1 WHERE id=$2',[marker,pending]),'22023');
 await denied(f.db.transaction(async tx=>{await tx.exec("SET LOCAL ROLE service_role;SELECT set_config('cos.recon_owned_writer_v2','receipt',true)");await tx.query('UPDATE public.camera_integration_events SET recon_receipt_metadata_applied=true WHERE id=$1',[pending]);}),'22023');
 await denied(f.db.query('UPDATE public.camera_integration_events SET id=id+10000 WHERE id=$1',[pending]),'22023');assert.deepEqual(await f.snapshot(),before);
 await receipt(f,pending);const accepted=await f.snapshot();
 for(const marker of [null,false])await denied(f.db.query('UPDATE public.camera_integration_events SET recon_receipt_metadata_applied=$1 WHERE id=$2',[marker,pending]),'22023');
 await denied(f.db.query('UPDATE public.camera_integration_events SET id=id+10000 WHERE id=$1',[pending]),'22023');assert.deepEqual(await f.snapshot(),accepted);
});

withFixture('C16: unmarked legacy current tuple is an error with no backfill or renewal',async f=>{
 const entry='2026-01-01T01:03:00.000000Z';await f.db.exec(`ALTER TABLE public.camera_integration_events ADD COLUMN recon_receipt_started_at timestamptz,ADD COLUMN recon_receipt_kind text,ADD COLUMN recon_receiver_attempt_id uuid`);
 const id=(await f.db.query(`INSERT INTO public.camera_integration_events(provider,event_type,received_at,recon_receipt_started_at,recon_receipt_kind)
 VALUES('reconeyez','Synthetic ordinary',$1,$1,'ordinary') RETURNING id`,[entry])).rows[0].id;
 await f.db.query(`UPDATE public.camera_integrations SET metadata=metadata||$1::jsonb`,[{last_webhook_received_at:entry,last_webhook_event_type:'Synthetic ordinary',recon_receipt_state_v2:{schema_version:2,event_id:id,receipt_started_at:entry}}]);
 for(const sql of Object.values(proposalSql))await f.db.exec(sql);const before=await f.snapshot();await denied(receipt(f,id),'22023');assert.deepEqual(await f.snapshot(),before);assert.equal((await auditRow(f,id)).recon_receipt_metadata_applied,null);
},{installV2:false});

for(const phase of ['metadata','before_marker','after_marker','suppress_metadata','suppress_marker','mutate_metadata','mutate_marker'])withFixture('C16: '+phase+' storage failure rolls back tuple and marker, then exact retry applies once',async f=>{
 const id=await f.audit();
 if(['metadata','suppress_metadata','mutate_metadata'].includes(phase))await f.db.exec(`CREATE FUNCTION public.synthetic_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.metadata->'recon_receipt_state_v2' IS DISTINCT FROM OLD.metadata->'recon_receipt_state_v2' THEN ${phase==='suppress_metadata'?"RETURN NULL;":phase==='mutate_metadata'?"NEW.metadata:=OLD.metadata;RETURN NEW;":"RAISE EXCEPTION 'Synthetic receipt metadata failure';"}END IF;RETURN NEW;END$$;
  CREATE TRIGGER synthetic_receipt_failure BEFORE UPDATE ON public.camera_integrations FOR EACH ROW EXECUTE FUNCTION public.synthetic_receipt_failure()`);
 else await f.db.exec(`CREATE FUNCTION public.synthetic_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.recon_receipt_metadata_applied IS TRUE AND OLD.recon_receipt_metadata_applied IS NULL THEN ${phase==='suppress_marker'?"RETURN NULL;":phase==='mutate_marker'?"NEW.recon_receipt_metadata_applied:=NULL;RETURN NEW;":"RAISE EXCEPTION 'Synthetic receipt marker failure';"}END IF;RETURN NEW;END$$;
  CREATE TRIGGER synthetic_receipt_failure ${phase==='after_marker'?'AFTER':'BEFORE'} UPDATE ON public.camera_integration_events FOR EACH ROW EXECUTE FUNCTION public.synthetic_receipt_failure()`);
 const before=await f.snapshot();await assert.rejects(receipt(f,id),(phase.startsWith('suppress_')||phase.startsWith('mutate_'))?error=>error.code==='22023':/Synthetic receipt/);assert.deepEqual(await f.snapshot(),before);
 await f.db.exec('DROP TRIGGER synthetic_receipt_failure ON public.'+(['metadata','suppress_metadata','mutate_metadata'].includes(phase)?'camera_integrations':'camera_integration_events'));assert.equal((await receipt(f,id)).outcome,'applied');assert.equal((await auditRow(f,id)).recon_receipt_metadata_applied,true);
 const once=await f.snapshot();assert.equal((await receipt(f,id)).outcome,'duplicate');assert.deepEqual(await f.snapshot(),once);
});

for(const target of ['integration','marker'])withFixture('C16: AFTER '+target+' trigger altering stored receipt metadata is detected and both writes roll back',async f=>{
 const id=await f.audit();await f.db.exec('CREATE TABLE public.synthetic_receipt_before AS SELECT id,metadata FROM public.camera_integrations;GRANT SELECT ON public.synthetic_receipt_before TO service_role');
 if(target==='integration')await f.db.exec(`CREATE FUNCTION public.synthetic_receipt_after_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
  IF pg_trigger_depth()=1 AND NEW.metadata->'recon_receipt_state_v2' IS DISTINCT FROM OLD.metadata->'recon_receipt_state_v2' THEN
   UPDATE public.camera_integrations SET metadata=OLD.metadata WHERE id=NEW.id;
  END IF;RETURN NEW;END$$;
  CREATE TRIGGER synthetic_receipt_after_mutation AFTER UPDATE ON public.camera_integrations FOR EACH ROW EXECUTE FUNCTION public.synthetic_receipt_after_mutation()`);
 else await f.db.exec(`CREATE FUNCTION public.synthetic_receipt_after_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
  IF NEW.recon_receipt_metadata_applied IS TRUE AND OLD.recon_receipt_metadata_applied IS NULL THEN
   UPDATE public.camera_integrations SET metadata=(SELECT metadata FROM public.synthetic_receipt_before LIMIT 1);
  END IF;RETURN NEW;END$$;
  CREATE TRIGGER synthetic_receipt_after_mutation AFTER UPDATE ON public.camera_integration_events FOR EACH ROW EXECUTE FUNCTION public.synthetic_receipt_after_mutation()`);
 const before=await f.snapshot();await denied(receipt(f,id),'22023');assert.deepEqual(await f.snapshot(),before);
 await f.db.exec('DROP TRIGGER synthetic_receipt_after_mutation ON public.'+(target==='integration'?'camera_integrations':'camera_integration_events'));assert.equal((await receipt(f,id)).outcome,'applied');assert.equal((await auditRow(f,id)).recon_receipt_metadata_applied,true);
});

test('C16 static source assertion: ordinary finalizer locks integration before only its requested audit; real-lock gate HOLD',()=>{
 const sql=proposalSql['reconeyez-receipt-v2.sql'],start=sql.indexOf('CREATE OR REPLACE FUNCTION public.recon_record_webhook_receipt_v2('),end=sql.indexOf('CREATE OR REPLACE FUNCTION public.recon_finish_receiver_ack_v2(',start),body=sql.slice(start,end).replace(/--[^\n]*/g,'');
 const integration=body.indexOf("SELECT * INTO integration FROM public.camera_integrations WHERE provider = 'reconeyez' FOR UPDATE"),audit=body.indexOf('SELECT * INTO audit FROM public.camera_integration_events WHERE id = p_event_id FOR UPDATE');
 assert(integration>=0&&audit>integration);assert.equal((body.match(/FOR UPDATE/g)||[]).length,2);assert.doesNotMatch(body,/camera_devices|camera_health_current/);assert.equal((body.match(/SELECT[\s\S]*?INTO audit FROM public\.camera_integration_events/g)||[]).length,1);
});

for(const phase of ['before_receipt','after_receipt'])withFixture('C16: exact ordered projector and existing private binary compactor preserve receipt marker '+phase,async f=>{
 const entry=new Date().toISOString(),observed=new Date(Date.now()-60000).toISOString(),key='synthetic-ordered-key-'+phase,source={event_guid:'synthetic-guid-'+phase,device_info:{guid:gid(2),type:'detector_hdr_xrl'},binary:[{type:'image',data:'synthetic-only-binary'}],cos_event_order_v1:{key}};
 await f.db.query(`INSERT INTO public.camera_devices(id,device_serial,external_device_id,device_name,source) VALUES(401,$1,$2,'Synthetic detector','reconeyez')`,['reconeyez:'+gid(2),gid(2)]);
 const id=await f.audit({startedAt:entry,observedAt:observed,externalGuid:gid(2),cameraDeviceId:401,type:'DeviceConnected',payload:source});
 if(phase==='after_receipt')assert.equal((await receipt(f,id)).outcome,'applied');
 const original=await auditRow(f,id),hash=createHash('sha256').update(JSON.stringify(source)).digest('hex'),reference={version:1,bucket:'camera-event-archives',sha256:hash,path:'reconeyez/'+hash+'.json.gz',archivedFields:['binary'],jsonBytes:Buffer.byteLength(JSON.stringify(source)),storedBytes:16},archived={...source,cos_private_archive:reference};delete archived.binary;
 await f.db.query("INSERT INTO storage.buckets(id,public) VALUES('camera-event-archives',false)");await f.db.query('INSERT INTO storage.objects(bucket_id,name,metadata) VALUES($1,$2,$3)',[reference.bucket,reference.path,{size:reference.storedBytes}]);
 const compact=(expected=source,replacement=archived)=>f.rpc('cos_archive_camera_event_v1',{p_id:id,p_expected:expected,p_archived:replacement});
 // Actual compactor source verifies the private object record and rejects each invalid delta before mutation.
 const before=await f.snapshot();
 for(const replacement of [{...archived,event_guid:'changed'}, {...archived,cos_event_order_v1:{key:'changed'}},{...archived,cos_private_archive:{...reference,bucket:'public-wrong'}},{...archived,cos_private_archive:{...reference,storedBytes:17}},{...archived,cos_private_archive:{...reference,path:'reconeyez/'+ 'f'.repeat(64)+'.json.gz'}}])assert.equal(await compact(source,replacement),false);
 await f.db.exec("UPDATE storage.buckets SET public=true");assert.equal(await compact(),false);await f.db.exec("UPDATE storage.buckets SET public=false;DELETE FROM storage.objects");assert.equal(await compact(),false);
 await f.db.query('INSERT INTO storage.objects(bucket_id,name,metadata) VALUES($1,$2,$3)',[reference.bucket,reference.path,{size:reference.storedBytes}]);assert.deepEqual(await f.snapshot(),before);
 await denied(f.db.query('UPDATE public.camera_integration_events SET payload=$1 WHERE id=$2',[archived,id]),'22023');assert.deepEqual(await f.snapshot(),before);
 assert.equal(await compact(),true);const compacted=await auditRow(f,id);assert.deepEqual(compacted.payload,archived);
 for(const replacement of [{...archived,cos_private_archive:{...reference,sha256:'f'.repeat(64)}},{...archived,cos_event_order_v1:{key:'forged-key'}}])await denied(f.db.query('UPDATE public.camera_integration_events SET payload=$1 WHERE id=$2',[replacement,id]),'22023');
 for(const field of ['id','provider','external_device_id','observed_at','received_at','recon_receipt_started_at','recon_receipt_kind','recon_receiver_attempt_id','recon_receipt_metadata_applied'])assert.deepEqual(compacted[field],original[field],field);
 assert.equal(await compact(),false);if(phase==='before_receipt')assert.equal((await receipt(f,id)).outcome,'applied');
 const projected=await f.rpc('cos_apply_recon_event_v1',{p_event_id:id,p_event_key:key,p_metadata_patch:{}});assert.equal(projected.outcome,'applied');
 const processed=await auditRow(f,id);assert.equal(processed.recon_receipt_metadata_applied,true);assert.equal(processed.processed,true);assert.equal(processed.processing_note,'recon_order_v1:applied');
 assert.equal(Date.parse(await f.scalar('SELECT to_jsonb(checked_at) AS value FROM public.camera_health_current WHERE camera_device_id=401')),Date.parse(observed));
 const newer=await f.audit({startedAt:new Date(Date.now()+1).toISOString()});await receipt(f,newer);const current=await f.snapshot();assert.equal((await receipt(f,id)).outcome,'duplicate');assert.deepEqual(await f.snapshot(),current);
},{compactor:true,projector:true});

withFixture('C04/C05 SQL-owner layer: receiver success survives an older inventory finish without timestamp renewal',async f=>{
 const inventory=await f.begin(),receiver=await f.begin('receiver_test');assertToken(receiver,'receiver_test');
 const entry=new Date(Math.max(Date.now(),Date.parse(receiver.observed_at))).toISOString(),event=await f.audit({startedAt:entry,kind:'receiver_test',token:receiver});
 const success=await ack(f,receiver,event);assertTerminal(success,receiver);assert.equal((await auditRow(f,event)).recon_receipt_metadata_applied,null);keys(success.result,['receiver_ready','ack_event_id','receiver_tested_at']);assert.equal(success.result.ack_event_id,event);
 const once=await f.integration();await f.finish(inventory,await inventoryInput(inventory.observed_at));const after=await f.integration();
 for(const key of ['receiver_tested_at','receiver_test_status','receiver_test_error','receiver_test_attempted_at','receiver_test_attempt_id','receiver_test_attempt_ordinal'])assert.deepEqual(after.metadata[key],once.metadata[key],key);
 const repeat=await f.audit({startedAt:new Date(Date.now()+1).toISOString(),kind:'receiver_test',token:receiver});const replay=await ack(f,receiver,repeat);assert.equal(replay.outcome,'duplicate');assert.deepEqual(replay.result,success.result);assert.equal((await f.integration()).metadata.receiver_tested_at,once.metadata.receiver_tested_at);
});

withFixture('C14: separate receiver order, new failure preserving success time and failure-after-success replay',async f=>{
 const a=await f.begin('receiver_test'),event=await f.audit({kind:'receiver_test',token:a});const applied=await ack(f,a,event);
 const before=await f.snapshot();const duplicate=await f.failure(a,'receiver_timeout');assert.deepEqual(duplicate,{...applied,outcome:'duplicate',applied:false});assert.deepEqual(await f.snapshot(),before);
 const b=await f.begin('receiver_test'),c=await f.begin('receiver_test');await f.failure(c,'receiver_timeout');const failed=await f.integration();assert.equal(Date.parse(failed.metadata.receiver_tested_at),Date.parse(applied.result.receiver_tested_at));assert.equal(failed.metadata.receiver_test_status,'error');
 const staleEvent=await f.audit({kind:'receiver_test',token:b});assert.equal((await ack(f,b,staleEvent)).outcome,'superseded');assert.deepEqual(await f.integration(),failed);
});

withFixture('C15/C30: audit clock anomalies and uncorrelated tests are retained without claiming readiness',async f=>{
 const receiver=await f.begin('receiver_test'),before=await f.integration();
 for(const options of [{startedAt:'1970-01-01T00:00:00Z',receivedAt:'1970-01-01T00:00:00Z'},
  {startedAt:'2026-01-01T00:00:01Z',receivedAt:'2026-01-01T00:00:00Z'},
  {startedAt:'2026-01-01T00:00:00Z',receivedAt:'2026-01-01T00:02:00.000001Z'}]){
  const event=await f.audit(options);await denied(receipt(f,event),'22023');assert.deepEqual(await f.integration(),before);
 }
 const uncorrelated=await f.audit({kind:'receiver_test'});await denied(ack(f,receiver,uncorrelated),'22023');assert.deepEqual(await f.integration(),before);
 const wrongBody=await f.audit({kind:'receiver_test',token:receiver,type:'IntegrationTest',payload:{cos_receiver_test_v2:{schema_version:2,attempt_id:receiver.attempt_id},eventType:'integration_test'}});await denied(ack(f,receiver,wrongBody),'PT409');assert.deepEqual(await f.integration(),before);
 const count=await f.scalar('SELECT count(*)::integer AS value FROM public.camera_integration_events');assert.equal(count,5);
});

const reconcileInput=async(token,coverage=diagnostics())=>{
 const inventory=await inventoryInput(token.observed_at);
 return {p_attempt_id:token.attempt_id,p_identity_inventory:inventory.p_identity_inventory,p_inventory_count:inventory.p_inventory_count,p_detector_count:2,
  p_diagnostics:{matched_local_detectors:0,unmatched_provider_detectors:2,local_active:0,local_shop:0,tracker_coverage:coverage,reconciled_at:token.observed_at},
  p_server_host:'synthetic.invalid',p_server_port:9028};
};
withFixture('C06/C07/C38: reconcile shares ordering, stores compact diagnostics result, and never mutates cameras',async f=>{
 const older=await f.begin(),a=await f.begin('inventory_reconcile'),input=await reconcileInput(a),before=await f.snapshot();
 const applied=await f.rpc('recon_finish_reconcile_v2',input);assertTerminal(applied,a);keys(applied.result,['inventory_total','detectors','matched_local_detectors','unmatched_provider_detectors','local_active','local_shop','diagnostics_sha256']);
 assert.equal(applied.result.diagnostics_sha256,digest(input.p_diagnostics));assert(!('tracker_coverage'in applied.result));
 const after=await f.snapshot();for(const table of ['camera_devices','camera_health_current','camera_health_history'])assert.deepEqual(after[table],before[table],table);
 const stale=await f.failure(older,'source_read_failed');assert.equal(stale.outcome,'superseded');assert.deepEqual(await f.snapshot(),after);
 const once=await f.integration(),duplicate=await f.rpc('recon_finish_reconcile_v2',input);assert.equal(duplicate.outcome,'duplicate');assert.deepEqual(duplicate.result,applied.result);assert.deepEqual(await f.integration(),once);
 const b=await f.begin();await f.finish(b,await inventoryInput(b.observed_at));const newest=await f.snapshot();assert.equal((await f.failure(a,'source_read_failed')).terminal_outcome,'success');assert.deepEqual(await f.snapshot(),newest);
});

withFixture('C30/C38: largest closed diagnostic shapes validate fully and retained receipts remain under4096 bytes',async f=>{
 for(const label of ['a'.repeat(128),'é'.repeat(64),'"'.repeat(128)]){
  const coverage=diagnostics();for(const value of Object.values(coverage))Object.assign(value,{tracker_total:100000,field_or_unknown:1000,shop:99000,missing_local_units:100000,missing_field_units:Array(1000).fill(label)});
  const a=await f.begin('inventory_reconcile'),input=await reconcileInput(a,coverage),bytes=Buffer.byteLength(canonical(input.p_diagnostics));
  assert(bytes<=524288);const applied=await f.rpc('recon_finish_reconcile_v2',input);assert.equal(applied.result.diagnostics_sha256,digest(input.p_diagnostics));
  const record=state(await f.integration()).records.find(record=>record.attempt_id===a.attempt_id);assert(Buffer.byteLength(canonical(record))<=4096);assert(!JSON.stringify(record).includes(label));
  const lookup=await f.lookup(a);assert.deepEqual(lookup.terminal.result,applied.result);assert(!('tracker_coverage'in lookup.terminal.result));
 }
 const invalid=[
  ['129 ASCII bytes',d=>d.tracker_coverage.Recon.missing_field_units=['a'.repeat(129)]],
  ['130 UTF8 bytes',d=>d.tracker_coverage.Recon.missing_field_units=['é'.repeat(65)]],
  ['C0 control',d=>d.tracker_coverage.Recon.missing_field_units=['bad\nlabel']],
  ['C1 control',d=>d.tracker_coverage.Recon.missing_field_units=['bad\u0085label']],
  ['1001 labels',d=>Object.assign(d.tracker_coverage.Recon,{tracker_total:1001,field_or_unknown:1001,missing_local_units:1001,missing_field_units:Array(1001).fill('x')})],
  ['100001 counter',d=>Object.assign(d.tracker_coverage.Recon,{tracker_total:100001,field_or_unknown:0,shop:100001,missing_local_units:100001,missing_field_units:[]})],
  ['unknown key',d=>d.extra=true],
  ['missing required field label',d=>d.tracker_coverage.Recon.missing_field_units=[]],
  ['matched provider count above local total',d=>Object.assign(d,{matched_local_detectors:1,unmatched_provider_detectors:1})]
 ];
 for(const [label,mutate] of invalid){
  const a=await f.begin('inventory_reconcile'),input=await reconcileInput(a);Object.assign(input.p_diagnostics.tracker_coverage.Recon,{tracker_total:1,field_or_unknown:1,missing_local_units:1,missing_field_units:['Synthetic unit']});
  mutate(input.p_diagnostics);const before=await f.snapshot();await assert.rejects(f.rpc('recon_finish_reconcile_v2',input),error=>error.code!=='40001',label);assert.deepEqual(await f.snapshot(),before,label);
 }
 // With one matched unit and two missing units split across field/shop/retired,
 // zero or one missing field label are both consistent: neither side can infer which state matched.
 await f.db.query(`INSERT INTO public.camera_devices(id,device_serial,external_device_id,device_name,source,unit_key)
  VALUES(301,$1,$2,'Synthetic mixed-state detector','reconeyez','RI-001')`,['reconeyez:'+gid(2),gid(2)]);
 for(const labels of [[],['Synthetic field unit']]){
  const coverage=diagnostics();Object.assign(coverage.Recon,{tracker_total:3,field_or_unknown:1,shop:1,retired:1,matched_local_units:1,missing_local_units:2,missing_field_units:labels,namespace_inventory_present:true});
  const a=await f.begin('inventory_reconcile'),input=await reconcileInput(a,coverage);Object.assign(input.p_diagnostics,{matched_local_detectors:1,unmatched_provider_detectors:1,local_active:1});
  const before=await f.snapshot();assert.equal((await f.rpc('recon_finish_reconcile_v2',input)).outcome,'applied');const after=await f.snapshot();
  for(const table of ['camera_devices','camera_health_current','camera_health_history'])assert.deepEqual(after[table],before[table],table);
 }

});

withFixture('C30: inventory128/receiver32 capacity boundaries reject before further work without eviction',async f=>{
 for(let i=0;i<128;i++)await f.begin('inventory_sync');
 const fullInventory=await f.snapshot();await assert.rejects(f.begin('inventory_sync'));assert.deepEqual(await f.snapshot(),fullInventory);
 for(let i=0;i<32;i++)await f.begin('receiver_test');
 const full=await f.snapshot();await assert.rejects(f.begin('receiver_test'));assert.deepEqual(await f.snapshot(),full);
 const stored=state(await f.integration());assert.equal(stored.records.length,160);assert(Buffer.byteLength(canonical(stored))<=1048576);
});

withFixture('C30: complete terminal record4096 bytes validates;4097 and missing begin headroom fail closed',async f=>{
 const a=await f.begin();const pending=state(await f.integration()).records.find(value=>value.attempt_id===a.attempt_id);
 await f.finish(a,await inventoryInput(a.observed_at));const row=await f.integration(),stored=state(row),record=stored.records.find(value=>value.attempt_id===a.attempt_id);
 const byteLength=Buffer.byteLength(canonical(record)),size=4096-byteLength+Buffer.byteLength(row.server_host);
 const atLimit=structuredClone(stored);atLimit.records[0].expected_config.server_host='x'.repeat(size);assert.equal(Buffer.byteLength(canonical(atLimit.records[0])),4096);
 await f.scalar('SELECT public.recon_v2_check_state($1::jsonb) AS value',[atLimit]);
 const beyond=structuredClone(atLimit);beyond.records[0].expected_config.server_host+='x';await assert.rejects(f.scalar('SELECT public.recon_v2_check_state($1::jsonb) AS value',[beyond]));
 // Even when the pending record itself could fit4096, begin must reserve a terminal result before provider work.
 const pendingHostSize=4096-Buffer.byteLength(canonical(pending))+Buffer.byteLength(row.server_host);
 await f.db.query("UPDATE public.camera_integrations SET server_host=$1 WHERE provider='reconeyez'",['x'.repeat(pendingHostSize)]);const before=await f.snapshot();await assert.rejects(f.begin());assert.deepEqual(await f.snapshot(),before);
});

withFixture('C30: expired absent-create observation cannot create integration or Vault secrets',async f=>{
 const a=await f.begin('inventory_connect'),input=await inventoryInput(a.observed_at);const expired={...a,observed_at:'2026-01-01T00:00:00.000Z',expires_at:'2026-01-01T00:02:00.000Z',retain_until:'2026-01-01T00:10:00.000Z'};
 const before=await f.snapshot();await denied(f.create(expired,{...input,p_identity_inventory:{...input.p_identity_inventory,observedAt:expired.observed_at}}));assert.deepEqual(await f.snapshot(),before);
},{absent:true});

withFixture('audit evidence is immutable, historical null stays null, processing flags still change',async f=>{
 const historical=await f.scalar("SELECT to_jsonb(e) AS value FROM public.camera_integration_events e WHERE event_type='Historical synthetic event'");
 assert.equal(historical.recon_receipt_started_at,null);await denied(receipt(f,historical.id),'22023');
 const id=await f.audit(),before=await f.scalar('SELECT to_jsonb(e) AS value FROM public.camera_integration_events e WHERE id=$1',[id]);
 for(const change of ["received_at=received_at+interval '1 second'","observed_at=clock_timestamp()","payload='{\"changed\":true}'::jsonb","provider='synthetic-other'","recon_receipt_started_at=recon_receipt_started_at+interval '1 second'","event_type='Changed'"]){
  await denied(f.db.exec('UPDATE public.camera_integration_events SET '+change+' WHERE id='+id),'22023');assert.deepEqual(await f.scalar('SELECT to_jsonb(e) AS value FROM public.camera_integration_events e WHERE id=$1',[id]),before);
 }
 await f.db.query("UPDATE public.camera_integration_events SET processed=true,processing_note='Synthetic projection flag' WHERE id=$1",[id]);
 const processed=await f.scalar('SELECT to_jsonb(e) AS value FROM public.camera_integration_events e WHERE id=$1',[id]);assert.equal(processed.processed,true);assert.equal(processed.processing_note,'Synthetic projection flag');
 for(const key of ['provider','event_type','received_at','observed_at','payload','recon_receipt_started_at','recon_receipt_kind','recon_receiver_attempt_id'])assert.deepEqual(processed[key],before[key],key);
 await denied(f.db.exec("INSERT INTO public.camera_integration_events(provider,event_type) VALUES('reconeyez','Unversioned synthetic event')"),'22023');
},{historicalAudit:true});

withFixture('actual SQL responses and complete records satisfy supplied closed JSON schemas',async f=>{
 const begin=await f.begin(),finish=await f.finish(begin,await inventoryInput(begin.observed_at)),lookup=await f.lookup(begin),event=await f.audit(),ordinary=await receipt(f,event);
 const record=state(await f.integration()).records.find(value=>value.attempt_id===begin.attempt_id),samples=[['begin',begin],['finish',finish],['lookup',lookup],['receipt',ordinary],['record',record]];
 const receiver=await f.begin('receiver_test'),receiverEvent=await f.audit({kind:'receiver_test',token:receiver}),acknowledged=await ack(f,receiver,receiverEvent);
 samples.push(['begin',receiver],['finish',acknowledged],['lookup',await f.lookup(receiver)]);
 const failed=await f.begin();samples.push(['finish',await f.failure(failed)],['lookup',await f.lookup(failed)]);
 samples.push(['finish',await f.finish(begin,await inventoryInput(begin.observed_at))],['lookup',await f.lookup(uuid(9999))]);
 const script=`import json,sys,jsonschema\ns=json.load(open(sys.argv[1]))\nfor name,value in json.load(sys.stdin):\n jsonschema.Draft202012Validator(s['$defs'][name],format_checker=jsonschema.FormatChecker()).validate(value)\n`;
 execFileSync('python3',['-c',script,fileURLToPath(new URL('./fixtures/recon-v2/V2_RESPONSE_SCHEMAS.min.json',import.meta.url))],{input:JSON.stringify(samples),encoding:'utf8',maxBuffer:1024*1024});
});

withFixture('C35/C36 reverse sequence: committed success replay cannot undo later config or same-ID credentials',async f=>{
 await f.rpc('save_reconeyez_credentials',{p_username:'synthetic-initial-user',p_password:'synthetic-initial-password'});
 const a=await f.begin('inventory_connect'),input=await inventoryInput(a.observed_at),committed=await f.rpc('recon_finish_inventory_v2',{p_attempt_id:a.attempt_id,...input,p_username:'synthetic-committed-user',p_password:'synthetic-committed-password'});
 await f.db.exec("UPDATE public.camera_integrations SET enabled=false,server_host='new-synthetic.invalid',server_port=9030");
 await f.rpc('save_reconeyez_credentials',{p_username:'synthetic-later-user',p_password:'synthetic-later-password'});
 await f.db.exec("UPDATE public.camera_integrations SET enabled=false,server_host='deliberate-synthetic.invalid',server_port=9031");
 const before=await f.snapshot(),replay=await f.rpc('recon_finish_inventory_v2',{p_attempt_id:a.attempt_id,...input,p_username:'synthetic-committed-user',p_password:'synthetic-committed-password'});
 assert.deepEqual(replay,{...committed,outcome:'duplicate',applied:false,current:false});assert.deepEqual(await f.snapshot(),before);
});

withFixture('closed retained-state validator rejects required nulls and uppercase UUIDs',async f=>{
 const a=await f.begin();await f.finish(a,await inventoryInput(a.observed_at));const stored=state(await f.integration());
 for(const path of [['kind'],['observed_at'],['expires_at'],['retain_until'],['terminal','outcome'],['terminal','committed_at']]){
  const malformed=structuredClone(stored);let container=malformed.records[0];for(const part of path.slice(0,-1))container=container[part];container[path.at(-1)]=null;
  await assert.rejects(f.scalar('SELECT public.recon_v2_check_state($1::jsonb) AS value',[malformed]),'required '+path.join('.'));
 }
 for(const field of ['request_id','attempt_id','username_secret_id','password_secret_id','webhook_secret_id']){
  const malformed=structuredClone(stored),record=malformed.records[0],container=field.endsWith('_secret_id')?record.expected_config:record;container[field]='A0000000-0000-4000-8000-000000000001';
  await assert.rejects(f.scalar('SELECT public.recon_v2_check_state($1::jsonb) AS value',[malformed]),'noncanonical UUID '+field);
 }
});

withFixture('receiver config change blocks ack and makes old failure a no-op while preserving last success',async f=>{
 const receiver=await f.begin('receiver_test'),event=await f.audit({kind:'receiver_test',token:receiver});await f.db.exec("UPDATE public.camera_integrations SET enabled=false,server_host='changed-synthetic.invalid'");
 const before=await f.snapshot();await denied(ack(f,receiver,event));assert.deepEqual(await f.snapshot(),before);
 const failed=await f.failure(receiver,'receiver_timeout');assert.equal(failed.outcome,'superseded');assert.equal(failed.reason_code,'configuration_changed');assert.deepEqual(await f.snapshot(),before);assert.equal((await f.integration()).metadata.receiver_tested_at,old);
});

withFixture('C31 reverse serialized winner: second validated creator wins; first cannot change its Vault or inventory',async f=>{
 const first=await f.begin('inventory_connect'),second=await f.begin('inventory_connect'),winnerInput=await inventoryInput(second.observed_at,{count:3});
 await f.create(second,winnerInput,{p_username:'synthetic-second-user',p_password:'synthetic-second-password'});await f.db.exec("UPDATE vault.synthetic_faults SET fail_name='reconeyez_username'");const before=await f.snapshot();
 await denied(f.create(first,await inventoryInput(first.observed_at),{p_username:'synthetic-first-user',p_password:'synthetic-first-password'}));assert.deepEqual(await f.snapshot(),before);assertProof(await f.integration(),winnerInput,second);
},{absent:true});

withFixture('lookup rejects missing identity rather than returning a schema-invalid unknown object',async f=>{
 const before=await f.snapshot();await assert.rejects(f.rpc('recon_attempt_result_v2',{p_attempt_id:null}));assert.deepEqual(await f.snapshot(),before);
 const unknown=await f.lookup(uuid(99999));keys(unknown,resultKeys);assert.equal(unknown.attempt_id,uuid(99999));assert.equal(unknown.state,'unknown');assert.equal(unknown.kind,null);assert.equal(unknown.terminal,null);
});

withFixture('lost-begin recovery returns the original closed token without writing or inventing a token',async f=>{
 const a=await f.begin(),before=await f.snapshot(),recover=()=>f.rpc('recon_recover_begin_v2',{p_request_id:a.request_id,p_kind:a.kind});
 assert.deepEqual(await recover(),{...a,outcome:'duplicate'});assert.deepEqual(await f.snapshot(),before);
 await denied(f.rpc('recon_recover_begin_v2',{p_request_id:uuid(99998),p_kind:a.kind}));await denied(f.rpc('recon_recover_begin_v2',{p_request_id:a.request_id,p_kind:'receiver_test'}));assert.deepEqual(await f.snapshot(),before);
 for(const role of ['anon','authenticated'])await denied(f.rpc('recon_recover_begin_v2',{p_request_id:a.request_id,p_kind:a.kind},role),'42501');assert.deepEqual(await f.snapshot(),before);
});

withFixture('C37: initially disabled Recon reconciliation auto-enables without renewing camera clocks',async f=>{
 await f.db.query(`INSERT INTO public.camera_devices(id,device_serial,external_device_id,device_name,source,monitoring_profile,expected_ports,unit_key,source_last_seen_at,last_health_checked_at,last_online_at,last_probe_online_at,source_metadata)
  VALUES(201,$1,$2,'Synthetic existing detector','reconeyez','camv',ARRAY[9028],'Synthetic Field',$3,$3,$3,$3,$4)`,['reconeyez:'+gid(2),gid(2),old,{battery_updated_at:old,battery_status_updated_at:old,last_event_at:old}]);
 await f.db.query(`INSERT INTO public.camera_health_current(camera_device_id,overall_status,checked_at,detail) VALUES(201,'offline',$1,'Synthetic prior evidence')`,[old]);
 const before=await f.snapshot(),a=await f.begin('inventory_reconcile'),input=await reconcileInput(a);Object.assign(input.p_diagnostics,{matched_local_detectors:1,unmatched_provider_detectors:1,local_active:1});
 const result=await f.rpc('recon_finish_reconcile_v2',input),after=await f.snapshot();
 assertTerminal(result,a);assert.equal(after.camera_integrations[0].enabled,true);assert.equal(after.camera_integrations[0].server_host,'synthetic.invalid');assert.equal(after.camera_integrations[0].server_port,9028);
 for(const table of ['camera_devices','camera_health_current','camera_health_history'])assert.deepEqual(after[table],before[table],table);
 assertProof(after.camera_integrations[0],{p_identity_inventory:input.p_identity_inventory},a);
 const once=await f.snapshot();assert.equal((await f.rpc('recon_finish_reconcile_v2',input)).outcome,'duplicate');assert.deepEqual(await f.snapshot(),once);
},{enabled:false});
