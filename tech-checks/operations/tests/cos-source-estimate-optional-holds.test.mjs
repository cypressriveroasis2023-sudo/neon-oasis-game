import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture,ORG,SOURCE,PAYLOAD,AUTH} from './fixtures/source-equipment-cache-fixture.mjs';

const migration=()=>readFile(new URL('../db/cos_source_estimate_optional_holds_20261017.sql',import.meta.url),'utf8');
const guard=async (db,row)=>(await db.query('select cos_mhelp_placement_private.source_estimate_record_current($1::jsonb) ok',[row])).rows[0].ok;
const stripped=r=>{const a=structuredClone(r);delete a.placementHeld;delete a.possibleAliasUnitIds;return a;};

test('exact installed source guard preserves immutable/protected receipts and admits optional-absent Field source only',async()=>{
 const f=await fixture();
 try {
  const untouched=await f.db.query("select (select jsonb_agg(t) from public.equipment_units t) native,(select jsonb_agg(t) from app_private.vision_tracker_locations t) trackers,(select jsonb_agg(t) from public.equipment_unit_location_history t) history");
  const aclBefore=(await f.db.query("select proacl,provolatile,prosecdef,proconfig from pg_proc where oid='cos_mhelp_placement_private.source_estimate_record_current(jsonb)'::regprocedure")).rows[0];
  const row=stripped(f.upload[0]);
  assert.equal(await guard(f.db,row),false,'Before migration absent flags are held');
  assert.equal((await f.read()).records.length,0,'Never publish without an admitted receipt');
  await f.db.exec(await migration());
  const aclAfter=(await f.db.query("select proacl,provolatile,prosecdef,proconfig from pg_proc where oid='cos_mhelp_placement_private.source_estimate_record_current(jsonb)'::regprocedure")).rows[0];
  assert.deepEqual(aclAfter,aclBefore,'Installed ACL, volatility, security and search path unchanged');
  assert.equal(await guard(f.db,row),true);
  assert.equal(await guard(f.db,f.upload[0]),true,'Prior explicit false and empty list remain valid');
  const cases=[
   [{...row,placementHeld:true},false,'explicit placement hold'],
   [{...row,placementHeld:null},false,'explicit JSON null hold'],
   [{...row,placementHeld:'false'},false,'string-as-boolean rejected'],
   [{...row,possibleAliasUnitIds:['candidate-id']},false,'possible alias'],
   [{...row,possibleAliasUnitIds:null},false,'invalid alias field'],
   [{...row,holdReason:'conflicting association'},false,'reason recorded'],
   [{...row,supersedesProductId:'789'},false,'replacement record'],
   [{...row,placement:'SHOP'},false,'Shop excluded'],
   [{...row,lifecycle:'DO_NOT_USE'},false,'Do Not Use excluded'],
   [{...row,binding:{productId:'1'}},false,'bound native identity not source-only'],
   [{...row,sourceAddress:{...row.sourceAddress,street:''}},false,'blank street rejected'],
   [{...row,sourceAddress:{street:'',city:'1001 I-35 Frontage Rd Kyle',state:'TX',zip:'78640'}},false,'malformed Kyle input rejected'],
   [{...row,sourceAddress:{...row.sourceAddress,zip:'UNVERIFIED'}},false,'invalid ZIP rejected'],
   [{...row,sourceAddress:{...row.sourceAddress,city:''}},false,'missing city rejected'],
   [{...row,sourceAddress:{...row.sourceAddress,state:''}},false,'missing state rejected'],
   [{...row,unitNumber:'Solar Stand 72 019'},true,'Field solar stand source-only allowed'],
   [{...row,holdReason:null},true,'explicit cleared reason remains empty, with no active hold'],
  ];
  for(const [record,expected,label] of cases)assert.equal(await guard(f.db,record),expected,label);
  const upload=structuredClone(f.upload);upload[0]=row;
  await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1 where source_sha256=$2',[upload,SOURCE]);
  assert.equal((await f.read()).records.length,0,'Changing source alone never creates map estimate');
  await assert.rejects(()=>f.admit(),/Upload identity, assignment, lifecycle or address changed/,'Old exact-row hash fails');
  const receipts=structuredClone(f.receipts);
  receipts[0].uploadRecordSha256=await f.hash(row);
  assert.equal((await f.admit(receipts)).receipts,3,'Existing guarded admission remains operational');
  const accepted=await f.read();
  assert.equal(accepted.records.length,3);
  assert.equal(accepted.records[0].productId,'1');
  assert.equal(accepted.records[0].verified,false);
  assert.equal(accepted.records[0].liveGps,false);
  assert.equal(accepted.records[0].uploadRecordSha256,receipts[0].uploadRecordSha256);
  const latest=await f.db.query("select (select jsonb_agg(t) from public.equipment_units t) native,(select jsonb_agg(t) from app_private.vision_tracker_locations t) trackers,(select jsonb_agg(t) from public.equipment_unit_location_history t) history");
  assert.deepEqual(latest.rows,untouched.rows,'Native GPS, tracker coordinates, and history untouched');
  await f.db.query("update cos_mhelp_placement_private.upload_batches set records=$1 where source_sha256=$2",[f.upload,SOURCE]);
  assert.equal((await f.read()).records.length,2,'Exact upload-row binding fails closed on source reversal');
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);
   await assert.rejects(()=>f.db.query('select cos_mhelp_placement_private.source_estimate_record_current($1::jsonb)',[row]));
   await f.db.exec('reset role');
  }
 }finally{await f.close();}
});
