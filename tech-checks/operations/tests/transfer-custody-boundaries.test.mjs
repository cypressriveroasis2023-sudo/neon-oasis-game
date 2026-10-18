import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {custodyFixture,IT,SERVICE,OWNER} from './helpers/custody-fixture.mjs';

let f;
before(async()=>{f=await custodyFixture();});
after(async()=>{await f?.close();});
const tables=['equipment_master','unit_registry','prep_items','prep_tickets','unit_returns','asset_inventory','service_truck_units','service_truck_restock_requests'];
const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await f.db.query(`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) rows from public.${table} r`)).rows[0].rows])));

test('held preexisting Shop rows reject update and delete, including indirect prep ticket changes, atomically',async()=>{
 const p=await f.checkout(),i=p.p_items[0],prep=randomUUID(),item=randomUUID(),returned=randomUUID(),restock=randomUUID();
 await f.db.query("insert into unit_registry(unit_key,unit_tag,equipment_type,lifecycle_status) values($1,$1,'Sniper','shop_inventory')",[i.unit_tag]);
 await f.db.query("insert into asset_inventory(unit_key,unit_tag,asset_type,asset_category,availability_status) values($1,$1,'Sniper','device','shop')",[i.unit_tag]);
 await f.db.query("insert into prep_tickets values($1,'completed',now())",[prep]);
 await f.db.query("insert into prep_items values($1,$2,'Sniper',$3)",[item,prep,i.unit_tag]);
 await f.db.query("insert into unit_returns values($1,$2,'Sniper','completed',true)",[returned,i.unit_tag]);
 await f.db.query("insert into service_truck_restock_requests(id,replacement_unit_tag,status) values($1,$2,'accepted')",[restock,i.unit_tag]);
 await f.submit(p);
 const before=await snapshot();
 for(const [table,column,value,change] of [
  ['equipment_master','equipment_key',i.equipment_key,"unit_tag='moved-away'"],
  ['unit_registry','unit_key',i.unit_tag,"unit_tag='moved-away'"],
  ['asset_inventory','unit_key',i.unit_tag,"unit_tag='moved-away'"],
  ['prep_items','id',item,"unit_tag='moved-away'"],
  ['prep_tickets','id',prep,"status='released'"],
  ['unit_returns','id',returned,"unit_tag='moved-away'"],
  ['service_truck_restock_requests','id',restock,"replacement_unit_tag='moved-away'"]
 ]){
  await assert.rejects(f.db.query(`update public.${table} set ${change} where ${column}=$1`,[value]),/unresolved named handoff/,table+' update');
  await assert.rejects(f.db.query(`delete from public.${table} where ${column}=$1`,[value]),/unresolved named handoff/,table+' delete');
 }
 assert.deepEqual(await snapshot(),before);
 assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_events where transfer_id=$1',[p.p_transfer_id])).rows[0].n,1);
});

test('an unheld neighbor can change and be deleted but cannot move into a reserved tag in any direction',async()=>{
 const p=await f.checkout(),i=p.p_items[0],neighbor='neighbor-'+randomUUID(),prep=randomUUID();await f.submit(p);
 const cases=[
  ["insert into unit_registry(unit_key,unit_tag,equipment_type,lifecycle_status) values($1,$1,'Sniper','shop_inventory')","unit_registry","unit_key","unit_tag"],
  ["insert into asset_inventory(unit_key,unit_tag,asset_type,availability_status) values($1,$1,'Sniper','shop')","asset_inventory","unit_key","unit_tag"],
  ["insert into service_truck_units values('"+SERVICE+"','Sniper',$1,'assigned')","service_truck_units","unit_tag","unit_tag"],
  ["insert into equipment_master(equipment_key,unit_tag,canonical_family,tracker_state) values($1,$1,'Sniper','shop')","equipment_master","equipment_key","unit_tag"]
 ];
 for(const [insert,table,key,tag] of cases){
  await f.db.query(insert,[neighbor]);
  await assert.rejects(f.db.query(`update ${table} set ${tag}=$1 where ${key}=$2`,[i.unit_tag,neighbor]),/unresolved named handoff/,table);
  assert.equal((await f.db.query(`select ${tag} tag from ${table} where ${key}=$1`,[neighbor])).rows[0].tag,neighbor);
  await f.db.query(`update ${table} set ${tag}=${tag} where ${key}=$1`,[neighbor]);
  await f.db.query(`delete from ${table} where ${key}=$1`,[neighbor]);
 }
 for(const [table,tag] of [['unit_returns','unit_tag'],['service_truck_restock_requests','replacement_unit_tag']]){
  const id=randomUUID();
  if(table==='unit_returns')await f.db.query("insert into unit_returns values($1,$2,'Sniper','completed',true)",[id,neighbor]);
  else await f.db.query("insert into service_truck_restock_requests(id,replacement_unit_tag,status) values($1,$2,'accepted')",[id,neighbor]);
  await assert.rejects(f.db.query(`update ${table} set ${tag}=$1 where id=$2`,[i.unit_tag,id]),/unresolved named handoff/);
  await f.db.query(`delete from ${table} where id=$1`,[id]);
 }
 await f.db.query("insert into prep_tickets values($1,'completed',now())",[prep]);
 const prepItem=randomUUID();await f.db.query("insert into prep_items values($1,$2,'Sniper',$3)",[prepItem,prep,neighbor]);
 await assert.rejects(f.db.query('update prep_items set unit_tag=$1 where id=$2',[i.unit_tag,prepItem]),/unresolved named handoff/);
 await f.db.query("update prep_tickets set status='released' where id=$1",[prep]);
 await f.db.query('delete from prep_items where id=$1',[prepItem]);await f.db.query('delete from prep_tickets where id=$1',[prep]);
});

test('all eight legacy tables reject truncation without changing any rows while named custody exists',async()=>{
 const p=await f.checkout();await f.submit(p);const before=await snapshot();
 // CASCADE gets past PostgreSQL's FK preflight so the custody statement guard
 // itself must deny even a request to clear dependent reservation records.
 for(const table of tables)await assert.rejects(f.db.exec(`truncate public.${table} cascade`),/Resolve named equipment custody/,table);
 assert.deepEqual(await snapshot(),before);
 assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where transfer_id=$1',[p.p_transfer_id])).rows[0].n,1);
});

test('a cross-family bare-tag reservation cannot become a second physical checkout',async()=>{
 const p=await f.checkout(),other=await f.checkout(),i=p.p_items[0],j=other.p_items[0];
 await f.db.query("update equipment_master set canonical_family='Recon',workflow_type='Recon',source_family='Recon',unit_tag=$1 where equipment_key=$2",[i.unit_tag,j.equipment_key]);
 await f.submit(p);
 await assert.rejects(f.db.query('insert into app_private.techcheck_transfer_reservations(equipment_key,transfer_id) values($1,$2)',[j.equipment_key,p.p_transfer_id]),/bare-tag collision/);
 assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where transfer_id=$1',[p.p_transfer_id])).rows[0].n,1);
});

test('named checkout wins the reverse race and the actual legacy Owner assignment waits then rejects',{skip:!process.env.COS_HANDOFF_TEST_DATABASE_URL},async()=>{
 const p=await f.checkout(),i=p.p_items[0];await f.db.query("insert into asset_inventory(unit_key,unit_tag,asset_type,asset_category,availability_status) values($1,$1,'Sniper','device','shop')",[i.unit_tag]);
 const a=new f.pg.Client({connectionString:f.connection}),b=new f.pg.Client({connectionString:f.connection});await a.connect();await b.connect();
 try{
  await a.query('begin');await a.query("select set_config('test.actor',$1,true)",[IT]);await a.query('set local role authenticated');
  await a.query(f.sql('submit_techcheck_transfer_v1',p),Object.values(p).map(v=>Array.isArray(v)?JSON.stringify(v):v));
  const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  await b.query("select set_config('test.actor',$1,false)",[OWNER]);await b.query('set role authenticated');
  const competing=b.query('select owner_assign_inventory_asset($1,$2)',[i.unit_tag,SERVICE]).then(value=>({value}),error=>({error}));
  let wait;for(let attempt=0;attempt<100;attempt++){
   wait=(await f.db.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[pid])).rows[0];
   if(wait?.wait_event_type==='Lock'&&wait.wait_event==='advisory')break;
   await setTimeout(25);
  }
  assert.deepEqual(wait,{wait_event_type:'Lock',wait_event:'advisory'});
  await a.query('commit');const result=await competing;assert.match(result.error?.message||'',/unresolved named handoff/);
  assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where equipment_key=$1',[i.equipment_key])).rows[0].n,1);
  assert.equal((await f.db.query('select availability_status from asset_inventory where unit_key=$1',[i.unit_tag])).rows[0].availability_status,'shop');
  assert.equal((await f.db.query('select count(*)::int n from asset_inventory_history where unit_key=$1',[i.unit_tag])).rows[0].n,0);
 }finally{await a.query('rollback').catch(()=>{});await Promise.all([a.end(),b.end()]);}
});
