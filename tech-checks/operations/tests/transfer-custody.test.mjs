import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {custodyFixture,IT,SERVICE,OWNER,OTHER} from './helpers/custody-fixture.mjs';
let f;before(async()=>{f=await custodyFixture();});after(async()=>{await f?.close();});
const release=(p,r)=>({p_request_id:randomUUID(),p_transfer_id:p.p_transfer_id,p_equipment_key:p.p_items[0].equipment_key,p_return_event_id:r.p_request_id,p_inventory_confirmed:true,p_notes:'MHelpDesk inventory checked and reconciled by Owner.'});
test('all 105 exact reviewed legacy writers receive the same first transaction gate and preserve identity',async()=>{
 assert.equal(f.definitions.length,105);
 for(const old of f.definitions){const row=(await f.db.query("select pg_get_functiondef(p.oid) definition,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2 and pg_get_function_identity_arguments(p.oid)=$3",[old.schema,old.proname,old.arguments])).rows[0];assert.equal(row.prosecdef,old.prosecdef);assert.equal(row.definition.replace(/  (perform|select) pg_advisory_xact_lock\(hashtextextended\('techcheck-shared-custody-v6',6\)\);\n/,''),old.definition);}
 await assert.rejects(f.db.exec(await f.readMigration('techcheck-custody-writer-lock-order-v6.sql')),/Reviewed custody writer changed/);await f.db.exec('rollback');
});
test('legacy prep, returns, assignments, truck stock and restock each veto a new named checkout without an event',async()=>{
 for(const kind of ['prep','return','registry','inventory','truck','restock']){
  const p=await f.checkout(),i=p.p_items[0],id=randomUUID();
  if(kind==='prep'){await f.db.query("insert into prep_tickets values($1,'released',now())",[id]);await f.db.query("insert into prep_items values($1,$2,'Sniper',$3)",[randomUUID(),id,i.unit_tag]);}
  if(kind==='return')await f.db.query("insert into unit_returns values($1,$2,'Sniper','waiting_it',false)",[id,i.unit_tag]);
  if(kind==='registry')await f.db.query("insert into unit_registry(unit_key,unit_tag,equipment_type,lifecycle_status,current_holder_id) values($1,$1,'Sniper','assigned_to_tech',$2)",[i.unit_tag,SERVICE]);
  if(kind==='inventory')await f.db.query("insert into asset_inventory(unit_key,unit_tag,asset_type,availability_status,assigned_to) values($1,$1,'Sniper','assigned',$2)",[i.unit_tag,SERVICE]);
  if(kind==='truck')await f.db.query("insert into service_truck_units values($1,'Sniper',$2,'assigned')",[SERVICE,i.unit_tag]);
  if(kind==='restock')await f.db.query("insert into service_truck_restock_requests(id,replacement_unit_tag,status) values($1,$2,'ready')",[id,i.unit_tag]);
  await assert.rejects(f.submit(p),/legacy|truck|restock/);assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_events where transfer_id=$1',[p.p_transfer_id])).rows[0].n,0);
 }
});
test('named reservation denies every legacy writer direction, identity change, bypass GUC and clearing data',async()=>{
 const p=await f.checkout(),i=p.p_items[0];await f.submit(p);
 for(const [sql,args] of [
  ["insert into prep_items values($1,null,'Sniper',$2)",[randomUUID(),i.unit_tag]],
  ["insert into unit_returns values($1,$2,'Sniper','completed',true)",[randomUUID(),i.unit_tag]],
  ["insert into service_truck_units values($1,'Sniper',$2,'assigned')",[SERVICE,i.unit_tag]],
  ["insert into service_truck_restock_requests(id,replacement_unit_tag,status) values($1,$2,'ready')",[randomUUID(),i.unit_tag]],
  ["insert into asset_inventory(unit_key,unit_tag,asset_type) values($1,$1,'Sniper')",[i.unit_tag]],
  ["insert into unit_registry(unit_key,unit_tag,equipment_type) values($1,$1,'Sniper')",[i.unit_tag]],
  ["update equipment_master set unit_tag='changed' where equipment_key=$1",[i.equipment_key]],
  ["delete from equipment_master where equipment_key=$1",[i.equipment_key]]
 ])await assert.rejects(f.db.query(sql,args),/unresolved named handoff/);
 await f.db.exec("select set_config('app.techcheck_inventory_permit','true',false)");await assert.rejects(f.db.query("insert into unit_registry(unit_key,unit_tag,equipment_type) values($1,$1,'Sniper')",[i.unit_tag]),/unresolved named/);
 await assert.rejects(f.db.exec('truncate service_truck_units'),/Resolve named/);
 await f.db.query('update equipment_master set updated_at=now() where equipment_key=$1',[i.equipment_key]);
 await f.as(IT,async()=>{await assert.rejects(f.db.query('insert into app_private.techcheck_inventory_permits_v6 values(txid_current(),$1,$2)',[i.equipment_key,IT]),/permission denied/);});
});
test('only explicit active Owner review after passing IT intake reuses legacy inventory release and creates immutable audit',async()=>{
 const p=await f.checkout(),r=await f.returned(p),args=release(p,r);
 for(const actor of [IT,SERVICE,OTHER])await assert.rejects(f.rpc('owner_release_techcheck_return_v6',args,actor),/Active Owner/);
 await assert.rejects(f.rpc('owner_release_techcheck_return_v6',{...args,p_inventory_confirmed:false},OWNER),/Confirm/);
 await assert.rejects(f.rpc('owner_release_techcheck_return_v6',{...args,p_return_event_id:randomUUID()},OWNER),/current passing/);
 const result=await f.rpc('owner_release_techcheck_return_v6',args,OWNER);assert.equal(result.released,true);assert.equal((await f.rpc('owner_release_techcheck_return_v6',args,OWNER)).replayed,true);
 const current=(await f.rpc('techcheck_transfer_context_v1',{})).transfers.find(t=>t.id===p.p_transfer_id);assert.equal(current.inventory_review_complete,true);assert.equal(current.returned_items[0].inventory_released,true);assert.equal(current.state,'returned_review');
 assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where transfer_id=$1',[p.p_transfer_id])).rows[0].n,0);
 assert.equal((await f.db.query('select availability_status from asset_inventory where unit_tag=$1',[p.p_items[0].unit_tag])).rows[0].availability_status,'shop');
 assert.equal((await f.db.query('select count(*)::int n from asset_inventory_history where unit_tag=$1',[p.p_items[0].unit_tag])).rows[0].n,2);
 assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_inventory_permits_v6')).rows[0].n,0);
 await assert.rejects(f.db.query("update app_private.techcheck_inventory_releases_v6 set notes='changed' where id=$1",[args.p_request_id]),/immutable/);
 assert.equal((await f.db.query('select count(*)::int n from unit_returns where unit_tag=$1',[p.p_items[0].unit_tag])).rows[0].n,0);
});
test('damaged equipment remains held until new signed IT repair inspection and separate Owner review',async()=>{
 const p=await f.checkout(),failed=await f.returned(p,false);await assert.rejects(f.rpc('owner_release_techcheck_return_v6',release(p,failed),OWNER),/passing IT intake/);
 await f.db.query("update app_private.techcheck_transfers set created_at=now()-interval '30 days' where id=$1",[p.p_transfer_id]);assert.ok((await f.rpc('techcheck_transfer_context_v1',{})).transfers.some(t=>t.id===p.p_transfer_id));
 const repair=await f.evidence({...failed,p_request_id:randomUUID(),p_expected_revision:3,p_checks:{[p.p_items[0].equipment_key]:Object.fromEntries(Object.keys(failed.p_checks[p.p_items[0].equipment_key]).map(k=>[k,true]))},p_notes:'Repaired electronics and physically reinspected every condition.'});
 assert.equal((await f.submit(repair)).state,'returned_review');
 assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where transfer_id=$1',[p.p_transfer_id])).rows[0].n,1);
 assert.equal((await f.db.query('select snapshot from app_private.techcheck_transfer_events where id=$1',[failed.p_request_id])).rows[0].snapshot.state,'returned_repair');
 await assert.rejects(f.rpc('owner_release_techcheck_return_v6',release(p,failed),OWNER),/current passing/);
 await f.rpc('owner_release_techcheck_return_v6',release(p,repair),OWNER);
});
test('duplicate family-qualified equipment keys cannot represent a second physical unit',async()=>{
 const p=await f.checkout(),i=p.p_items[0];await f.db.query("insert into equipment_master(equipment_key,unit_tag,canonical_family,workflow_type,tracker_state) values($1,$2,'Sniper','Sniper','shop')",['duplicate:'+randomUUID(),i.unit_tag]);await assert.rejects(f.submit(p),/identity is duplicated/);
});
test('real legacy row-lock writer and named checkout serialize with exactly one custody winner',{skip:!process.env.COS_HANDOFF_TEST_DATABASE_URL},async()=>{
 const p=await f.checkout(),i=p.p_items[0];await f.db.query("insert into asset_inventory(unit_key,unit_tag,asset_type,asset_category,availability_status) values($1,$1,'Sniper','device','shop')",[i.unit_tag]);
 const a=new f.pg.Client({connectionString:f.connection}),b=new f.pg.Client({connectionString:f.connection});await a.connect();await b.connect();
 try{
  await a.query('begin');await a.query("select set_config('test.actor',$1,true)",[OWNER]);await a.query('set local role authenticated');await a.query('select owner_assign_inventory_asset($1,$2)',[i.unit_tag,SERVICE]);
  await b.query("select set_config('test.actor',$1,false)",[IT]);await b.query('set role authenticated');
  const competing=b.query(f.sql('submit_techcheck_transfer_v1',p),Object.values(p).map(v=>Array.isArray(v)?JSON.stringify(v):v));const outcome=assert.rejects(competing,/legacy custody|legacy inventory/);await a.query('commit');await outcome;
  assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where equipment_key=$1',[i.equipment_key])).rows[0].n,0);
 }finally{await Promise.all([a.end(),b.end()]);}
});
