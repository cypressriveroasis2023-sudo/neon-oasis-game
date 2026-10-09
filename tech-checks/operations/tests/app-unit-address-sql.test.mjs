import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture,reset,seed,ORG,hash,rpc as sourceRpc} from './fixtures/geocode-sources-database-fixture.mjs';

const OWNER='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const IT='d0757b64-9623-4adc-afff-21cc7853e88a';
const IT2='3caf7c00-627f-445f-bce4-ddeae574ee5c';
const SERVICE='7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8';
const OTHER=randomUUID();
const proof={contract:'COS_APP_UNIT_ADDRESS_V1',legacyUnitKey:null,legacyIdentitySha256:hash('identity'),legacyPlacementSha256:hash('placement')};
const address={street:'456 Oak St',city:'Houston',state:'TX',zip:'77003'};
let db;
const sqlFile=name=>readFile(new URL('../db/'+name,import.meta.url),'utf8');
async function rpc(name,args,role='service_role') {
 await db.exec('set role '+role);
 try { return (await db.query('select public.cos_app_unit_address_'+name+'('+Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')+') value',Object.values(args))).rows[0].value; }
 finally { await db.exec('reset role'); }
}
const actor=(id=OWNER)=>({p_actor_user_id:id,p_organization_id:ORG});
const read=(id,who=OWNER)=>rpc('read',{...actor(who),p_native_unit_id:id});
const capability=(who=OWNER)=>rpc('capability',actor(who));
async function enable() { await db.exec('update app_private.cos_app_unit_address_rollout set enabled=true,native_ready=true,bridge_ready=true,worker_ready=true,queue_ready=true,readers_ready=true,legacy_proof_ready=true'); }
const saveArgs=(r,more={})=>({...actor(),p_native_unit_id:r.unitId,p_expected_source_revision:r.sourceRevision,p_expected_overlay_revision:r.revision,
 p_expected_stable_identity_sha256:r.stableIdentitySha256,p_expected_placement_revision:r.placementRevision,p_placement_proof:proof,p_request_id:randomUUID(),
 p_placement:'FIELD',p_installation:address,p_site_label:null,p_effective_before:{placement:r.placement,installation:r.installation,siteLabel:r.siteLabel},...more});
const save=(r,more={})=>rpc('save',saveArgs(r,more));
const identity=s=>({entityKind:s.entityKind,nativeUnitId:s.nativeUnitId,sourceRevision:s.sourceRevision,
 ...(s.sourceSystem==='google_sheet_tracker'?{sourceSystem:s.sourceSystem,sourceRecordId:s.sourceRecordId}:{productId:s.productId})});
const sourceRead=s=>sourceRpc(db,'read_current_batch',{p_organization_id:ORG,p_sources:[identity(s)]});
const sourceMap=s=>sourceRpc(db,'map_projection',{p_organization_id:ORG,p_identities:[{entityKind:s.entityKind,nativeUnitId:s.nativeUnitId}]});
const sourceEvents=()=>sourceRpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:'0',p_limit:100});
const counts=async()=> (await db.query(`select (select count(*)::int from app_private.cos_app_unit_addresses) overlays,
 (select count(*)::int from app_private.cos_app_unit_address_history) history,(select count(*)::int from app_private.cos_geocode_source_events) source_events,
 (select last_value from app_private.cos_geocode_source_event_id_seq)::text sequence`)).rows[0];
const raw=async id=>(await db.query('select to_jsonb(s) value from app_private.cos_geocode_sources s where native_unit_id=$1',[id])).rows[0].value;
async function importMhelp(options={}) {
 const input=await seed(db,{kind:'tracker',label:'HELIOS 099HDC4',...options});
 const [source]=(await db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2) value',[ORG,[input]])).rows[0].value;
 return {input,source,record:options.kind==='equipment_unit'?null:await read(source.nativeUnitId)};
}
async function importSheet() {
 const id=randomUUID();const input={entityKind:'tracker',nativeUnitId:id,trackerId:id,sourceSystem:'google_sheet_tracker',
  sourceRecordId:'google_sheet:synthetic_sheet_123:12:Solar Pole 72|003',sourceProvenance:{sheetId:'synthetic_sheet_123',tabId:'12',fullIdentity:'Solar Pole 72|003',sourceRange:'A3:L3'},
  createTracker:true,unitNumber:'Solar Pole 72 003',trackerUnitNumber:'Solar Pole 72 003',family:'Solar Pole 72',trackerFamily:'SOLAR POLES & SKIDS',variant:null,
  sourceFileSha256:hash('sheet file'),sourceRowSha256:hash('sheet row'),installation:{street:'123 Main St',city:null,state:'TX',zip:'77002'},
  addressSha256:hash('123 main st, tx 77002'),previousSourceRevision:null,placement:'FIELD',siteLabel:null,customerLabel:'Synthetic customer'};
 const [source]=(await db.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2) value',[ORG,[input]])).rows[0].value;
 return {input,source,record:await read(id)};
}

before(async()=>{
 db=await fixture();
 await db.exec(`alter table app_private.vision_tracker_locations add column customer text;
 create table public.user_profiles(user_id uuid primary key,organization_id uuid,department text,active boolean);
 create table public.roles(id uuid primary key,organization_id uuid,code text);
 create table public.user_roles(user_id uuid,role_id uuid);
 create function app_private.appdeploy_assume_actor(p uuid,o uuid) returns void language plpgsql as $$begin
  if not exists(select 1 from public.user_profiles where user_id=p and organization_id=o and active) then raise exception 'Actor denied' using errcode='42501';end if;end$$;
 create function app_private.has_permission(o uuid,p text) returns boolean language sql as $$select current_setting('request.deny_view',true) is distinct from 'yes'$$;
 revoke usage on schema app_private from service_role;`);
 for (const [id,department,code] of [[OWNER,'owner','owner'],[IT,'it','it_technician'],[IT2,'it','it_technician'],[SERVICE,'service','service_technician'],[OTHER,'owner','owner']]) {
  await db.query('insert into public.user_profiles values($1,$2,$3,true)',[id,ORG,department]);
  await db.query('insert into public.roles values($1,$2,$3)',[id,ORG,code]);
  await db.query('insert into public.user_roles values($1,$1)',[id]);
 }
 for(const f of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql',
  'cos-inactive-source-placement.sql','source-precedence-contract.sql','cos-source-precedence.sql','cos-app-unit-address.sql'])await db.exec(await sqlFile(f));
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('reset role;alter table app_private.cos_app_unit_address_history disable trigger cos_app_unit_address_history_immutable;truncate app_private.cos_app_unit_address_history,app_private.cos_app_unit_addresses;alter table app_private.cos_app_unit_address_history enable trigger cos_app_unit_address_history_immutable;');
 await reset(db);
 await db.exec("truncate app_private.cos_app_unit_address_incarnations;update app_private.cos_app_unit_address_rollout set enabled=false,bridge_ready=false,worker_ready=false,queue_ready=false,readers_ready=false,legacy_proof_ready=false;update public.user_profiles set active=true;set request.deny_view='no';");
});

test('capability is default-off and the database rejects a partial consumer rollout',async()=>{
 const {record}=await importMhelp();const c=await capability();assert.equal(c.enabled,false);assert.equal(c.readiness.native,true);assert.equal(record.editable,false);
 await assert.rejects(()=>save(record),/rollout is not ready/);
 await assert.rejects(()=>db.exec('update app_private.cos_app_unit_address_rollout set enabled=true'),/check constraint/);
 await enable();assert.equal((await capability()).enabled,true);assert.equal((await read(record.unitId)).editable,true);
});

test('Owner save writes truthful immutable native audit, preserves imported and tracker rows, publishes redacted effective binding',async()=>{
 await enable();const {record,source}=await importMhelp();const original=await raw(record.unitId);
 const tracker=(await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t where id=$1',[record.unitId])).rows[0].value;
 const result=await save(record);assert.equal(result.changed,true);assert.equal(result.record.sourceRevision,source.sourceRevision);assert.notEqual(result.record.revision,source.sourceRevision);
 assert.deepEqual(await raw(record.unitId),original);
 assert.deepEqual((await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t where id=$1',[record.unitId])).rows[0].value,tracker);
 assert.equal(result.record.history[0].actorUserId,OWNER);assert.equal(result.record.history[0].actorRole,'owner');
 const [effective]=await sourceMap(source);assert.deepEqual(effective.installation,address);assert.equal(effective.sourceRevision,result.record.revision);
 assert.deepEqual(effective.addressAuthority,{...proof,revision:result.record.revision});
 for(const key of ['actorUserId','actor_role','history','placementProof','sourceConflict','stableIdentitySha256'])assert.equal(JSON.stringify(effective).includes(key),false);
 assert.equal(effective.sourceSystem,'mhelpdesk_product_import');assert.equal(effective.productId,source.productId);
 assert.deepEqual((await sourceRead(source)).sources,[null]);assert.deepEqual((await sourceRead(effective)).sources[0].installation,address);
 const events=(await sourceEvents()).events;assert.equal(events.length,1);assert.equal(events[0].sourceRevision,result.record.revision);
});
test('app site-label edits preserve the separately source-owned customer for both origin systems',async()=>{
 await enable();
 for(const origin of ['mhelp','sheet']){
  const {source}=await (origin==='mhelp'?importMhelp():importSheet());
  if(origin==='mhelp')await db.query('update app_private.cos_geocode_sources set site_label=$1 where native_unit_id=$2',['Original mHelp customer',source.nativeUnitId]);
  const record=await read(source.nativeUnitId);await save(record,{p_site_label:'Edited installation site'});
  const [effective]=await sourceMap(source);assert.equal(effective.siteLabel,'Edited installation site');assert.equal(effective.customerLabel,origin==='mhelp'?'Original mHelp customer':'Synthetic customer');
  const current=(await sourceRead(effective)).sources[0];assert.equal(Object.hasOwn(current,'customerLabel'),false);assert.equal(Object.hasOwn(current,'siteLabel'),false);
 }
});

test('only the exact existing active Owner and verified IT actors can use the service wrappers',async()=>{
 await enable();const {record}=await importMhelp();
 for(const denied of [SERVICE,OTHER,randomUUID()])await assert.rejects(()=>read(record.unitId,denied),/required|denied/i);
 for(const role of ['anon','authenticated'])await assert.rejects(()=>rpc('read',{...actor(),p_native_unit_id:record.unitId},role),/permission denied/);
 for(const who of [IT,IT2]) {
  const current=await read(record.unitId,who);const result=await save(current,{...actor(who),p_installation:{...address,street:who===IT?'457 Oak St':'458 Oak St'}});
  assert.equal(result.record.history[0].actorUserId,who);assert.equal(result.record.history[0].actorRole,'it');
 }
 await db.query('update public.user_profiles set active=false where user_id=$1',[IT]);await assert.rejects(()=>capability(IT),/Actor denied/);
 await db.exec("set request.deny_view='yes'");await assert.rejects(()=>capability(),/view permission/);
 assert.equal((await db.query("select has_schema_privilege('service_role','app_private','USAGE') ok")).rows[0].ok,false);
 for(const table of ['cos_app_unit_addresses','cos_app_unit_address_history','cos_app_unit_address_rollout','cos_app_unit_address_incarnations'])
  assert.equal((await db.query("select has_table_privilege('service_role',$1,'SELECT') ok",['app_private.'+table])).rows[0].ok,false);
});

test('unchanged normalized values and unchanged saves emit no revision, history, sequence or source events',async()=>{
 await enable();const {record}=await importMhelp();const before=await counts();
 assert.equal((await save(record,{p_installation:{...record.installation,street:'  123   MAIN St  ',state:'tx'}})).changed,false);
 assert.deepEqual(await counts(),before);
 const first=await save(record);const after=await counts();
 assert.equal((await save(first.record)).changed,false);assert.deepEqual(await counts(),after);
});

test('request UUID retries are idempotent, reused payloads and superseded writes fail closed',async()=>{
 await enable();const {record}=await importMhelp();const args=saveArgs(record);const first=await rpc('save',args);const before=await counts();
 const retry=await rpc('save',args);assert.equal(retry.changed,false);assert.equal(retry.record.revision,first.record.revision);assert.deepEqual(await counts(),before);
 await assert.rejects(()=>rpc('save',{...args,p_installation:{...address,street:'999 Changed St'}}),/reused or superseded/);
 await save(first.record,{p_installation:{...address,street:'777 Later St'}});
 await assert.rejects(()=>rpc('save',args),/reused or superseded/);
});

test('source, overlay, stable identity and native placement compare-and-swap each reject stale saves',async()=>{
 await enable();const {record}=await importMhelp();const before=await counts();
 for(const field of ['p_expected_source_revision','p_expected_overlay_revision','p_expected_stable_identity_sha256','p_expected_placement_revision'])
  await assert.rejects(()=>save(record,{[field]:field.endsWith('sha256')||field==='p_expected_placement_revision'?hash('stale'):randomUUID()}),/changed/);
 assert.deepEqual(await counts(),before);
 const first=await save(record);await assert.rejects(()=>save(record,{p_installation:{...address,street:'777 Other St'}}),/changed/);
 assert.equal((await read(record.unitId)).revision,first.record.revision);
});

test('later source address refresh retains app binding and cache identity, exposes source conflict only to native read',async()=>{
 await enable();const {record,input,source}=await importMhelp();const first=await save(record);const [prior]=await sourceMap(source);
 const refreshed={...input,previousSourceRevision:source.sourceRevision,installation:{...input.installation,street:'987 Import St'},addressSha256:hash('987 import st, houston, tx 77002-1234'),sourceRowSha256:hash('new source row')};
 const [imported]=(await db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2) value',[ORG,[refreshed]])).rows[0].value;
 assert.notEqual(imported.sourceRevision,source.sourceRevision);assert.notEqual(imported.sourceRevision,first.record.revision);assert.equal(imported.installation.street,'987 Import St');
 const [current]=await sourceMap(source);assert.deepEqual(current,prior);
 const native=await read(record.unitId);assert.equal(native.sourceConflict,true);assert.equal(native.revision,first.record.revision);assert.equal(native.sourceRevision,imported.sourceRevision);
 assert.deepEqual(native.installation,address);assert.equal(native.editable,true);
 assert.deepEqual((await sourceRead(prior)).sources[0].installation,address);
});

test('mutable tracker refresh cannot erase an app address but invalidates a stale native placement CAS',async()=>{
 await enable();const {record,source}=await importMhelp();const first=await save(record);const [prior]=await sourceMap(source);
 await db.query("update app_private.vision_tracker_locations set address='new observed import',site='new observed site',imported_at=now() where id=$1",[record.unitId]);
 const next=await read(record.unitId);assert.equal(next.sourceConflict,true);assert.equal(next.editable,true);assert.deepEqual(next.installation,address);
 assert.equal(next.stableIdentitySha256,first.record.stableIdentitySha256);assert.notEqual(next.placementRevision,first.record.placementRevision);
 await assert.rejects(()=>save(first.record,{p_installation:{...address,street:'555 Next St'}}),/changed/);
 const [effective]=await sourceMap(source);assert.equal(effective.sourceRevision,prior.sourceRevision);assert.deepEqual(effective.installation,address);
 assert.equal((await save(next,{p_installation:{...address,street:'555 Next St'}})).changed,true);
});

test('tracker identity change and restore never revive the old address; old in-flight source revision becomes null',async()=>{
 await enable();const {record,source}=await importMhelp();await save(record);const [effective]=await sourceMap(source);
 await db.query("update app_private.vision_tracker_locations set family='changed identity' where id=$1",[record.unitId]);
 await db.query("update app_private.vision_tracker_locations set family='HELIOS' where id=$1",[record.unitId]);
 const current=await read(record.unitId);assert.equal(current.editable,false);assert.equal(current.sourceConflict,true);
 assert.deepEqual((await sourceRead(effective)).sources,[null]);const [held]=await sourceMap(source);assert.equal(held.placement,'UNKNOWN');assert.equal(held.installation,null);assert.equal(held.addressSha256,null);assert.equal(held.eligibility,'tombstone');
 const event=(await sourceEvents()).events[0];assert.equal(event.kind,'tombstone');assert.notEqual(event.sourceRevision,effective.sourceRevision);assert.ok(BigInt(event.eventId)>BigInt(effective.eventId));
 await assert.rejects(()=>save(current),/changed/);
});

test('competing equipment appearance/removal invalidates overlays without binding by normalized label',async()=>{
 await enable();const {record,source}=await importMhelp();await save(record);const [effective]=await sourceMap(source);const id=randomUUID();
 await db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'HELIOS-099HDC4','available')",[id,ORG]);
 assert.equal((await read(record.unitId)).editable,false);await db.query('delete from public.equipment_units where id=$1',[id]);
 assert.equal((await read(record.unitId)).editable,false);assert.deepEqual((await sourceRead(effective)).sources,[null]);
});

test('duplicate tracker appearance/removal and delete/recreate identity cannot revive overlay provenance',async()=>{
 await enable();const {record,source}=await importMhelp();await save(record);const [effective]=await sourceMap(source);const id=randomUUID();
 await db.query("insert into app_private.vision_tracker_locations(id,organization_id,unit_number,family,placement) values($1,$2,'HELIOS-099HDC4','HELIOS','FIELD')",[id,ORG]);
 await db.query('delete from app_private.vision_tracker_locations where id=$1',[id]);
 assert.equal((await read(record.unitId)).editable,false);assert.deepEqual((await sourceRead(effective)).sources,[null]);
});

test('Shop and Inactive are native app placement decisions with null address and no changes to imported provenance',async()=>{
 await enable();const {record,source}=await importMhelp();const original=await raw(record.unitId);
 const shop=await save(record,{p_placement:'SHOP',p_installation:null});assert.equal(shop.record.placement,'SHOP');assert.equal(shop.record.installation,null);
 const [shopSource]=await sourceMap(source);assert.equal(shopSource.eligibility,'tombstone');assert.equal(shopSource.placement,'SHOP');assert.equal(shopSource.installation,null);
 const inactive=await save(shop.record,{p_placement:'INACTIVE',p_installation:null});assert.equal(inactive.record.placement,'INACTIVE');
 const [inactiveSource]=await sourceMap(source);assert.equal(inactiveSource.eligibility,'tombstone');assert.equal(inactiveSource.placement,'INACTIVE');
 await assert.rejects(()=>save(inactive.record,{p_placement:'SHOP'}),/no installation address/);
 const field=await save(inactive.record);assert.equal(field.record.placement,'FIELD');assert.deepEqual(field.record.installation,address);
 assert.deepEqual(await raw(record.unitId),original);assert.equal(field.record.history.length,3);
});

test('partial existing address is readable and repairable; new field address needs street, state and city or ZIP',async()=>{
 await enable();const {record,source}=await importSheet();assert.equal(record.installation.city,null);
 const repaired=await save(record,{p_installation:{...record.installation,city:'Houston'}});assert.equal(repaired.changed,true);
 const [effective]=await sourceMap(source);assert.equal(effective.schemaVersion,2);assert.equal(effective.sourceSystem,'google_sheet_tracker');assert.equal(effective.sourceRecordId,source.sourceRecordId);assert.equal(Object.hasOwn(effective,'productId'),false);
 assert.equal((await sourceRead(effective)).sources[0].sourceRevision,repaired.record.revision);
 for(const input of [{street:'123 Main St',state:'TX'},{street:'Main St',city:'Houston',state:'TX'},{street:'123 Main St',city:'Houston',state:'XX'},
  {...address,note:'unsafe extra'}, {...address,street:'123 Main St password abc'}, {...address,street:'<script>alert(1)</script>'}])
  await assert.rejects(()=>save(repaired.record,{p_installation:input}),/address|street/);
});

test('proof fields and scope are strict, audit is immutable even for SQL owner, rejected saves create no events',async()=>{
 await enable();const {record}=await importMhelp();const before=await counts();
 for(const invalid of [{...proof,actorUserId:OWNER},{...proof,contract:'other'},{...proof,legacyPlacementSha256:null},{...proof,legacyUnitKey:42}])
  await assert.rejects(()=>save(record,{p_placement_proof:invalid}),/placement proof/);
 await assert.rejects(()=>save(record,{p_organization_id:randomUUID()}),/service access/);assert.deepEqual(await counts(),before);
 await save(record);
 for(const q of ["update app_private.cos_app_unit_address_history set actor_role='it'",'delete from app_private.cos_app_unit_address_history','truncate app_private.cos_app_unit_address_history'])
  await assert.rejects(()=>db.exec(q),/immutable/);
 assert.equal((await counts()).history,1);
});

test('disabling rollout blocks edits but never falls back to the older imported address',async()=>{
 await enable();const {record,source}=await importMhelp();await save(record);await db.exec('update app_private.cos_app_unit_address_rollout set enabled=false');
 const current=await read(record.unitId);assert.equal(current.editable,false);await assert.rejects(()=>save(current),/rollout is not ready/);
 assert.deepEqual((await sourceMap(source))[0].installation,address);
});

test('ordinary native equipment source DTOs and all source readers remain unchanged',async()=>{
 await enable();const {source}=await importMhelp({kind:'equipment_unit'});
 const current=(await sourceRead(source)).sources[0];assert.deepEqual(current,source);assert.equal(Object.hasOwn(current,'addressAuthority'),false);
 const many=await sourceRpc(db,'read_many',{p_organization_id:ORG,p_identities:[{entityKind:source.entityKind,nativeUnitId:source.nativeUnitId}]});assert.deepEqual(many,[source]);
 const old=await sourceRpc(db,'read_current',{p_organization_id:ORG,p_entity_kind:source.entityKind,p_native_unit_id:source.nativeUnitId,p_product_id:source.productId,p_source_revision:source.sourceRevision});assert.deepEqual(old.source,source);
 await assert.rejects(()=>read(source.nativeUnitId),/unavailable/);
});

test('save rollback is atomic across overlay, history and source consumers',async()=>{
 await enable();const {record,source}=await importMhelp();
 await db.exec('begin');await save(record);assert.equal((await counts()).history,1);await db.exec('rollback');
 assert.equal((await counts()).history,0);assert.equal((await counts()).overlays,0);assert.deepEqual((await sourceRead(source)).sources,[source]);
});

test('a current legacy address is the truthful before-value; restoring the imported address is a real edit',async()=>{
 await enable();const {record,source}=await importMhelp();
 const before={placement:'FIELD',installation:{...address,street:'800 Owner St'},siteLabel:'Current Owner site'};
 const result=await save(record,{p_placement_proof:{...proof,legacyUnitKey:record.unitNumber},p_effective_before:before,p_installation:record.installation});
 assert.equal(result.changed,true);assert.deepEqual(result.record.installation,record.installation);
 assert.deepEqual((await db.query('select before_value from app_private.cos_app_unit_address_history')).rows[0].before_value,before);
 assert.equal((await sourceMap(source))[0].addressAuthority.legacyUnitKey,record.unitNumber);
});

test('source deletion emits an orphan tombstone and UNKNOWN first-load map marker, recreation cannot revive saved authority',async()=>{
 await enable();const {record,input,source}=await importMhelp();await save(record);const [effective]=await sourceMap(source);
 await db.query('delete from app_private.cos_geocode_sources where native_unit_id=$1',[record.unitId]);
 assert.deepEqual((await sourceRead(effective)).sources,[null]);
 const [held]=await sourceMap(source);assert.equal(held.placement,'UNKNOWN');assert.equal(held.installation,null);assert.equal(held.unitNumber,record.unitNumber);
 const event=(await sourceEvents()).events[0];assert.equal(event.kind,'tombstone');assert.notEqual(event.sourceRevision,effective.sourceRevision);
 assert.equal((await sourceRead({...source,sourceRevision:event.sourceRevision})).sources[0].eligibility,'tombstone');
 await db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2)',[ORG,[input]]);
 assert.equal((await read(record.unitId)).editable,false);assert.equal((await sourceMap(source))[0].placement,'UNKNOWN');
});

test('native tracker delete/recreate and truncation preserve identity invalidation',async()=>{
 await enable();const {record,source}=await importMhelp();await save(record);const [effective]=await sourceMap(source);
 const tracker=(await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t where id=$1',[record.unitId])).rows[0].value;
 await db.query('delete from app_private.vision_tracker_locations where id=$1',[record.unitId]);
 await db.query('insert into app_private.vision_tracker_locations select * from jsonb_populate_record(null::app_private.vision_tracker_locations,$1)',[tracker]);
 assert.equal((await read(record.unitId)).editable,false);assert.deepEqual((await sourceRead(effective)).sources,[null]);
 await db.exec('truncate app_private.vision_tracker_locations');
 assert.equal((await sourceMap(source))[0].placement,'UNKNOWN');
});

test('history is bounded to latest twenty actual edits without dropping immutable audit records',async()=>{
 await enable();let {record}=await importMhelp();
 for(let i=0;i<22;i++)record=(await save(record,{p_installation:{...address,street:`${i+400} Oak St`}})).record;
 assert.equal(record.history.length,20);assert.equal(record.history[0].revision,record.revision);
 assert.equal((await counts()).history,22);assert.equal(record.history.at(-1).installation.street,'402 Oak St');
});

test('wrong roles, cross-organization membership and unsupported proof values cannot create native authority',async()=>{
 await enable();const {record}=await importMhelp();
 await db.query("update public.roles set code='service_technician' where id=$1",[IT]);
 try { await assert.rejects(()=>save(record,{...actor(IT)}),/verified IT/); }
 finally {await db.query("update public.roles set code='it_technician' where id=$1",[IT]);}
 await db.query('update public.user_profiles set organization_id=$1 where user_id=$2',[randomUUID(),IT]);
 try { await assert.rejects(()=>save(record,{...actor(IT)}),/Actor denied/); }
 finally {await db.query('update public.user_profiles set organization_id=$1 where user_id=$2',[ORG,IT]);}
 for(const invalid of [null,{},[],{placement:'FIELD',installation:{street:'123 Main St',actorUserId:OWNER},siteLabel:null}])
  await assert.rejects(()=>save(record,{p_effective_before:invalid}),/before-value/);
 assert.equal((await counts()).history,0);
});
