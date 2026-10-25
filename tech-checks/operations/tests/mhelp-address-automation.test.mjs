import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './mhelp-address-automation-fixture.mjs';
import {readFile} from 'node:fs/promises';
const source='a'.repeat(64),payload='b'.repeat(64),nextSource='c'.repeat(64),nextPayload='d'.repeat(64);
const address={street:'123 Main Road',city:'Houston',state:'Tx',zip:'77002-1234'};
const rec=(id,placement='FIELD',a=address)=>({productId:String(id),unitNumber:'Synthetic '+id,category:'Other',customerId:placement==='SHOP'?'11':'12',customer:'Private customer must never leave database',placement,lifecycle:'UNFLAGGED',sourceAddress:a});
test('accepted import queues unique Field addresses, publishes exact results and reuses unchanged sites across changed counts',async()=>{
 const f=await fixture();try{
  await f.activate([rec(1),rec(2),rec(3,'SHOP',{...address,street:'999 Shop Road'})]);
  assert.equal((await f.tick()).sent,1);
  const sent=(await f.db.query('select * from net.sent')).rows;
  assert.deepEqual(sent[0].params,{street:'123 MAIN ROAD',city:'HOUSTON',state:'TX',zip:'77002',benchmark:'Public_AR_Current',format:'json'});
  assert.equal(JSON.stringify(sent).includes('Private customer'),false);assert.equal((await f.read()).items.length,2);
  const before=await f.snapshot();await f.respond();assert.equal((await f.tick()).settled,1);assert.deepEqual(await f.snapshot(),before,'source, native, Census and membership stay immutable');
  assert.equal((await f.read()).items.filter(i=>i.latitude!==null).length,2);
  await f.activate([rec(1),rec(2),rec(4),rec(3,'SHOP')],nextSource,nextPayload);
  assert.equal((await f.tick()).sent,0,'exact saved address reuses positive evidence');
  const after=await f.read();assert.equal(after.totalProducts,4);assert.equal(after.fieldProducts,3);assert.equal(after.shopProducts,1);assert.ok(after.items.every(i=>i.latitude===29.7&&i.verified===false));assert.equal((await f.tick()).sent,0);
  await f.db.exec("update cos_mhelp_placement_private.census_mhelp_product set source_row_sha256='f' where source_sha256='"+nextSource+"' and product_id='3'");
  await assert.rejects(f.read,/Full current mHelpDesk source/,'tampered Shop proof rejects projection');
 }finally{await f.db.close();}
});
test('wrong-city results remain unlocated and retry automatically; errors back off; incomplete addresses send nothing',async()=>{
 const f=await fixture();try{
  await f.activate([rec(1),rec(2,'FIELD',{street:'Bridge',city:'San Antonio',state:'TX',zip:'78205'})]);await f.tick();
  await f.respond({matchedAddress:'123 MAIN RD, MATHIS, TX, 78368',addressComponents:{city:'MATHIS',state:'TX',zip:'78368'},coordinates:{x:-97.8,y:28}});await f.tick();
  let jobs=(await f.db.query('select * from cos_mhelp_placement_private.address_automation_job order by status')).rows;assert.deepEqual(jobs.map(j=>j.status),['invalid_address','no_match']);assert.equal((await f.read()).items.filter(i=>i.latitude!==null).length,0);assert.ok(jobs.every(j=>Date.parse(j.next_attempt_at)>Date.now()+6*86400000));
  await f.db.exec("update cos_mhelp_placement_private.address_automation_job set next_attempt_at=now()-interval '1 minute' where status='no_match'");assert.equal((await f.tick()).sent,1);
  await f.db.exec('truncate net._http_response;insert into net._http_response select max(id),503,null,false,null from net.sent');await f.tick();
  const job=(await f.db.query("select * from cos_mhelp_placement_private.address_automation_job where status='provider_error'")).rows[0];assert.equal(job.attempts,2);assert.ok(Date.parse(job.next_attempt_at)>Date.now()+5*60000);
 }finally{await f.db.close();}
});
test('superseded requests cannot publish; new Shop placement is excluded; one tick sends at most eight unique addresses',async()=>{
 const f=await fixture();try{
  await f.activate([rec(1)]);await f.tick();await f.respond();
  await f.activate([rec(1,'SHOP'),...Array.from({length:10},(_,i)=>rec(10+i,'FIELD',{...address,street:(200+i)+' Other Road'}))],nextSource,nextPayload);
  const result=await f.tick();assert.equal(result.sent,8);assert.equal(result.settled,0);assert.equal((await f.read()).items.length,10);assert.ok((await f.read()).items.every(i=>i.productId!=='1'));assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.mhelp_address_resolution')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('incomplete owner-corrected address never spreads to an unknown Field Product ID',async()=>{
 const f=await fixture();try{
  const blank={street:'Lee Rd.',city:'Humble',state:'TX',zip:''};await f.activate([rec(1,'FIELD',blank),rec(2,'FIELD',blank)]);await f.tick();
  await f.db.exec(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) select source_sha256,payload_sha256,address_sha256,'public_site_reference','18538 Lee Rd, Humble, TX 77032','address_review','18538 Lee Rd, Houston, TX 77032',29.9,-95.3,now(),'{}','${'e'.repeat(64)}' from cos_mhelp_placement_private.census_mhelp_product limit 1`);
  await f.activate([rec(1,'FIELD',blank),rec(2,'FIELD',blank)],nextSource,nextPayload);await f.tick();assert.equal((await f.read()).items.filter(i=>i.latitude!==null).length,2);
  await f.activate([rec(1,'FIELD',blank),rec(3,'FIELD',blank)],'e'.repeat(64),'f'.repeat(64));await f.tick();assert.equal((await f.read()).items.filter(i=>i.latitude!==null).length,0);
 }finally{await f.db.close();}
});
test('private worker tables and functions deny every browser/service role',async()=>{
 const f=await fixture();try{for(const role of ['anon','authenticated','service_role']){
  await f.db.exec('set role '+role);await assert.rejects(f.tick);await assert.rejects(f.db.query('select * from cos_mhelp_placement_private.address_automation_job'));await f.db.exec('reset role');
 }}finally{await f.db.close();}
});

test('numbered street with city/state can fill missing ZIP while preserving the original bytes',async()=>{
 const f=await fixture();try{
  await f.activate([rec(1,'FIELD',{...address,zip:''})]);assert.equal((await f.tick()).sent,1);const before=await f.snapshot();await f.respond();await f.tick();
  const item=(await f.read()).items[0];assert.equal(item.sourceAddress.zip,'');assert.equal(item.latitude,29.7);assert.equal(item.status,'address_review');assert.deepEqual(await f.snapshot(),before);
 }finally{await f.db.close();}
});
test('a later file with an owner-corrected full address reuses the reviewed reference',async()=>{
 const f=await fixture();try{
  const original={street:'Lee Rd.',city:'Humble',state:'TX',zip:''},corrected={street:'18538 Lee Rd.',city:'Humble',state:'TX',zip:'77032'};
  await f.activate([rec(1,'FIELD',original)]);await f.tick();
  await f.db.query(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) select source_sha256,payload_sha256,address_sha256,'public_site_reference','18538 Lee Rd, Humble, TX 77032','address_review','18538 Lee Rd, Houston, TX 77032',29.9,-95.3,now(),$1,$2 from cos_mhelp_placement_private.census_mhelp_product limit 1`,[{ownerCorrectedAddress:corrected},'e'.repeat(64)]);
  await f.activate([rec(2,'FIELD',corrected)],nextSource,nextPayload);assert.equal((await f.tick()).sent,0);assert.equal((await f.read()).items[0].latitude,29.9);
 }finally{await f.db.close();}
});

test('reviewed incomplete-address references survive returns to Shop but reject changed customer/site context',async()=>{
 const f=await fixture();try{
  const blank={street:'Lee Rd.',city:'Humble',state:'TX',zip:''};await f.activate([rec(1,'FIELD',blank),rec(2,'FIELD',blank)]);await f.tick();
  await f.db.exec(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) select source_sha256,payload_sha256,address_sha256,'public_site_reference','18538 Lee Rd, Humble, TX 77032','address_review','18538 Lee Rd, Houston, TX 77032',29.9,-95.3,now(),'{}','${'e'.repeat(64)}' from cos_mhelp_placement_private.census_mhelp_product limit 1`);
  await f.activate([rec(1,'FIELD',blank),rec(2,'SHOP',blank)],nextSource,nextPayload);assert.equal((await f.tick()).sent,0);let output=await f.read();assert.equal(output.fieldProducts,1);assert.equal(output.shopProducts,1);assert.equal(output.items[0].latitude,29.9);
  for(const [i,change] of [[0,{customerId:'99'}],[1,{customer:'Changed private site label'}]]){
   await f.activate([{...rec(1,'FIELD',blank),...change},rec(2,'SHOP',blank)],String(7+i).repeat(64),String(5+i).repeat(64));await f.tick();assert.equal((await f.read()).items[0].latitude,null,'changed context cannot borrow the old point');
  }
 }finally{await f.db.close();}
});
test('upgrade of the installed cache function preserves all data and enables the guarded subset behavior',async()=>{
 const f=await fixture({legacyCache:true});try{
  const blank={street:'Lee Rd.',city:'Humble',state:'TX',zip:''};await f.activate([rec(1,'FIELD',blank),rec(2,'FIELD',blank)]);await f.tick();
  await f.db.exec(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) select source_sha256,payload_sha256,address_sha256,'public_site_reference','18538 Lee Rd, Humble, TX 77032','address_review','18538 Lee Rd, Houston, TX 77032',29.9,-95.3,now(),'{}','${'e'.repeat(64)}' from cos_mhelp_placement_private.census_mhelp_product limit 1`);
  const before=await f.snapshot();await f.db.exec(await readFile(new URL('../db/mhelp-address-cache-continuity.sql',import.meta.url),'utf8'));assert.deepEqual(await f.snapshot(),before,'function upgrade cannot rewrite source or native data');
  await f.activate([rec(1,'FIELD',blank),rec(2,'SHOP',blank)],nextSource,nextPayload);await f.tick();assert.equal((await f.read()).items[0].latitude,29.9);
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);await assert.rejects(f.db.query('select cos_mhelp_placement_private.address_automation_sync_v1()'));await f.db.exec('reset role');
  }
 }finally{await f.db.close();}
});

test('indexed lookup preserves normalization and indexes both address and reviewed-correction candidate paths',async()=>{
 const f=await fixture();try{
  for(const parts of [address,{street:' 123\tMain\nRoad ',city:' Houston ',state:' tx ',zip:'77002-1234'},{street:null,city:'',state:null,zip:''}]){
   const result=(await f.db.query(`select cos_mhelp_placement_private.address_cache_lookup_key_v1($1,$2,$3,$4)=sha256(convert_to(cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',$1::text,'city',$2::text,'state',$3::text,'zip',$4::text))::text,'UTF8')) same`,[parts.street,parts.city,parts.state,parts.zip])).rows[0];
   assert.equal(result.same,true);
  }
  const indexes=(await f.db.query("select indexname from pg_indexes where indexname in ('census_mhelp_address_exact_lookup','mhelp_address_resolution_corrected_lookup')")).rows;
  assert.equal(indexes.length,2);
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);
   await assert.rejects(f.db.query("select cos_mhelp_placement_private.address_cache_lookup_key_v1('a','b','c','d')"));
   await f.db.exec('reset role');
  }
 }finally{await f.db.close();}
});

test('historical lookup yields identical evidence with thousands of unrelated addresses, mixed priorities and stale payloads',async()=>{
 const outputs=[];
 for(const indexedCache of [false,true]){
  const f=await fixture({indexedCache});try{
   const fieldRecords=Array.from({length:284},(_,i)=>rec(i+1,'FIELD',{...address,street:(1000+i%109)+' Site Road'}));
   await f.activate(fieldRecords);await f.tick();
   await f.db.exec(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,reason,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256)
    select source_sha256,'${payload}',address_sha256,'public_site_reference','Synthetic reviewed site','address_review','Synthetic only','Synthetic reviewed site',29.7,-95.4,'2030-01-01T00:00:00Z','{}','${'e'.repeat(64)}'
    from cos_mhelp_placement_private.census_mhelp_address where source_sha256='${source}';`);
   // No customer production data: 30 historical sources, each 109 unrelated sites.
   await f.db.exec(`insert into cos_mhelp_placement_private.upload_batches
    select lpad(to_hex(i),64,'0'),'${payload}','[]','{"recordCount":0}' from generate_series(1,30)i;
    insert into cos_mhelp_placement_private.census_mhelp_address(source_sha256,address_sha256,street,city,state,zip,status,reason)
    select lpad(to_hex(i),64,'0'),lpad(to_hex(j),64,'0'),(1000+j)::text||' Unrelated Road','OTHER CITY','TX','78000','no_match','Synthetic history'
    from generate_series(1,30)i cross join generate_series(1,109)j;
    insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,reason,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256)
    select source_sha256,'${payload}',address_sha256,'public_site_reference','Unrelated reference','address_review','Synthetic only','Unrelated reference',29,-95,now(),'{}','${'f'.repeat(64)}'
    from cos_mhelp_placement_private.census_mhelp_address where source_sha256<>'${source}';
    insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,reason,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256)
    select source_sha256,'${'f'.repeat(64)}',address_sha256,'public_site_reference','Wrong point','address_review','Stale payload must be ignored','Wrong point',1,1,now()+interval '1 hour','{}','${'e'.repeat(64)}'
    from cos_mhelp_placement_private.census_mhelp_address where source_sha256='${source}';`);
   const nativeBefore=(await f.db.query('select to_jsonb(t) v from public.equipment_units t')).rows;
   await f.activate([...fieldRecords,...Array.from({length:717},(_,i)=>rec(1000+i,'SHOP'))],nextSource,nextPayload);
   const started=performance.now();const tick=await f.tick();const elapsed=performance.now()-started;
   console.log(JSON.stringify({syntheticAddressHistoryLookup:indexedCache?'indexed':'original',elapsedMs:Math.round(elapsed)}));
   assert.equal(tick.sent,0);const result=await f.read();assert.equal(result.totalProducts,1001);assert.equal(result.fieldProducts,284);assert.equal(result.shopProducts,717);assert.equal(result.items.length,284);assert.ok(result.items.every(i=>i.latitude===29.7&&i.longitude===-95.4));
   assert.deepEqual((await f.db.query('select to_jsonb(t) v from public.equipment_units t')).rows,nativeBefore);
   outputs.push(result);
  }finally{await f.db.close();}
 }
 assert.deepEqual(outputs[1],outputs[0],'candidate selection retains the original published result exactly');
});

test('a lookup hash collision cannot authorize reuse of a different full address',async()=>{
 const f=await fixture();try{
  await f.activate([rec(1,'FIELD',{...address,street:'999 Different Road'})]);await f.tick();
  await f.db.exec(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256)
   select source_sha256,payload_sha256,address_sha256,'public_site_reference','Synthetic unrelated point','address_review','Synthetic unrelated point',1,1,now(),'{}','${'e'.repeat(64)}' from cos_mhelp_placement_private.census_mhelp_product;`);
  const hash=(await f.db.query("select encode(cos_mhelp_placement_private.address_cache_lookup_key_v1($1,$2,$3,$4),'hex') hash",[address.street,address.city,address.state,address.zip])).rows[0].hash;
  await f.db.exec(`create or replace function cos_mhelp_placement_private.address_cache_lookup_key_v1(street text,city text,state text,zip text) returns bytea language sql immutable set search_path='' as $$select decode('${hash}','hex')$$;reindex index cos_mhelp_placement_private.census_mhelp_address_exact_lookup;`);
  await f.activate([rec(1)],nextSource,nextPayload);assert.equal((await f.tick()).sent,1);assert.equal((await f.read()).items[0].latitude,null);
 }finally{await f.db.close();}
});
