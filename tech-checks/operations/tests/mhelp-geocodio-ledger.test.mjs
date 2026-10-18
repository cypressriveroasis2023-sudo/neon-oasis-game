import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const migration=await readFile(new URL('../db/20261018021255_cos_mhelp_address_geocodio.sql',import.meta.url),'utf8');
const source='a'.repeat(64),payload='b'.repeat(64),org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
async function fixture(limit=2){
 const db=new PGlite();await db.exec(await readFile(new URL('./fixtures/mhelp-geocodio-ledger.sql',import.meta.url),'utf8'));await db.query('update app_private.cos_geocodio_control set daily_limit=$1',[limit]);
 await db.exec(migration);
 const add=async(address)=>await db.query(`insert into app_private.cos_mhelp_address_geocodio_jobs(source_sha256,payload_sha256,address_sha256,street,city,state,zip,product_count,approval_reference)
 values($1,$2,$3,'123 Example Rd','Houston','TX','77002',4,'Synthetic operator approval')`,[source,payload,address]);
 const claim=async(address,s=source)=>(await db.query('select public.cos_mhelp_address_geocodio_claim_v1($1,$2,$3) v',[s,payload,address])).rows[0].v;
 const finish=async(address,c,status='received',reason=null,code=200,receipt={results:[]},retry=null)=>(await db.query('select public.cos_mhelp_address_geocodio_finish_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) v',
  [source,payload,address,c.requestId,c.reservationToken,status,reason,code,receipt,retry])).rows[0].v;
 const credits=async()=>(await db.query('select coalesce(sum(credits),0)::int n from app_private.cos_geocodio_daily_budget')).rows[0].n;
 return {db,add,claim,finish,credits};
}
test('one source-bound address claim shares existing quota and duplicate calls cannot spend twice',async()=>{
 const f=await fixture(1),a='c'.repeat(64),b='d'.repeat(64);try{
  await f.add(a);await f.add(b);assert.equal((await f.claim(a,'f'.repeat(64))).status,'not_enrolled');assert.equal(await f.credits(),0);
  const [one,two]=await Promise.all([f.claim(a),f.claim(a)]);assert.equal([one,two].filter(c=>c.claimed).length,1);assert.equal(await f.credits(),1);
  assert.equal((await f.claim(b)).status,'budget_exhausted');assert.equal(await f.credits(),1);
  const row=(await f.db.query('select job_kind,audit_id,native_binding,mhelp_address_binding from app_private.cos_geocodio_reservations')).rows[0];
  assert.equal(row.job_kind,'mhelp_address_reference');assert.equal(row.audit_id,null);assert.equal(row.native_binding,null);
  assert.deepEqual(row.mhelp_address_binding,{sourceSha256:source,payloadSha256:payload,addressSha256:a});
 }finally{await f.db.close();}
});
test('anon and ordinary authenticated callers cannot reserve, complete, or read private addresses',async()=>{
 const f=await fixture(),a='c'.repeat(64);try{await f.add(a);
  for(const role of ['anon','authenticated']){await f.db.exec('set role '+role);await assert.rejects(f.claim(a));await assert.rejects(f.db.query('select * from app_private.cos_mhelp_address_geocodio_jobs'));await f.db.exec('reset role');}
  await f.db.exec('set role service_role');assert.equal((await f.claim(a)).claimed,true);await assert.rejects(f.db.query('select * from app_private.cos_mhelp_address_geocodio_jobs'));await f.db.exec('reset role');
 }finally{await f.db.close();}
});
test('a receipt must match its reservation and can finish only once without equipment writes',async()=>{
 const f=await fixture(),a='c'.repeat(64);try{await f.add(a);const c=await f.claim(a),before=(await f.db.query('select * from synthetic_equipment')).rows;
  assert.equal((await f.finish(a,{...c,reservationToken:'99999999-9999-4999-8999-999999999999'})).accepted,false);
  assert.equal((await f.finish(a,c)).accepted,true);assert.equal((await f.finish(a,c)).accepted,false);assert.equal((await f.claim(a)).status,'received');assert.equal(await f.credits(),1);
  const row=(await f.db.query('select receipt,receipt_sha256,status from app_private.cos_mhelp_address_geocodio_jobs')).rows[0];assert.equal(row.receipt_sha256.length,64);assert.deepEqual(row.receipt,{results:[]});
  assert.deepEqual((await f.db.query('select * from synthetic_equipment')).rows,before);
 }finally{await f.db.close();}
});
test('provider failures keep charged requests and apply the shared account stop before another address',async()=>{
 for(const [reason,code,retry] of [['provider_forbidden',403,null],['provider_rate_limited',429,120]]){
  const f=await fixture(),a='c'.repeat(64),b='d'.repeat(64);try{await f.add(a);await f.add(b);const c=await f.claim(a);
   assert.equal((await f.finish(a,c,'provider_error',reason,code,null,retry)).accepted,true);assert.equal((await f.claim(a)).status,'provider_error');
   assert.equal((await f.claim(b)).status,'account_deferred');assert.equal(await f.credits(),1);
  }finally{await f.db.close();}
 }
});
test('existing use, disabled free-only controls and legacy job-kind constraints remain authoritative',async()=>{
 const f=await fixture(2),a='c'.repeat(64);try{await f.add(a);
  await f.db.exec("insert into app_private.cos_geocodio_daily_budget values((clock_timestamp() at time zone 'America/New_York')::date,2)");assert.equal((await f.claim(a)).status,'budget_exhausted');
  await f.db.exec('update app_private.cos_geocodio_control set free_only=false');assert.equal((await f.claim(a)).status,'configuration_unavailable');
  assert.equal(await f.credits(),2);
  const insert=`insert into app_private.cos_geocodio_reservations(request_id,organization_id,unit_key,address,address_sha256,budget_day,reserved_at,lease_until,send_before,job_kind) values(gen_random_uuid(),'${org}','synthetic','123 Example Rd','${a}',(clock_timestamp() at time zone 'America/New_York')::date,clock_timestamp(),clock_timestamp()+interval '60 seconds',clock_timestamp()+interval '10 seconds','owner_audit')`;
  await assert.rejects(f.db.exec(insert),/check constraint/);
  assert.equal((await f.db.query('select count(*)::int n from app_private.cos_geocodio_reservations')).rows[0].n,0);
 }finally{await f.db.close();}
});
