// Independent sessions, disposable loopback PostgreSQL only. No production URL.
import assert from 'node:assert/strict';
import {restorationFixture,actor,org} from './fixtures/canonical-restoration-fixture.mjs';
import {disposableRestorationPostgres} from './fixtures/canonical-restoration-postgres.mjs';
const database=await disposableRestorationPostgres();
const f=await restorationFixture({database});
const left=await database.connect(),right=await database.connect();
const rpc='select public.cos_owner_restore_seven_bindings_v1($1,$2,$3,$4,$5,$6,$7) v';
const args=(action,digest)=>[actor,org,f.request,action,JSON.stringify(f.expected),digest,action==='commit'?f.confirmation:null];
try{
 const stage=await f.call('stage');
 for(const lock of [
  'lock table public.equipment_units in row exclusive mode',
  'lock table app_private.cos_archived_representation_revocations in row exclusive mode',
  'lock table public.equipment_assignments in row exclusive mode',
  'lock table public.audit_events in row exclusive mode',
  'lock table public.vision_vigilant_devices in row exclusive mode',
  'lock table cos_mhelp_placement_private.scoped_control in row exclusive mode',
  'select * from cos_mhelp_placement_private.upload_control for update',
  'select * from cos_mhelp_placement_private.live_inventory_control for update',
  "select pg_advisory_xact_lock(hashtext('COS_OWNER_EQUIPMENT_V1'))",
 ]){
  await left.query('begin');await left.query(lock);
  await assert.rejects(right.query(rpc,args('commit',stage.digest)),e=>['55P03','40001'].includes(e.code));
  await left.query('rollback');assert.deepEqual(await f.stored(),f.rows);
 }
 console.log('PASS concurrent native/camera/source/scope/editor writers reject without writes');
 await left.query('begin');await left.query(rpc,args('commit',stage.digest));
 await assert.rejects(right.query(rpc,args('commit',stage.digest)),e=>e.code==='55P03');
 await left.query('commit');assert.equal((await right.query(rpc,args('commit',stage.digest))).rows[0].v.replayed,true);
 assert.equal((await f.db.query('select count(*)::int n from cos_binding_restoration_private.receipts')).rows[0].n,1);
 console.log('PASS simultaneous commits produce one immutable receipt and exact retry');
 // Protected-table locks prevent another writer crossing a reviewed transaction.
 await left.query('begin');await left.query(rpc,args('commit',stage.digest));
 let finished=false;
 const writing=right.query("update app_private.vision_tracker_locations set sim='later-synthetic-sim' where id=$1",[f.targets[0].tracker]).then(()=>{finished=true;});
 const deadline=Date.now()+3000;let waited=false;
 while(Date.now()<deadline){const row=(await f.db.query('select wait_event_type from pg_stat_activity where pid=$1',[right.processID])).rows[0];if(row?.wait_event_type==='Lock'){waited=true;break;}await new Promise(r=>setTimeout(r,20));}
 assert.equal(waited,true);assert.equal(finished,false);await left.query('commit');await writing;
 await assert.rejects(f.call('commit',stage.digest),/changed/);
 console.log('PASS later tracker writer waits, then invalidates replay without being overwritten');
}finally{await f.db.close();}
