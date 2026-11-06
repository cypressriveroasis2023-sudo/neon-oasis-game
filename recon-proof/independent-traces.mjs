import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fixture,proposalSql} from '../tech-checks/operations/tests/fixtures/recon-owned-metadata-v2.mjs';
const results={engine:'PGlite serialized synthetic only',randomized:{},receiptAclCases:[]};
const f=await fixture();
try {
  const audits=[];
  for(let i=0;i<64;i++) {
    const at=new Date(Date.UTC(2026,0,1,0,0,Math.floor(i/2))).toISOString();
    audits.push({id:await f.audit({startedAt:at,type:'Synthetic event '+i,payload:{private_binary:'must-not-appear',untrusted:'https://private.invalid/synthetic'}}),at,applied:false});
  }
  let latest=-1;
  const sequence=[0,2,0,1,2,4,3,6,4,8,10,9,12,10,14,16,15,18];
  let seed=1987; for(let i=0;i<150;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;sequence.push(seed%64);}
  const counts={applied:0,duplicate:0,superseded:0};
  for(const ix of sequence){
    const e=audits[ix],expected=e.applied?'duplicate':ix<latest?'superseded':'applied';
    const before=await f.snapshot();
    const r=await f.rpc('recon_record_webhook_receipt_v2',{p_event_id:e.id});
    assert.deepEqual(Object.keys(r).sort(),['schema_version','event_id','receipt_started_at','outcome','applied'].sort());
    assert.equal(r.event_id,e.id);assert.equal(Date.parse(r.receipt_started_at),Date.parse(e.at));assert.equal(r.outcome,expected);assert.equal(r.applied,expected==='applied');
    assert(!JSON.stringify(r).includes('private'));
    counts[expected]++;
    if(expected==='applied'){e.applied=true;latest=ix;}else assert.deepEqual(await f.snapshot(),before);
    const marker=await f.scalar('SELECT recon_receipt_metadata_applied AS value FROM camera_integration_events WHERE id=$1',[e.id]);
    assert.equal(marker,e.applied?true:null);
  }
  // Historical marker persistence is unbounded by the attempt-ledger age, and outer rollback removes both writes.
  const id=await f.audit({startedAt:'2026-01-02T00:00:00Z'}),before=await f.snapshot();
  await f.db.exec('BEGIN;SET LOCAL ROLE service_role');
  assert.equal((await f.db.query('SELECT recon_record_webhook_receipt_v2($1) AS value',[id])).rows[0].value.outcome,'applied');
  await f.db.exec('ROLLBACK');assert.deepEqual(await f.snapshot(),before);
  assert.equal((await f.rpc('recon_record_webhook_receipt_v2',{p_event_id:id})).outcome,'applied');
  results.randomized={events:64,operations:sequence.length,counts,outerTransactionRollback:'PASS'};
}finally{await f.close();}
// Target the receipt script's independent preflight, not just the core script.
for(const scenario of ['custom_default','inherited_service','service_is_trigger_owner','service_inherits_trigger_owner']){
 const g=await fixture({installV2:false});
 try{
  await g.db.exec(proposalSql['reconeyez-owned-metadata-v2.sql']);
  if(scenario==='custom_default')await g.db.exec('CREATE ROLE synthetic_receipt_acl_extra NOLOGIN;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO synthetic_receipt_acl_extra');
  if(scenario==='inherited_service')await g.db.exec('CREATE ROLE synthetic_receipt_acl_extra NOLOGIN INHERIT;GRANT service_role TO synthetic_receipt_acl_extra');
  if(scenario==='service_is_trigger_owner'||scenario==='service_inherits_trigger_owner'){
   await g.db.exec('CREATE ROLE synthetic_receipt_acl_owner NOLOGIN;GRANT USAGE,CREATE ON SCHEMA public TO synthetic_receipt_acl_owner;CREATE FUNCTION public.recon_v2_audit_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$');
   await g.db.exec('ALTER FUNCTION public.recon_v2_audit_evidence_guard() OWNER TO '+(scenario==='service_is_trigger_owner'?'service_role':'synthetic_receipt_acl_owner'));
   if(scenario==='service_inherits_trigger_owner')await g.db.exec('GRANT synthetic_receipt_acl_owner TO service_role');
  }
  const before=await g.snapshot(),roles=(await g.db.query('SELECT oid,rolname FROM pg_roles ORDER BY oid')).rows,members=(await g.db.query('SELECT * FROM pg_auth_members ORDER BY oid')).rows;
  if(scenario==='service_is_trigger_owner'){
   await g.db.exec(proposalSql['reconeyez-receipt-v2.sql']);
   assert.equal(await g.scalar("SELECT has_function_privilege('service_role','public.recon_v2_audit_evidence_guard()','EXECUTE') AS value"),false);
   assert.equal(await g.scalar("SELECT proowner=(SELECT oid FROM pg_roles WHERE rolname='service_role') AS value FROM pg_proc WHERE oid='public.recon_v2_audit_evidence_guard()'::regprocedure"),true);
   assert.deepEqual((await g.db.query('SELECT oid,rolname FROM pg_roles ORDER BY oid')).rows,roles);assert.deepEqual((await g.db.query('SELECT * FROM pg_auth_members ORDER BY oid')).rows,members);
   results.receiptAclCases.push({scenario,result:'allowed with unchanged owner, effective service EXECUTE false; owner retains preexisting regrant authority'});continue;
  }
  await assert.rejects(g.db.exec(proposalSql['reconeyez-receipt-v2.sql']),e=>e.code==='42501');
  await g.db.exec('ROLLBACK');assert.deepEqual(await g.snapshot(),before);
  assert.deepEqual((await g.db.query('SELECT oid,rolname FROM pg_roles ORDER BY oid')).rows,roles);assert.deepEqual((await g.db.query('SELECT * FROM pg_auth_members ORDER BY oid')).rows,members);
  results.receiptAclCases.push({scenario,result:'fail-closed 42501, fixture state and authorities preserved'});
 }finally{await g.close();}
}
await writeFile(new URL('./evidence/independent-traces.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
