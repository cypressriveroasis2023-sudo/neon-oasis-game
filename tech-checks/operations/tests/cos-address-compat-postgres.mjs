// Synthetic/disposable PostgreSQL 17 proof. Never connects to a COS production project.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fixture,SOURCE,PAYLOAD,ORG} from './fixtures/source-equipment-receipts-postgres.mjs';
const url=new URL(process.env.COS_ADDRESS_COMPAT_TEST_DATABASE_URL??'invalid:');
if(process.env.GITHUB_ACTIONS!=='true'||process.env.COS_ADDRESS_COMPAT_PG_CI!=='1'
 ||!['postgres:','postgresql:'].includes(url.protocol)
 ||url.hostname!=='127.0.0.1'||url.port!=='5432'
 ||url.pathname!=='/cos_address_compat_test_ci'||url.username!=='postgres'
 ||url.password!=='synthetic-ci-only'||url.search||url.hash)
 throw Error('Dedicated synthetic-only PostgreSQL service required');
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));
const {Client}=require('pg'),db=new Client({connectionString:url.href,application_name:'cos_address_compat_ci'});
const asParams=values=>values?.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
const query=(sql,values)=>db.query(sql,asParams(values));
const adapter={exec:sql=>db.query(sql),query};
await db.connect();
let stage='start';
try{
 await db.query("set timezone='UTC';set statement_timeout='12s';set lock_timeout='4s'");
 const pg=(await db.query("select current_database() db,current_user role,current_setting('server_version_num') version")).rows[0];
 assert.equal(pg.db,'cos_address_compat_test_ci');assert.equal(pg.role,'postgres');
 assert.ok(Number(pg.version)>=170000&&Number(pg.version)<180000,'PostgreSQL 17 required');
 stage='seed';
 const f=await fixture(adapter),original=await f.state(false);
 const full=structuredClone(f.upload),withoutOptional=structuredClone(full[0]);
 delete withoutOptional.placementHeld;delete withoutOptional.possibleAliasUnitIds;
 const recordStatus=async r=>(await query('select cos_mhelp_placement_private.source_estimate_record_current($1::jsonb) v',[r])).rows[0].v;
 assert.equal(await recordStatus(withoutOptional),false);
 assert.equal((await f.read()).records.length,0);
 const beforeAcl=(await db.query("select proacl,provolatile,prosecdef,proconfig from pg_proc where oid='cos_mhelp_placement_private.source_estimate_record_current(jsonb)'::regprocedure")).rows[0];
 stage='migration';
 const sql=await readFile(new URL('../db/cos_source_estimate_optional_holds_20261017.sql',import.meta.url),'utf8');
 await db.query(sql);
 const afterAcl=(await db.query("select proacl,provolatile,prosecdef,proconfig from pg_proc where oid='cos_mhelp_placement_private.source_estimate_record_current(jsonb)'::regprocedure")).rows[0];
 assert.deepEqual(afterAcl,beforeAcl);
 assert.equal(await recordStatus(withoutOptional),true);
 assert.equal(await recordStatus({...withoutOptional,placementHeld:true}),false);
 assert.equal(await recordStatus({...withoutOptional,placementHeld:null}),false);
 assert.equal(await recordStatus({...withoutOptional,possibleAliasUnitIds:['collision']}),false);
 assert.equal(await recordStatus({...withoutOptional,holdReason:'identity review'}),false);
 assert.equal(await recordStatus({...withoutOptional,placement:'SHOP'}),false);
 assert.equal(await recordStatus({...withoutOptional,lifecycle:'DO_NOT_USE'}),false);
 assert.equal(await recordStatus({...withoutOptional,sourceAddress:{...withoutOptional.sourceAddress,street:''}}),false);
 assert.equal((await f.read()).records.length,0);
 stage='receipt_admission';
 const changed=structuredClone(full);changed[0]=withoutOptional;
 await query('update cos_mhelp_placement_private.upload_batches set records=$1::jsonb where source_sha256=$2',[changed,SOURCE]);
 await assert.rejects(()=>f.admit(),/Upload identity, assignment, lifecycle or address changed/);
 const receipts=structuredClone(f.receipts);
 receipts[0].uploadRecordSha256=await f.hash(withoutOptional);
 assert.equal((await f.admit(receipts)).receipts,3);
 const accepted=await f.read();
 assert.deepEqual(accepted.records.map(r=>r.productId),['1','2','3']);
 assert.ok(accepted.records.every(r=>r.verified===false&&r.liveGps===false));
 await query('update cos_mhelp_placement_private.upload_batches set records=$1::jsonb where source_sha256=$2',[full,SOURCE]);
 assert.deepEqual((await f.read()).records.map(r=>r.productId),['2','3'],'Exact current row hash suppresses changed source-only receipt');
 assert.deepEqual(await f.state(false),original,'Native/Shop/Field/source graph, GPS and histories unchanged');
 stage='permissions';
 for(const role of ['anon','authenticated','service_role']){
  await db.query('set role '+role);
  await assert.rejects(()=>query('select cos_mhelp_placement_private.source_estimate_record_current($1::jsonb)',[withoutOptional]),err=>['42501','42883'].includes(err.code));
  await db.query('reset role');
 }
 console.log('PASS PostgreSQL 17 exact SQL, optional-field denials, immutable source receipt, 1001 synthetic records, native data preserved');
} catch(e){console.error('FAILED STAGE',stage,e.message,e.code??'');throw e;} finally{await db.query('rollback').catch(()=>{});await db.end();}
