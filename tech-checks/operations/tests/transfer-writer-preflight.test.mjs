import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {custodyFixture} from './helpers/custody-fixture.mjs';

let f;before(async()=>{f=await custodyFixture({install:false});});after(async()=>{await f?.close();});
const tables=['equipment_master','unit_registry','prep_items','prep_tickets','unit_returns','asset_inventory','service_truck_units','service_truck_restock_requests'];
test('unreviewed row-locking writers on every guarded table reject before any reviewed definition changes',async()=>{
 const catalog="select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.proowner::regrole::text owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') order by 1,2,3";
 for(const table of tables)for(const uppercase of [false,true]){
  const identifier=uppercase?table.toUpperCase():table;
  await f.db.exec(`create function public.synthetic_inventory_writer() returns void language plpgsql as $$begin perform 1 from public.${identifier} for update;end$$;`);
  const before=(await f.db.query(catalog)).rows;
  try{await assert.rejects(f.db.exec(await f.readMigration('techcheck-custody-writer-lock-order-v6.sql')),/unreviewed inventory writer/,identifier);}
  finally{await f.db.exec('rollback');}
  assert.deepEqual((await f.db.query(catalog)).rows,before,identifier+' rejection must be atomic');
  await f.db.exec('drop function public.synthetic_inventory_writer()');
 }
});
