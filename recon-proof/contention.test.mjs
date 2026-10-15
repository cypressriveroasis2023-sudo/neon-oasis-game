import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createHostedFixture} from './postgres-fixture.mjs';
import {inventoryInput,gid} from '../tech-checks/operations/tests/fixtures/recon-owned-metadata-v2.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const one=async(c,q,args=[])=>(await c.query(q,args)).rows[0];
const value=async(c,q,args=[])=>(await one(c,q,args)).value;
const call=(c,name,args)=>value(c,'SELECT public.'+name+'('+Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')+') AS value',Object.values(args).map(v=>Array.isArray(v)?JSON.stringify(v):v));
const receipt=(c,id)=>call(c,'recon_record_webhook_receipt_v2',{p_event_id:id});
async function begin(c){await c.query('BEGIN');await c.query('SET LOCAL ROLE service_role')}
async function blocked(observer,waiter,blocker){
 const pid=(await one(waiter,'SELECT pg_backend_pid() pid')).pid;return blockedPid(observer,pid,blocker);
}
async function blockedPid(observer,pid,blocker){
 const until=Date.now()+5000;
 while(Date.now()<until){
  const r=await one(observer,'SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1',[pid]);
  if(r?.wait_event_type==='Lock'&&r.blockers.includes(blocker)){console.log('OBSERVED_LOCK '+JSON.stringify(r));return r}
  await wait(20);
 }
 throw Error('No observed expected lock edge '+pid+' -> '+blocker);
}
const run=(name,fn)=>test(name,{timeout:45000},async()=>{const f=await createHostedFixture();try{await fn(f)}finally{await f.close()}});
const clients=async f=>{const out=await Promise.all(['a','b','c','d'].map(n=>f.connect(n)));for(const c of out)c.pid=(await one(c,'SELECT pg_backend_pid() pid')).pid;return out};
const snapshot=f=>f.snapshot();
for(const release of ['COMMIT','ROLLBACK'])run('integration first: duplicate waiter reads fresh marker after '+release,async f=>{
 const [a,b,c]=await clients(f),id=await f.audit();const before=await snapshot(f);
 await begin(a);await a.query("SELECT id FROM camera_integrations WHERE provider='reconeyez' FOR UPDATE");
 await begin(b);const pending=receipt(b,id);pending.catch(()=>{});await blockedPid(f.db,b.pid,a.pid);
 // This succeeds while B waits: B has not taken/read-lock on the requested audit first.
 await begin(c);await c.query('SELECT id FROM camera_integration_events WHERE id=$1 FOR UPDATE NOWAIT',[id]);await c.query('ROLLBACK');
 assert.equal((await receipt(a,id)).outcome,'applied');assert.deepEqual(await snapshot(f),before,'uncommitted metadata and marker remain private');
 await a.query(release);const r=await pending;assert.equal(r.outcome,release==='COMMIT'?'duplicate':'applied');await b.query('COMMIT');
 assert.equal(await f.scalar('SELECT recon_receipt_metadata_applied AS value FROM camera_integration_events WHERE id=$1',[id]),true);
});
for(const release of ['COMMIT','ROLLBACK'])run('audit first: finalizer holds integration while awaiting only requested audit '+release,async f=>{
 const [a,b,c]=await clients(f),id=await f.audit(),other=await f.audit();await begin(a);await a.query('SELECT id FROM camera_integration_events WHERE id=$1 FOR UPDATE',[id]);
 await begin(b);const pending=receipt(b,id);pending.catch(()=>{});await blockedPid(f.db,b.pid,a.pid);
 await begin(c);await assert.rejects(c.query("SELECT id FROM camera_integrations WHERE provider='reconeyez' FOR UPDATE NOWAIT"),e=>e.code==='55P03');await c.query('ROLLBACK');
 await begin(c);await c.query('SELECT id FROM camera_integration_events WHERE id=$1 FOR UPDATE NOWAIT',[other]);await c.query('ROLLBACK');
 await a.query(release);assert.equal((await pending).outcome,'applied');await b.query('COMMIT');
});
run('A/B/A versus never-applied older, exact no-op snapshots and microseconds',async f=>{
 const A=await f.audit({startedAt:'2026-01-01T00:00:00.123456Z'}),old=await f.audit({startedAt:'2026-01-01T00:00:00.123455Z'}),B=await f.audit({startedAt:'2026-01-01T00:00:01.123456Z'});
 const a=await f.rpc('recon_record_webhook_receipt_v2',{p_event_id:A});assert.equal(a.outcome,'applied');
 assert.equal((await f.rpc('recon_record_webhook_receipt_v2',{p_event_id:B})).outcome,'applied');const before=await snapshot(f);
 assert.deepEqual(await f.rpc('recon_record_webhook_receipt_v2',{p_event_id:A}),{...a,outcome:'duplicate',applied:false});
 assert.equal((await f.rpc('recon_record_webhook_receipt_v2',{p_event_id:old})).outcome,'superseded');assert.deepEqual(await snapshot(f),before);
});
async function seed(f){
 await f.db.query("INSERT INTO camera_devices(id,device_serial,external_device_id,device_name,source,source_metadata,last_probe_online_at) VALUES(401,$1,$2,'Synthetic detector','reconeyez',$3,'2026-01-01T00:00:00Z')",['reconeyez:'+gid(2),gid(2),{battery_updated_at:'2026-01-01T00:00:00Z'}]);
 const payload={event_guid:'synthetic-hosted-event',device_info:{guid:gid(2),type:'detector_hdr_xrl'},binary:[{data:'synthetic-only'}],cos_event_order_v1:{key:'hosted-key'}},hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const ref={version:1,bucket:'camera-event-archives',sha256:hash,path:'reconeyez/'+hash+'.json.gz',archivedFields:['binary'],jsonBytes:Buffer.byteLength(JSON.stringify(payload)),storedBytes:16};
 const archived={...payload,cos_private_archive:ref};delete archived.binary;
 await f.db.exec("INSERT INTO storage.buckets VALUES('camera-event-archives',false)");await f.db.query('INSERT INTO storage.objects VALUES($1,$2,$3)',[ref.bucket,ref.path,{size:16}]);
 const id=await f.audit({observedAt:'2026-01-02T00:00:00Z',externalGuid:gid(2),cameraDeviceId:401,type:'DeviceConnected',payload});
 return {id,payload,archived};
}
for(const release of ['COMMIT','ROLLBACK'])run('inventory -> receipt -> projector -> compactor real wait graph '+release,async f=>{
 const {id,payload,archived}=await seed(f),token=await f.begin(),input=await inventoryInput(token.observed_at),[archive,projector,recv,inv]=await clients(f);
 const before=await snapshot(f);await begin(archive);assert.equal(await call(archive,'cos_archive_camera_event_v1',{p_id:id,p_expected:payload,p_archived:archived}),true);
 assert.deepEqual(await snapshot(f),before,'compaction is private before commit');
 await begin(projector);const projected=call(projector,'cos_apply_recon_event_v1',{p_event_id:id,p_event_key:'hosted-key',p_metadata_patch:{}}).then(async r=>{await projector.query('COMMIT');return r});projected.catch(()=>{});await blockedPid(f.db,projector.pid,archive.pid);
 await begin(recv);const received=receipt(recv,id).then(async r=>{await recv.query('COMMIT');return r});received.catch(()=>{});
 // pg_blocking_pids reports the direct heavyweight tuple-lock blocker here.
 // Full observed chain: inventory -> receipt -> projector -> compactor.
 await blockedPid(f.db,recv.pid,projector.pid);
 await begin(inv);const finished=call(inv,'recon_finish_inventory_v2',{p_attempt_id:token.attempt_id,...input}).then(async r=>{await inv.query('COMMIT');return r});finished.catch(()=>{});await blockedPid(f.db,inv.pid,recv.pid);
 await archive.query(release);assert.equal((await projected).outcome,'applied');
 assert.equal((await received).outcome,'applied');assert.equal((await finished).outcome,'applied');
 const event=await f.scalar('SELECT to_jsonb(e) AS value FROM camera_integration_events e WHERE id=$1',[id]);
 assert.equal(event.recon_receipt_metadata_applied,true);assert.equal(event.processed,true);assert.deepEqual(event.payload,release==='COMMIT'?archived:payload);
 const device=await f.scalar('SELECT to_jsonb(d) AS value FROM camera_devices d WHERE id=401');
 assert.equal(Date.parse(device.source_last_seen_at),Date.parse('2026-01-02T00:00:00Z'));assert.equal(Date.parse(device.last_probe_online_at),Date.parse('2026-01-01T00:00:00Z'));
 assert.equal((await f.rpc('recon_record_webhook_receipt_v2',{p_event_id:id})).outcome,'duplicate');
});
run('actual PostgreSQL repeatable-read native40001 stays distinct from PT409',async f=>{
 const [a,b]=await clients(f),id=await f.audit();
 await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await b.query('SET LOCAL ROLE service_role');await b.query("SELECT metadata FROM camera_integrations WHERE provider='reconeyez'");
 await begin(a);assert.equal((await receipt(a,id)).outcome,'applied');await a.query('COMMIT');
 await assert.rejects(receipt(b,id),e=>e.code==='40001'&&/concurrent update/.test(e.message));await b.query('ROLLBACK');
 assert.equal((await f.rpc('recon_record_webhook_receipt_v2',{p_event_id:id})).outcome,'duplicate');
 const token=await f.begin();await f.failure(token);await assert.rejects(f.finish(token,await inventoryInput(token.observed_at)),e=>e.code==='PT409');
});
for(const first of ['older','newer'])for(const release of ['COMMIT','ROLLBACK'])run('concurrent distinct receipts '+first+' first '+release,async f=>{
 const [a,b]=await clients(f),older=await f.audit({startedAt:'2026-01-01T00:00:00Z'}),newer=await f.audit({startedAt:'2026-01-01T00:00:01Z'});
 const firstId=first==='older'?older:newer,secondId=first==='older'?newer:older;
 await begin(a);assert.equal((await receipt(a,firstId)).outcome,'applied');await begin(b);
 const pending=receipt(b,secondId);pending.catch(()=>{});await blockedPid(f.db,b.pid,a.pid);
 assert.equal(await f.scalar('SELECT recon_receipt_metadata_applied AS value FROM camera_integration_events WHERE id=$1',[firstId]),null,'private marker');
 await a.query(release);assert.equal((await pending).outcome,release==='COMMIT'&&first==='newer'?'superseded':'applied');await b.query('COMMIT');
 const stored=await f.integration();assert.equal(stored.metadata.recon_receipt_state_v2.event_id,release==='COMMIT'?newer:secondId);
});
for(const release of ['COMMIT','ROLLBACK'])run('ordered projector first -> receipt -> inventory '+release,async f=>{
 const {id}=await seed(f),token=await f.begin(),input=await inventoryInput(token.observed_at),[projector,recv,inv]=await clients(f);
 await begin(projector);assert.equal((await call(projector,'cos_apply_recon_event_v1',{p_event_id:id,p_event_key:'hosted-key',p_metadata_patch:{}})).outcome,'applied');
 await begin(recv);const received=receipt(recv,id).then(async r=>{await recv.query('COMMIT');return r});received.catch(()=>{});await blockedPid(f.db,recv.pid,projector.pid);
 await begin(inv);const finished=call(inv,'recon_finish_inventory_v2',{p_attempt_id:token.attempt_id,...input}).then(async r=>{await inv.query('COMMIT');return r});finished.catch(()=>{});await blockedPid(f.db,inv.pid,recv.pid);
 assert.equal(await f.scalar('SELECT processed AS value FROM camera_integration_events WHERE id=$1',[id]),false,'uncommitted projection private');
 await projector.query(release);assert.equal((await received).outcome,'applied');assert.equal((await finished).outcome,'applied');
 assert.equal(await f.scalar('SELECT recon_receipt_metadata_applied AS value FROM camera_integration_events WHERE id=$1',[id]),true);
 assert.equal(await f.scalar('SELECT processed AS value FROM camera_integration_events WHERE id=$1',[id]),release==='COMMIT');
});
