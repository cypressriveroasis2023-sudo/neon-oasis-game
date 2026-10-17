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
  await f.db.exec("create schema net;create table net._http_response(id bigint,status_code integer,error_msg text,content text);");
  await f.db.exec(await src('cos_full_mhelp_census_processing_20261017.sql'));
  const classify=async (content,httpCode=200,error=null)=>(await f.db.query(
   'select cos_mhelp_placement_private.census_mhelp_classify_response($1,$2,$3,$4,$5,$6,$7) v',
   [httpCode,error,content,'123 Main St','HOUSTON','TX','77002'])).rows[0].v;
  const positive={result:{input:{benchmark:{benchmarkName:'Public_AR_Current'}},
   addressMatches:[{matchedAddress:'123 MAIN ST, HOUSTON, TX, 77002',
    coordinates:{x:-95.3,y:29.7},addressComponents:{zip:'77002',city:'HOUSTON',state:'TX'}}]}};
  assert.equal((await classify(JSON.stringify(positive))).status,'matched');
  assert.equal((await classify(JSON.stringify({...positive,result:{...positive.result,addressMatches:[]}}))).status,'no_match');
  assert.equal((await classify(JSON.stringify({...positive,result:{...positive.result,addressMatches:[positive.result.addressMatches[0],positive.result.addressMatches[0]]}}))).status,'ambiguous');
  const offCity=structuredClone(positive);offCity.result.addressMatches[0].addressComponents.city='KATY';
  assert.equal((await classify(JSON.stringify(offCity))).status,'address_review');
  assert.equal((await classify('not-json')).status,'provider_error');
  assert.equal((await classify('{}',503,'upstream error')).status,'provider_error');
  assert.deepEqual(await f.preserved(),before,'Response classification cannot update native records');
 }finally{await f.db.close();}
});