import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,hash,org,native,tracker} from './fixtures/owner-identity-upload-fixture.mjs';

const sql=async file=>readFile(new URL('../db/'+file,import.meta.url),'utf8');

test('layered source transition migration installs on existing PR200 reader without changing inventory',async()=>{
 const f=await fixture({recordCount:1001});
 try{
  const before=await f.snapshot(),preserved=await f.preserved();
  // The existing identity fixture installs the compact graph guard but skips
  // this separate source-graph reader; add its original unchanged definition.
  const continuity=await sql('mhelp-source-continuity.sql');
  const start=continuity.indexOf('-- Same complete graph'),end=continuity.indexOf('create function cos_mhelp_placement_private.continuity_unchanged');
  assert.ok(start>=0&&end>start);
  await f.db.exec(continuity.slice(start,end));
  await f.db.exec(await sql('cos_source_transition_continuity_20261017.sql'));
  assert.deepEqual(await f.snapshot(),before);
  assert.deepEqual(await f.preserved(),preserved);
  const projected=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() v')).rows[0].v;
  assert.equal(projected.records.length,1001);
  assert.equal(projected.records.filter(r=>r.placement==='FIELD').length,287);
  assert.equal(projected.records.filter(r=>r.placement==='SHOP').length,714);
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.source_transition_receipts')).rows[0].n,0);
  const held=(await f.db.query("select cos_mhelp_placement_private.source_transition_review($1,$2,$3,$4) v",[hash,hash,hash,'2258987'])).rows[0].v;
  assert.equal(held.eligible,false);
  assert.equal(held.reason,'active_source_or_payload_changed');
  const excluded=(await f.db.query("select cos_mhelp_placement_private.source_transition_review($1,$2,$3,$4) v",[hash,hash,hash,'2301876'])).rows[0].v;
  assert.equal(excluded.reason,'separate_identity_review_required');
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);
   await assert.rejects(()=>f.db.query('select * from cos_mhelp_placement_private.source_transition_receipts'));
   await assert.rejects(()=>f.db.query('select cos_mhelp_placement_private.source_transition_review($1,$2,$3,$4)',[hash,hash,hash,'2258987']));
   await f.db.exec('reset role');
  }
  await assert.rejects(()=>f.db.exec('delete from cos_mhelp_placement_private.source_transition_receipts'),/immutable/);
  await assert.rejects(()=>f.db.exec('truncate cos_mhelp_placement_private.source_transition_receipts'),/immutable/);
 }finally{await f.db.close();}
});
