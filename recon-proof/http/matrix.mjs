import assert from 'node:assert/strict';
import {gid,old,rawInventory} from './runtime.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const epoch=x=>new Date(x).getTime();
const calls=(c,name)=>c.adapter.trace.filter(x=>x.rpc===name);
const directWrites=c=>c.adapter.trace.filter(x=>x.table==='camera_integrations'&&['insert','update','upsert'].includes(x.op));
const latest=(c,name)=>calls(c,name).at(-1);
const row=async(f,table,idColumn,id)=>(await f.db.query(`SELECT to_jsonb(t) AS value FROM public.${table} t WHERE ${idColumn}=$1`,[id])).rows[0]?.value;
const body=(type='DeviceConnected',extra={})=>({eventType:type,deviceGuid:gid(2),timestamp:new Date(Date.now()-20000).toISOString(),eventGuid:'hosted-'+crypto.randomUUID(),...extra});
const webhook=(c,payload,headers={})=>c.request('webhook',payload,{'x-reconeyez-token':'synthetic-webhook-token',...headers},'POST',false);
const sync=c=>c.request('connect',{action:'sync'});
const reconcile=c=>c.request('reconcile',{mode:'reconeyez'});
const fixedClocks=d=>Object.fromEntries(['source_last_seen_at','last_online_at','last_health_checked_at','last_probe_online_at','source_status'].map(k=>[k,d[k]]));
const expectHttp=(reply,status)=>assert.equal(reply.status,status,JSON.stringify(reply.body));
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort());
const waitable=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};

export async function seedHttpFixture(f) {
 // No production credentials or rows. The fixture database is disposable.
 await f.db.exec(`CREATE TABLE IF NOT EXISTS public.equipment_master(canonical_family text,unit_tag text,source_label text,tracker_state text);
  GRANT SELECT ON public.equipment_master TO service_role;
  CREATE TABLE public.recon_http_native_conflict(id integer PRIMARY KEY,value integer NOT NULL);
  INSERT INTO public.recon_http_native_conflict VALUES(1,0);
  GRANT SELECT,UPDATE ON public.recon_http_native_conflict TO service_role;`);
 await f.db.query(`INSERT INTO public.camera_devices(id,device_serial,external_device_id,device_name,device_model,source,monitoring_profile,expected_ports,unit_key,organization,activation_state,source_status,source_last_seen_at,last_health_checked_at,last_online_at,last_probe_online_at,source_metadata)
  VALUES(101,$1,$2,'Synthetic saved detector','detector_hdr_xrl','reconeyez','reconeyez',ARRAY[9028],'Synthetic Field','Manual field','active','offline',$3,$3,$3,$3,$4)`,
  ['reconeyez:'+gid(2),gid(2),old,{guid:gid(2),area:'Synthetic Field',description:'Synthetic description',reconeyez_type:'detector_hdr_xrl',battery_percent:22,battery_updated_at:old,battery_status_updated_at:old,custom:{preserve:true}}]);
 await f.db.query(`INSERT INTO public.camera_health_current(camera_device_id,overall_status,checked_at,detail) VALUES(101,'offline',$1,'Synthetic unchanged health')`,[old]);
 await f.db.query(`INSERT INTO public.equipment_master(canonical_family,unit_tag,source_label,tracker_state) VALUES('Recon','001','Synthetic missing field unit','field_or_unknown')`);
}

async function prepareInput(c,at) {
 const p=await c.source.inventory.prepareReconInventory(rawInventory(),at);
 delete p.p_observed_at;return p;
}
async function publishInventory(c) {
 const token=await c.fixture.begin('inventory_sync');
 return {token,result:await c.fixture.finish(token,await prepareInput(c,token.observed_at))};
}
async function metadataConflict(c) {
 await c.fixture.db.exec(`CREATE FUNCTION public.recon_http_metadata_conflict() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
  IF NEW.metadata->>'last_webhook_received_at' IS DISTINCT FROM OLD.metadata->>'last_webhook_received_at' THEN
   RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Synthetic metadata conflict';
  END IF;RETURN NEW;END$$;
  CREATE TRIGGER recon_http_metadata_conflict BEFORE UPDATE ON public.camera_integrations FOR EACH ROW EXECUTE FUNCTION public.recon_http_metadata_conflict()`);
}

export const matrix=[
 {name:'http-auth-denial-before-owned-work',run:async c=>{
  const before=await c.fixture.snapshot();
  expectHttp(await c.request('webhook',body(),{'x-reconeyez-token':'wrong'},'POST',false),401);
  expectHttp(await c.request('webhook',null,{},'GET',false),405);
  expectHttp(await c.request('connect',{action:'sync'},{Authorization:'Bearer wrong'}),401);
  for(const token of ['synthetic-field','synthetic-inactive'])expectHttp(await c.request('connect',{action:'sync'},{Authorization:'Bearer '+token}),403);
  for(const action of ['connect','test_webhook'])expectHttp(await c.request('connect',{action},{Authorization:'Bearer synthetic-it'}),403);
  expectHttp(await c.request('reconcile',{mode:'reconeyez'},{Authorization:''}),403);
  assert.equal(calls(c,'recon_begin_attempt_v2').length,0);assert(!c.adapter.trace.some(x=>x.boundary==='synthetic_provider'));
  assert.deepEqual(await c.fixture.snapshot(),before);
 }},
 {name:'http-inventory-reconcile-use-owner-rpcs-preserve-clocks',run:async c=>{
  const before=await row(c.fixture,'camera_devices','id',101),integration=await c.fixture.integration();
  const s=await sync(c);expectHttp(s,200);assert.equal(s.body.ok,true);
  exactKeys(s.body,['ok','imported','active','shop','skipped_non_detectors']);assert.equal(s.body.imported,2);
  const r=await reconcile(c);expectHttp(r,200);assert.equal(r.body.reconeyez.inventory_total,3);
  assert.equal(r.body.reconeyez.detectors,2);assert.match(r.body.reconeyez.diagnostics_sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(fixedClocks(await row(c.fixture,'camera_devices','id',101)),fixedClocks(before));
  assert.deepEqual((await c.fixture.integration()).metadata.unrelated,integration.metadata.unrelated);
  assert.equal((await c.fixture.integration()).metadata.receiver_tested_at,integration.metadata.receiver_tested_at);
  assert.equal(directWrites(c).length,0);assert.equal(calls(c,'recon_finish_inventory_v2').length,1);assert.equal(calls(c,'recon_finish_reconcile_v2').length,1);
  const trace=c.adapter.trace,begin=trace.findIndex(x=>x.rpc==='recon_begin_attempt_v2'),secret=trace.findIndex(x=>x.rpc==='get_reconeyez_integration_secrets'),provider=trace.findIndex(x=>x.boundary==='synthetic_provider');
  assert(begin<secret&&secret<provider);
 }},
 {name:'http-original-event-time-duplicate-older-and-invalid-time',run:async c=>{
  const p=body('DeviceConnected',{battery:81}),first=await webhook(c,p);expectHttp(first,200);assert.equal(first.body.applied,true);
  const device=await row(c.fixture,'camera_devices','id',101),health=await row(c.fixture,'camera_health_current','camera_device_id',101);
  assert.equal(epoch(device.source_last_seen_at),epoch(p.timestamp));assert.equal(epoch(device.last_online_at),epoch(p.timestamp));
  assert.equal(epoch(device.source_metadata.battery_updated_at),epoch(p.timestamp));assert.equal(epoch(health.checked_at),epoch(p.timestamp));
  const after=await c.fixture.snapshot(),again=await webhook(c,p);expectHttp(again,200);assert.equal(again.body.outcome,'duplicate');assert.equal(again.body.applied,false);
  assert.equal((await c.fixture.snapshot()).camera_health_history.length,after.camera_health_history.length);
  const older=await webhook(c,body('ConnectionLost',{timestamp:new Date(epoch(p.timestamp)-1000).toISOString()}));expectHttp(older,200);assert.equal(older.body.outcome,'older');
  const invalid=await webhook(c,body('ConnectionLost',{timestamp:'not-a-time'}));expectHttp(invalid,200);assert.equal(invalid.body.outcome,'unverified_timestamp');
  assert.deepEqual(await row(c.fixture,'camera_health_current','camera_device_id',101),health);
  const audits=(await c.fixture.snapshot()).camera_integration_events;assert.equal(audits.length,4);
  assert.equal(epoch(audits.find(a=>a.id===first.body.event_id).observed_at),epoch(p.timestamp));
  assert.notEqual(epoch((await c.fixture.integration()).metadata.last_webhook_received_at),epoch(p.timestamp));
 }},
 {name:'http-bridge-siren-and-receiver-aliases-never-project-detector-health',run:async c=>{
  const before=await row(c.fixture,'camera_devices','id',101),health=await row(c.fixture,'camera_health_current','camera_device_id',101);
  for(const extra of [{device_type:'bridge_4g'},{device:{type:'siren'}},{event_code:'IntegrationTest'},{data:{device_type:'bridge_4g'}}]){
   const r=await webhook(c,body('DeviceConnected',extra));expectHttp(r,202);assert.equal(r.body.applied,false);assert.equal(r.body.health_changed,false);
  }
  assert.equal(calls(c,'cos_apply_recon_event_v1').length,0);assert.deepEqual(await row(c.fixture,'camera_devices','id',101),before);assert.deepEqual(await row(c.fixture,'camera_health_current','camera_device_id',101),health);
 }},
 {name:'http-metadata-PT409-retains-event-and-allows-real-health-then-duplicate-repair',run:async c=>{
  await metadataConflict(c);const p=body(),r=await webhook(c,p);expectHttp(r,503);
  assert.equal(r.body.metadata_error_code,'PT409');assert.equal(r.body.applied,true);assert.equal(r.body.health_changed,true);assert(Number.isSafeInteger(r.body.event_id));
  assert.equal((await row(c.fixture,'camera_health_current','camera_device_id',101)).overall_status,'online');
  assert.equal(calls(c,'recon_record_webhook_receipt_v2').length,1);
  const wire=c.adapter.trace.find(x=>x.path==='rpc/recon_record_webhook_receipt_v2');assert.equal(wire.status,409);assert.equal(wire.response.code,'PT409');
  await c.fixture.db.exec('DROP TRIGGER recon_http_metadata_conflict ON public.camera_integrations;DROP FUNCTION public.recon_http_metadata_conflict()');
  const retry=await webhook(c,p);expectHttp(retry,200);assert.equal(retry.body.outcome,'duplicate');assert.equal(retry.body.metadata_outcome,'applied');
 }},
 {name:'http-audit-failure-stops-metadata-and-health',run:async c=>{
  await c.fixture.db.exec(`CREATE FUNCTION public.recon_http_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic audit storage rejection';END$$;
   CREATE TRIGGER recon_http_audit_failure BEFORE INSERT ON public.camera_integration_events FOR EACH ROW EXECUTE FUNCTION public.recon_http_audit_failure()`);
  const before=await c.fixture.snapshot(),r=await webhook(c,body());expectHttp(r,503);assert.equal(r.body.health_changed,false);assert(!Object.hasOwn(r.body,'event_id'));
  assert.equal(calls(c,'recon_record_webhook_receipt_v2').length,0);assert.equal(calls(c,'cos_apply_recon_event_v1').length,0);assert.deepEqual(await c.fixture.snapshot(),before);
 }},
 {name:'http-health-failure-retains-committed-audit-and-metadata',run:async c=>{
  await c.fixture.db.exec(`CREATE FUNCTION public.recon_http_health_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic health storage rejection';END$$;
   CREATE TRIGGER recon_http_health_failure BEFORE UPDATE ON public.camera_health_current FOR EACH ROW EXECUTE FUNCTION public.recon_http_health_failure()`);
  const before=await row(c.fixture,'camera_health_current','camera_device_id',101),r=await webhook(c,body());expectHttp(r,503);
  assert.equal(r.body.metadata_outcome,'applied');assert.equal(r.body.applied,null);assert.equal(r.body.health_changed,null);assert.equal(r.body.outcome,'unknown');assert(Number.isSafeInteger(r.body.event_id));
  assert.equal((await row(c.fixture,'camera_integration_events','id',r.body.event_id)).recon_receipt_metadata_applied,true);
  assert.deepEqual(await row(c.fixture,'camera_health_current','camera_device_id',101),before);
 }},
 {name:'http-unsafe-bigint-audit-ack-fails-closed',run:async c=>{
  await c.fixture.db.exec("SELECT setval('public.camera_integration_events_id_seq',9007199254740992,false)");
  const before=await row(c.fixture,'camera_health_current','camera_device_id',101),r=await webhook(c,body());expectHttp(r,503);
  assert.equal(r.body.health_changed,false);assert(!Object.hasOwn(r.body,'event_id'));assert.equal(calls(c,'recon_record_webhook_receipt_v2').length,0);assert.equal(calls(c,'cos_apply_recon_event_v1').length,0);
  assert.deepEqual(await row(c.fixture,'camera_health_current','camera_device_id',101),before);
  assert.equal(await c.fixture.scalar('SELECT count(*)::integer AS value FROM public.camera_integration_events'),1);
 }},
 {name:'http-unmapped202-versus-lookup-error503',run:async c=>{
  const missing=await webhook(c,body('DeviceConnected',{deviceGuid:gid(99)}));expectHttp(missing,202);assert.equal(missing.body.matched,false);assert.equal(missing.body.outcome,'not_eligible');
  c.adapter.behavior.beforeTable=({spec})=>spec.table==='camera_devices'?{data:null,error:{code:'SYNTHETIC_LOOKUP',message:'Synthetic lookup boundary failure'}}:undefined;
  const failed=await webhook(c,body());expectHttp(failed,503);assert.equal(failed.body.outcome,'lookup_failed');assert(Number.isSafeInteger(failed.body.event_id));
  assert.equal(calls(c,'cos_apply_recon_event_v1').length,0);
 }},
 {name:'http-metadata-lost-ack-retries-same-audit-real-duplicate',run:async c=>{
  let dropped=false;c.adapter.behavior.afterRpc=({name,result})=>{
   if(name==='recon_record_webhook_receipt_v2'&&!dropped&&!result.error){dropped=true;throw Error('Synthetic loss after actual PostgREST success response');}
  };
  const r=await webhook(c,body());expectHttp(r,200);assert.equal(r.body.metadata_outcome,'duplicate');
  const records=calls(c,'recon_record_webhook_receipt_v2');assert.equal(records.length,2);assert.deepEqual(records[0].args,records[1].args);
  const audit=await row(c.fixture,'camera_integration_events','id',r.body.event_id);assert.equal(audit.recon_receipt_metadata_applied,true);
 }},
 {name:'http-inventory-lost-ack-recovers-same-committed-token',run:async c=>{
  let dropped=false;c.adapter.behavior.afterRpc=({name,result})=>{
   if(name==='recon_finish_inventory_v2'&&!dropped&&!result.error){dropped=true;throw Error('Synthetic loss after committed inventory response');}
  };
  const r=await sync(c);expectHttp(r,200);assert.equal(r.body.ok,true);assert.equal(r.body.imported,2);
  const recovered=c.adapter.trace.find(x=>x.path==='rpc/recon_attempt_result_v2');assert.equal(recovered.response.terminal.terminal_outcome,'success');assert.equal(recovered.response.terminal.outcome,'duplicate');
  assert.equal(calls(c,'recon_begin_attempt_v2').length,1);assert.equal(calls(c,'recon_finish_inventory_v2').length,1);assert.equal(calls(c,'recon_attempt_result_v2').length,1);
  assert.equal(latest(c,'recon_finish_inventory_v2').args.p_attempt_id,latest(c,'recon_attempt_result_v2').args.p_attempt_id);assert.equal(calls(c,'recon_fail_attempt_v2').length,0);assert.equal(directWrites(c).length,0);
 }},
 {name:'http-config-change-yields-real-PT409-without-failure-fallback',run:async c=>{
  let edited=false;c.adapter.behavior.beforeRpc=async({name,fixture})=>{
   if(name==='recon_finish_inventory_v2'&&!edited){edited=true;await fixture.db.exec("UPDATE public.camera_integrations SET enabled=false,server_host='changed.synthetic.invalid' WHERE provider='reconeyez'");}
  };
  const r=await sync(c);expectHttp(r,409);assert.equal(r.body.code,'PT409');assert.equal(calls(c,'recon_fail_attempt_v2').length,0);assert.equal(directWrites(c).length,0);
  const integration=await c.fixture.integration();assert.equal(integration.server_host,'changed.synthetic.invalid');assert.equal(integration.enabled,false);
  const wire=c.adapter.trace.find(x=>x.path==='rpc/recon_finish_inventory_v2');assert.equal(wire.status,409);assert.equal(wire.response.code,'PT409');
 }},
 {name:'http-provider-partial-inventory-fails-original-attempt',run:async c=>{
  c.adapter.behavior.providerStatus=206;const r=await sync(c);expectHttp(r,502);
  assert.equal(calls(c,'recon_begin_attempt_v2').length,1);assert.equal(calls(c,'recon_finish_inventory_v2').length,0);assert.equal(latest(c,'recon_fail_attempt_v2').args.p_reason_code,'partial_inventory');assert.equal(directWrites(c).length,0);
 }},
 {name:'http-event-during-pending-inventory-preserves-independent-health',run:async c=>{
  const entered=waitable(),release=waitable();c.adapter.behavior.provider=async()=>{entered.resolve();await release.promise;return new Response(JSON.stringify(rawInventory()),{status:200})};
  const pending=sync(c);await Promise.race([entered.promise,pending.then(r=>{throw Error('Provider boundary was not reached: '+JSON.stringify(r))})]);
  try{const p=body(),h=await webhook(c,p);expectHttp(h,200);const before=await row(c.fixture,'camera_health_current','camera_device_id',101);
   release.resolve();const s=await pending;expectHttp(s,200);assert.deepEqual(await row(c.fixture,'camera_health_current','camera_device_id',101),before);
   assert.equal(epoch((await row(c.fixture,'camera_devices','id',101)).source_last_seen_at),epoch(p.timestamp));
  }finally{release.resolve();await pending.catch(()=>{});}
 }},
 {name:'http-inventory-first-then-event-preserves-proof-and-original-time',run:async c=>{
  expectHttp(await sync(c),200);const proof=clone((await c.fixture.integration()).metadata.identity_inventory_v1),p=body(),r=await webhook(c,p);expectHttp(r,200);
  assert.deepEqual((await c.fixture.integration()).metadata.identity_inventory_v1,proof);assert.equal(epoch((await row(c.fixture,'camera_devices','id',101)).source_last_seen_at),epoch(p.timestamp));
 }},
 {name:'http-canonical-receiver-end-to-end-token-and-first-ack-replay',run:async c=>{
  const r=await c.request('connect',{action:'test_webhook'});expectHttp(r,200);assert.equal(r.body.receiver_ready,true);
  const attempt=latest(c,'recon_begin_attempt_v2').args,ack=latest(c,'recon_finish_receiver_ack_v2');assert.equal(attempt.p_kind,'receiver_test');
  assert.equal(r.body.ack_event_id,ack.args.p_event_id);
  const first={receiver_ready:r.body.receiver_ready,ack_event_id:r.body.ack_event_id,receiver_tested_at:r.body.receiver_tested_at},audit=await row(c.fixture,'camera_integration_events','id',ack.args.p_event_id);
  assert.equal(audit.recon_receiver_attempt_id,ack.args.p_attempt_id);assert.equal(calls(c,'cos_apply_recon_event_v1').length,0);
  const redelivery=await webhook(c,audit.payload);expectHttp(redelivery,202);assert.equal(redelivery.body.metadata_outcome,'duplicate');
  const saved=await c.fixture.lookup(ack.args.p_attempt_id);assert.deepEqual(saved.terminal.result,first);assert.equal((await c.fixture.integration()).metadata.receiver_tested_at,first.receiver_tested_at);
 }},
 {name:'http-saved-v33-rejected-snapshot-writer-corrected-control-passes',run:async c=>{
  const before=await c.fixture.integration(),legacy=await c.request('v33',{mode:'reconeyez'});expectHttp(legacy,500);
  const writes=directWrites(c);assert(writes.some(x=>x.op==='upsert'));assert.equal(writes.filter(x=>x.op==='update').length,2);
  assert.equal(calls(c,'recon_begin_attempt_v2').length,0);assert.deepEqual(await c.fixture.integration(),before);
  assert(c.adapter.trace.some(x=>x.boundary===c.adapter.transportBoundary&&x.response?.code==='PT409'));
  const count=writes.length,corrected=await reconcile(c);expectHttp(corrected,200);assert.equal(directWrites(c).length,count);assert.equal(calls(c,'recon_finish_reconcile_v2').length,1);
 }},
 {name:'http-saved-v33-timestamp-free-failures-cannot-mask-new-success',run:async c=>{
  let committed;c.adapter.behavior.provider=async()=>{committed=await publishInventory(c);throw Error('Synthetic provider failure after newer success')};
  const legacy=await c.request('v33',{mode:'reconeyez'});expectHttp(legacy,500);
  const integration=await c.fixture.integration();assert.equal(integration.last_sync_status,'ok');assert.equal(epoch(integration.last_sync_at),epoch(committed.token.observed_at));
  const writes=directWrites(c);assert.equal(writes.length,2);for(const write of writes){assert.equal(write.op,'update');assert(!Object.hasOwn(write.body,'last_sync_at'));}
  const failed=c.adapter.trace.filter(x=>x.boundary===c.adapter.transportBoundary&&x.method==='PATCH');assert.equal(failed.length,2);assert(failed.every(x=>x.response.code==='PT409'));
 }},
];

// A real PostgreSQL engine-generated serialization conflict. Its JSON is replayed
// at the handler's transport boundary; this replay is NOT a PostgREST retry test.
export async function nativeSerializationError(fixture) {
 if(typeof fixture.connect!=='function')throw Error('Native replay needs the hosted fixture explicit separate-connection helper.');
 const stale=await fixture.connect('http-native-stale'),current=await fixture.connect('http-native-current');let engineError;
 try {
  await stale.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await stale.query('SET LOCAL ROLE service_role');
  await stale.query('SELECT value FROM public.recon_http_native_conflict WHERE id=1');
  await current.query('SET ROLE service_role');await current.query('UPDATE public.recon_http_native_conflict SET value=value+1 WHERE id=1');
  try{await stale.query('UPDATE public.recon_http_native_conflict SET value=value+1 WHERE id=1')}catch(error){engineError=error}
 }finally{await stale.query('ROLLBACK').catch(()=>{});await stale.end();await current.end();}
 assert(engineError,'A separate-connection native PostgreSQL conflict was required.');assert.equal(engineError.code,'40001');
 return {code:engineError.code,message:engineError.message,details:engineError.detail??null,hint:engineError.hint??null};
}
export const nativeMatrix={name:'native-PG40001-capture-handler-replay-is-distinct-from-PT409',run:async c=>{
 const error=await nativeSerializationError(c.fixture);c.evidence.native40001={origin:'PostgreSQL REPEATABLE READ concurrent UPDATE',code:error.code,transport:'synthetic replay into actual handler client; not PostgREST retry certification'};
 c.adapter.behavior.beforeRpc=({name})=>['recon_finish_inventory_v2','recon_finish_reconcile_v2','recon_record_webhook_receipt_v2'].includes(name)?{data:null,error}:undefined;
 const r=await sync(c);expectHttp(r,502);assert(!r.body.code);assert.equal(calls(c,'recon_begin_attempt_v2').length,1);assert.equal(calls(c,'recon_finish_inventory_v2').length,2);assert.equal(calls(c,'recon_fail_attempt_v2').length,0);assert.equal(directWrites(c).length,0);
 const rec=await reconcile(c);expectHttp(rec,502);assert(!rec.body.code);assert.equal(calls(c,'recon_finish_reconcile_v2').length,2);assert.equal(calls(c,'recon_fail_attempt_v2').length,0);
 const event=await webhook(c,body());expectHttp(event,503);assert.equal(event.body.metadata_error_code,'40001');assert.equal(event.body.applied,true);assert.equal(event.body.health_changed,true);assert.equal(calls(c,'recon_record_webhook_receipt_v2').length,2);
}};
