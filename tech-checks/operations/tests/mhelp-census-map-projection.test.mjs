import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,org,actor} from './fixtures/owner-identity-upload-fixture.mjs';
test('current source exposes all 287 MHelp FIELD addresses independently of GPS, camera and hold evidence',async()=>{
 const f=await fixture({recordCount:1001});
 try{
  const db=f.db;
  await db.exec("create table cos_mhelp_placement_private.census_mhelp_address(source_sha256 text,address_sha256 text,status text,reason text,census_benchmark text,matched_address text,latitude float8,longitude float8,completed_at timestamptz,primary key(source_sha256,address_sha256));");
  await db.exec("create table cos_mhelp_placement_private.census_mhelp_product(source_sha256 text,payload_sha256 text,product_id text,source_row_sha256 text,placement text,address_sha256 text,primary key(source_sha256,product_id));");
  const all="with rows as (select b.source_sha256,b.payload_sha256,r,row_number() over() i from cos_mhelp_placement_private.upload_batches b cross join lateral jsonb_array_elements(b.records) r)";
  await db.exec(all+" insert into cos_mhelp_placement_private.census_mhelp_address(source_sha256,address_sha256,status,reason,census_benchmark,matched_address,latitude,longitude,completed_at) select source_sha256,encode(sha256(convert_to(r::text,'UTF8')),'hex'),case when i<=147 then 'matched' when i<=161 then 'address_review' when i<=273 then 'no_match' else 'invalid_address' end, case when i between 148 and 161 then 'address review' else null end,case when i<=161 then 'Public_AR_Current' else null end,case when i<=161 then '123 EXAMPLE RD, HOUSTON, TX, 77002' else null end,case when i<=161 then 29.7 else null end,case when i<=161 then -95.4 else null end,case when i<=161 then '2026-10-17T19:00:00Z'::timestamptz else null end from rows;");
  await db.exec(all+" insert into cos_mhelp_placement_private.census_mhelp_product(source_sha256,payload_sha256,product_id,source_row_sha256,placement,address_sha256) select source_sha256,payload_sha256,r->>'productId',encode(sha256(convert_to(r::text,'UTF8')),'hex'),r->>'placement',encode(sha256(convert_to(r::text,'UTF8')),'hex') from rows;");
  const before=await f.preserved();
  const mig=await readFile(new URL('../db/cos_mhelp_census_map_projection_20261017.sql',import.meta.url),'utf8');
  await db.exec(await readFile(new URL('../db/cos_mhelp_address_resolutions_20261017.sql',import.meta.url),'utf8'));
  await db.exec(mig);
  const read=async()=>(await db.query('select public.cos_mhelp_census_map_snapshot($1,$2) v',[actor,org])).rows[0].v;
  const output=await read();
  assert.equal(output.contract,'COS_MHELP_CENSUS_ADDRESS_MAP_V1');
  assert.equal(output.totalProducts,1001);assert.equal(output.fieldProducts,287);assert.equal(output.shopProducts,714);
  assert.equal(output.verifiedGps,false);assert.equal(output.liveGps,false);
  assert.equal(output.items.length,287);
  assert.equal(output.items.filter(r=>r.status==='matched').length,147);
  assert.equal(output.items.filter(r=>r.status==='address_review').length,14);
  assert.equal(output.items.filter(r=>r.status==='no_match').length,112);
  assert.equal(output.items.filter(r=>r.status==='invalid_address').length,14);
  assert.equal(output.items.filter(r=>r.latitude!==null).length,161);
  assert.ok(output.items.every(r=>r.placement==='FIELD'&&r.verified===false&&r.liveGps===false));
  assert.ok(output.items.some(r=>r.unitNumber==='Synthetic source 1'),'DO_NOT_USE field remains visible by service address');
  assert.deepEqual(await f.preserved(),before,'no GPS, IP, inventory or placement mutation');
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(read);
   await db.exec('reset role');
  }
  await db.exec('set role service_role');assert.equal((await read()).items.length,287);await db.exec('reset role');
  const unresolved=output.items.find(r=>r.status==='no_match');
  const insert=`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) values($1,$2,$3,'geocodio','123 Example Rd, Houston, TX 77002','matched','123 EXAMPLE RD, HOUSTON, TX 77002',$4,$5,'2026-10-17T19:00:00Z','{}',$6)`;
  await assert.rejects(db.query(insert,[output.sourceSha256,output.payloadSha256,unresolved.sourceRowSha256,null,null,'d'.repeat(64)]),/check constraint/);
  await db.query(insert,[output.sourceSha256,'f'.repeat(64),unresolved.sourceRowSha256,29.8,-95.4,'e'.repeat(64)]);
  assert.equal((await read()).items.find(r=>r.productId===unresolved.productId).status,'no_match','foreign payload never borrows an address result');
  await db.query(insert,[output.sourceSha256,output.payloadSha256,unresolved.sourceRowSha256,29.8,-95.4,'f'.repeat(64)]);
  const recovered=(await read()).items.find(r=>r.productId===unresolved.productId);
  assert.equal(recovered.status,'matched');assert.equal(recovered.originalStatus,'no_match');assert.equal(recovered.geocodeSource,'geocodio');assert.equal(recovered.verified,false);assert.equal(recovered.latitude,29.8);
  await db.exec(await readFile(new URL('../db/20261018041534_cos_mhelp_public_site_reference.sql',import.meta.url),'utf8'));
  const publicInsert=insert.replace("'geocodio'","'public_site_reference'");
  await assert.rejects(db.query(publicInsert,[output.sourceSha256,output.payloadSha256,unresolved.sourceRowSha256,29.81,-95.41,'1'.repeat(64)]),/check constraint/);
  await db.query(publicInsert.replace("'matched'","'address_review'"),[output.sourceSha256,output.payloadSha256,unresolved.sourceRowSha256,29.81,-95.41,'2'.repeat(64)]);
  const approximate=(await read()).items.find(r=>r.productId===unresolved.productId);
  assert.equal(approximate.geocodeSource,'public_site_reference');assert.equal(approximate.status,'address_review');
  assert.equal(approximate.verified,false);assert.equal(approximate.latitude,29.81);
  assert.deepEqual(await f.preserved(),before,'address result cannot mutate inventory or GPS');
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);await assert.rejects(db.query('select * from cos_mhelp_placement_private.mhelp_address_resolution'));await db.exec('reset role');
  }

  await db.query("update cos_mhelp_placement_private.census_mhelp_product set source_row_sha256='f' where product_id=$1",[output.items[0].productId]);
  await assert.rejects(read,/Full current mHelpDesk source\/address audit unavailable/);
 }finally{await f.db.close();}
});
