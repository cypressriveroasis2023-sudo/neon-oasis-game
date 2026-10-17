import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures/owner-identity-upload-fixture.mjs';

const src=async name=>readFile(new URL('../db/'+name,import.meta.url),'utf8');
test('complete Census enrollment retains exactly 1001 immutable Product IDs and placement count',async()=>{
 const f=await fixture({recordCount:1001});
 try{
  const before=await f.preserved();
  const base=(await f.db.query('select source_sha256,payload_sha256 from cos_mhelp_placement_private.upload_batches')).rows[0];
  const ddl=await src('cos_full_mhelp_census_address_audit_20261017.sql');
  await f.db.exec(ddl);
  const deploy=await src('cos_full_mhelp_census_enroll_oct16_20261017.sql');
  const synthetic=deploy.replaceAll('7893cec87f652954f7a9015e0ac82ea107b9200f23fa91cca5d0e8337c5ee891',base.source_sha256)
   .replaceAll('0dd24712795aff7ea7b1a2474c27fc467d04578cc4630bf7220c6cb7caebc68e',base.payload_sha256);
  await f.db.exec(synthetic);
  const rows=(await f.db.query("select source_sha256,product_id,placement from cos_mhelp_placement_private.census_mhelp_product")).rows;
  assert.equal(rows.length,1001);
  assert.equal(rows.filter(x=>x.placement==='FIELD').length,287);
  assert.equal(rows.filter(x=>x.placement==='SHOP').length,714);
  assert.equal(new Set(rows.map(x=>x.product_id)).size,1001);
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.census_mhelp_address')).rows[0].n>0,true);
  assert.deepEqual(await f.preserved(),before,'original GPS/history/mHelp uploads and identity untouched');
  const input=(await f.db.query('select cos_mhelp_placement_private.census_mhelp_address_input($1::jsonb) normalized',[{sourceAddress:{street:' 123  Sample Road ',city:' Exampleville ',state:'Tx',zip:'77020 - GATE 1070#'}}])).rows[0].normalized;
  assert.deepEqual(input,{street:'123 Sample Road',city:'Exampleville',state:'TX',zip:'77020'});
  await assert.rejects(()=>f.db.exec('update cos_mhelp_placement_private.census_mhelp_product set product_id=product_id'),/append-only/);
  await assert.rejects(()=>f.db.exec('truncate cos_mhelp_placement_private.census_mhelp_product'),/append-only/);
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);
   await assert.rejects(()=>f.db.query('select * from cos_mhelp_placement_private.census_mhelp_product'));
   await f.db.exec('reset role');
  }
  await assert.rejects(()=>f.db.exec(synthetic),'Duplicate enrollment must not silently reimport');
 }finally{await f.db.close();}
});