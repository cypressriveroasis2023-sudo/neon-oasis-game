import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const baseline=await readFile(new URL('./fixtures/health-read-upload-baseline.sql',import.meta.url),'utf8'),install=await readFile(new URL('../db/mhelp-health-read-snapshot-install.sql',import.meta.url),'utf8');
async function fixture(){const db=new PGlite();await db.exec(`create schema cos_mhelp_placement_private;create sequence cos_mhelp_placement_private.base_reads;
 create table cos_mhelp_placement_private.live_inventory_control(singleton boolean,enabled boolean,last_attempt_at timestamptz,last_success_at timestamptz,error_code text);
 insert into cos_mhelp_placement_private.live_inventory_control values(true,true,'2026-10-19T11:00:00Z','2026-10-19T10:00:00Z','source_rate_limited');
 create function cos_mhelp_placement_private.api_base_upload_snapshot() returns jsonb language sql stable set search_path='' as $$
 select '{"records":[{"productId":"1001","binding":{"guardCurrent":false}}],"trackerRecords":[],"scopedRevision":7,"apiMissingRecords":[{"productId":"1002","binding":{"expectedGuard":"same","trackerId":"11111111-1111-4111-8111-111111111111","nativeUnitId":null}}]}'::jsonb where nextval('cos_mhelp_placement_private.base_reads')>0$$;
 create function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid) returns text language sql stable as $$select 'same'::text$$;`);
 await db.exec(baseline);await db.exec('revoke all on function cos_mhelp_placement_private.upload_snapshot() from public');return db;}
test('the complete guarded snapshot is materialized once with identical output and security',async()=>{
 const db=await fixture();try{
  const before=(await db.query('select cos_mhelp_placement_private.upload_snapshot() value')).rows[0].value;
  const oldReads=Number((await db.query('select last_value from cos_mhelp_placement_private.base_reads')).rows[0].last_value);assert.equal(oldReads,2);
  await db.exec(install);const after=(await db.query('select cos_mhelp_placement_private.upload_snapshot() value')).rows[0].value;
  const newReads=Number((await db.query('select last_value from cos_mhelp_placement_private.base_reads')).rows[0].last_value)-oldReads;assert.equal(newReads,1);assert.deepEqual(after,before);
  assert.equal(after.records[0].binding.guardCurrent,false);assert.equal(after.apiMissingRecords[0].binding.guardCurrent,true);assert.equal(after.scopedRevision,7);assert.equal(after.apiSync.errorCode,'source_rate_limited');
 }finally{await db.close();}
});
test('a changed current definition or public execution grant refuses installation',async()=>{
 for(const change of ["alter function cos_mhelp_placement_private.upload_snapshot() set search_path='public'",'grant execute on function cos_mhelp_placement_private.upload_snapshot() to public']){
  const db=await fixture();try{await db.exec(change);await assert.rejects(()=>db.exec(install),/stop and review/);}finally{await db.close();}
 }
});
