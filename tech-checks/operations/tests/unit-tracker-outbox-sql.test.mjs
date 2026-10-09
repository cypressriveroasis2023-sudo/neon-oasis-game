import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture,reset,ORG,hash} from './fixtures/geocode-sources-database-fixture.mjs';
import {checkedTrackerSnapshot,createUnitTracker,UNIT_TRACKER_WORKBOOK as BOOK} from '../../supabase/functions/cos-operations-pages/unitTracker.ts';
const OWNER='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',IT='d0757b64-9623-4adc-afff-21cc7853e88a',IT2='3caf7c00-627f-445f-bce4-ddeae574ee5c',SERVICE='7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',OTHER=randomUUID();
let db;
const actor=(who=OWNER)=>({p_actor_user_id:who,p_organization_id:ORG});
async function rpc(name,args=actor(),role='service_role'){
 await db.exec('set role '+role);
 try{return(await db.query('select public.cos_unit_tracker_'+name+'('+Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')+') value',Object.values(args))).rows[0].value;}
 finally{await db.exec('reset role');}
}
const queue=(request,who=OWNER)=>rpc('enqueue',{...actor(who),p_request:request});
const add=(more={})=>({requestId:randomUUID(),kind:'add',identity:{family:'SOLAR POLES & SKIDS',fullVariant:'Solar Pole 72',unitLabel:'017'},changes:{placement:'FIELD',street:'123 Main St',state:'TX',city:'Houston'},...more});
const update=(s,more={})=>({requestId:randomUUID(),kind:'update',unitId:s.nativeUnitId,expectedSourceRevision:s.sourceRevision,changes:{siteLabel:'New site'},...more});
const enable=()=>db.exec('update app_private.cos_unit_tracker_rollout set queue_enabled=true');
const count=async()=>(await db.query('select count(*)::int n from app_private.cos_unit_tracker_requests')).rows[0].n;
const originals=async()=>(await db.query(`select jsonb_build_object('sources',(select coalesce(jsonb_agg(to_jsonb(x) order by x.native_unit_id),'[]') from app_private.cos_geocode_sources x),'trackers',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from app_private.vision_tracker_locations x),'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.event_id),'[]') from app_private.cos_geocode_source_events x),'equipment',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.equipment_units x)) v`)).rows[0].v;
async function source({number='003',model='Solar Pole 72',book=BOOK,...more}={}){
 const id=randomUUID(),full=model+'|'+number;
 const input={entityKind:'tracker',nativeUnitId:id,trackerId:id,sourceSystem:'google_sheet_tracker',sourceRecordId:`google_sheet:${book}:12:${full}`,sourceProvenance:{sheetId:book,tabId:'12',fullIdentity:full,sourceRange:'A3:L3'},createTracker:true,unitNumber:full.replace('|',' '),trackerUnitNumber:full.replace('|',' '),family:model,trackerFamily:'SOLAR POLES & SKIDS',variant:null,sourceFileSha256:hash('file'),sourceRowSha256:hash(full),installation:{street:'123 Main St',city:'Houston',state:'TX',zip:'77002'},addressSha256:hash('123 main st, houston, tx 77002'),previousSourceRevision:null,placement:'FIELD',siteLabel:'Original site',customerLabel:'Original customer',...more};
 const [record]=(await db.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2) v',[ORG,[input]])).rows[0].v;
 return {input,record};
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
 for(const[id,dept,role]of[[OWNER,'owner','owner'],[IT,'it','it_technician'],[IT2,'it','it_technician'],[SERVICE,'service','service_technician'],[OTHER,'owner','owner']]){
  await db.query('insert into public.user_profiles values($1,$2,$3,true)',[id,ORG,dept]);await db.query('insert into public.roles values($1,$2,$3)',[id,ORG,role]);await db.query('insert into public.user_roles values($1,$1)',[id]);
 }
 for(const file of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql','cos-unit-tracker-outbox.sql'])await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('reset role;alter table app_private.cos_unit_tracker_requests disable trigger cos_unit_tracker_requests_immutable;truncate app_private.cos_unit_tracker_requests;alter table app_private.cos_unit_tracker_requests enable trigger cos_unit_tracker_requests_immutable;');await reset(db);
 await db.exec("update app_private.cos_unit_tracker_rollout set queue_enabled=false;update public.user_profiles set active=true;set request.deny_view='no';");
});
test('default off is readable; a disabled queue never accepts an add and connector stays disabled',async()=>{
 const {record}=await source();const snapshot=checkedTrackerSnapshot(await rpc('snapshot'));
 assert.equal(snapshot.queueEnabled,false);assert.deepEqual(snapshot.connector,{enabled:false,state:'awaiting_sheets_connection'});assert.equal(snapshot.sources[0].unitId,record.nativeUnitId);
 await assert.rejects(queue(add()),/not enabled/);assert.equal(await count(),0);
});
test('only existing Owner and two exact verified IT actors can read and queue',async()=>{
 for(const who of [OWNER,IT,IT2])assert.equal((await rpc('snapshot',actor(who))).queueEnabled,false);
 for(const who of [SERVICE,OTHER,randomUUID()])await assert.rejects(rpc('snapshot',actor(who)),/required|denied/);
 for(const role of ['anon','authenticated'])await assert.rejects(rpc('snapshot',actor(),role),/permission denied/);
 await assert.rejects(rpc('snapshot',{...actor(),p_organization_id:randomUUID()}),/service access/);
 await db.query('update public.user_profiles set active=false where user_id=$1',[IT]);await assert.rejects(rpc('snapshot',actor(IT)),/denied/);
 await db.exec("set request.deny_view='yes'");await assert.rejects(rpc('snapshot'),/view permission/);
 assert.equal((await db.query("select has_schema_privilege('service_role','app_private','USAGE') v")).rows[0].v,false);
 for(const table of ['cos_unit_tracker_rollout','cos_unit_tracker_requests'])for(const mode of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query("select has_table_privilege('service_role',$1,$2) v",['app_private.'+table,mode])).rows[0].v,false);
});
test('durable add is immutable, exact identity retained, original sources and fleet never change',async()=>{
 await enable();await source();const before=await originals(),input=add(),result=await queue(input,IT);
 assert.equal(result.created,true);assert.equal(result.request.status,'awaiting_sheets_connection');assert.equal(result.request.identity.unitId,null);assert.equal(result.request.identity.fullVariant,'Solar Pole 72');assert.equal(result.request.proposed.zip,null);
 assert.deepEqual(await originals(),before);assert.equal(await count(),1);
 assert.equal(checkedTrackerSnapshot(await rpc('snapshot')).requests[0].requestId,input.requestId);
 await assert.rejects(db.exec("update app_private.cos_unit_tracker_requests set status='published'"),/immutable/);
 await assert.rejects(db.exec('delete from app_private.cos_unit_tracker_requests'),/immutable/);
 await assert.rejects(db.exec('truncate app_private.cos_unit_tracker_requests'),/immutable/);
});
test('update uses authoritative UUID/source revision, preserves omitted blanks and never clears address for placement-only request',async()=>{
 await enable();const {record}=await source();const before=await originals();
 const result=await queue(update(record,{changes:{placement:'SHOP',siteLabel:null}}));
 assert.equal(result.request.before.siteLabel,'Original site');assert.equal(result.request.proposed.siteLabel,null);assert.equal(result.request.proposed.customerLabel,'Original customer');assert.equal(result.request.proposed.street,'123 Main St');assert.equal(result.request.proposed.placement,'SHOP');
 assert.equal(result.request.identity.sourceRecordId,record.sourceRecordId);assert.deepEqual(await originals(),before);
 await assert.rejects(queue(update(record)),/already has a pending/);
});
test('idempotent retry survives source refresh and rollout disable; reused payload/actor denied',async()=>{
 await enable();const {record}=await source();const input=update(record),first=await queue(input);const before=await originals();
 const retry=await queue(input);assert.equal(retry.created,false);assert.deepEqual(retry.request,first.request);assert.equal(await count(),1);assert.deepEqual(await originals(),before);
 await assert.rejects(queue({...input,changes:{siteLabel:'Different'}}),/reused/);await assert.rejects(queue(input,IT),/reused/);
 await db.exec("update app_private.cos_geocode_sources set site_label='Refreshed source';update app_private.cos_unit_tracker_rollout set queue_enabled=false;");
 assert.deepEqual((await queue(input)).request,first.request);assert.equal(await count(),1);
});
test('stale revision, spoofed update identity, mismatched workbook and missing sources fail closed',async()=>{
 await enable();const {record}=await source(),other=await source({number:'004',book:'synthetic_old_workbook'});
 for(const input of [update(record,{expectedSourceRevision:randomUUID()}),update(record,{unitId:randomUUID()}),update(record,{identity:{family:'Solar',fullVariant:'Solar Pole 72',unitLabel:'004'}}),update(other.record)])await assert.rejects(queue(input),/revision|required|unavailable/);
 assert.equal((await rpc('snapshot')).sources.length,1);assert.equal(await count(),0);
});
test('same unit numbers across full variants remain separate and add collisions are rejected',async()=>{
 await enable();const a=await source({model:'Solar Pole 72'}),b=await source({model:'Solar Skid 72'});
 const one=await queue(update(a.record)),two=await queue(update(b.record));assert.notEqual(one.request.identity.sourceRecordId,two.request.identity.sourceRecordId);
 await assert.rejects(queue(add({identity:{family:'Other family',fullVariant:'Solar Pole 72',unitLabel:'003'}})),/already exists/);
 await queue(add());await assert.rejects(queue(add({identity:{family:'Other family',fullVariant:'Solar Pole 72',unitLabel:'017'}})),/already exists/);
});
test('unknown fields, formulas, IPs, secrets, unsupported types and incomplete add all reject before persistence',async()=>{
 await enable();const base=add();
 const bad=[{...base,workbookId:'different'},{...base,changes:{...base.changes,password:'abc'}},{...base,identity:{...base.identity,unitLabel:'10.2.3.4'}},{...base,identity:{...base.identity,fullVariant:'003'}},{...base,changes:{placement:'FIELD',street:'123 Main St'}},
 ...['=SUM(A1:A2)','+IMPORTXML(foo)','-1+2','@foo','10.2.3.4','password abc','https://example.com','secret abc','Gate code 555','passcode 456','Contact Alice','555-123-4567','<script>',' abc ',true,12,{}].map(value=>({...base,changes:{...base.changes,siteLabel:value}}))];
 for(const input of bad)await assert.rejects(queue({...input,requestId:randomUUID()}),/Invalid|required|needs/);
 assert.equal(await count(),0);
});
test('failed insert transaction leaves no receipt; retry persists once after failure removed',async()=>{
 await enable();const before=await originals(),input=add();
 await db.exec(`create function app_private.synthetic_outbox_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic receipt failure';end $$;
 create trigger synthetic_outbox_failure after insert on app_private.cos_unit_tracker_requests for each row execute function app_private.synthetic_outbox_failure();`);
 await assert.rejects(queue(input),/Synthetic receipt failure/);assert.equal(await count(),0);assert.deepEqual(await originals(),before);
 await db.exec('drop trigger synthetic_outbox_failure on app_private.cos_unit_tracker_requests;drop function app_private.synthetic_outbox_failure();');
 assert.equal((await queue(input)).created,true);assert.equal((await queue(input)).created,false);assert.equal(await count(),1);
});
test('unsafe existing cells are held explicitly, never redacted into writable blank values',async()=>{
 const {record}=await source();await db.exec("update app_private.cos_geocode_sources set site_label='10.2.3.4'");
 const snapshot=checkedTrackerSnapshot(await rpc('snapshot'));assert.equal(snapshot.sources.length,0);assert.equal(snapshot.sourcesHeld,1);
 await assert.rejects(rpc('read',{...actor(),p_native_unit_id:record.nativeUnitId}),/unavailable/);
});
test('snapshot bounds requests with a truthful truncation flag and strips actor and raw provenance',async()=>{
 await enable();for(let n=0;n<101;n++)await queue(add({identity:{family:'SOLAR POLES & SKIDS',fullVariant:'Solar Pole 72',unitLabel:String(200+n)}}));
 const snap=checkedTrackerSnapshot(await rpc('snapshot'));assert.equal(snap.requests.length,100);assert.equal(snap.requestsTruncated,true);assert.equal(snap.sourcesTruncated,false);
 for(const secret of ['actorUserId','actor_user_id','request_payload','sourceRange','source_file_sha256'])assert.equal(JSON.stringify(snap).includes(secret),false);
});
test('bridge response validation accepts real SQL JSONB key order and checked receipts',async()=>{
 await enable();const handler=createUnitTracker({actorPayload:actor(),rpc:(name,args)=>rpc(name.replace('cos_unit_tracker_',''),args)});
 const input=add();assert.equal((await handler('/api/unit-tracker/requests','POST',input)).created,true);
 assert.equal((await handler('/api/unit-tracker/requests','POST',input)).created,false);
 assert.equal((await handler('/api/unit-tracker','GET',null)).requests.length,1);
});
test('competing serialized local transactions cannot create two proposals for one exact identity',async()=>{
 await enable();const requestA=add(),requestB=add();
 const attempt=request=>db.transaction(async tx=>{
  await tx.exec('set local role service_role');
  return (await tx.query('select public.cos_unit_tracker_enqueue($1,$2,$3) value',[OWNER,ORG,request])).rows[0].value;
 });
 const results=await Promise.allSettled([attempt(requestA),attempt(requestB)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(await count(),1);
 // PGlite serializes transactions; production serialization additionally rests
 // on reviewed PostgreSQL advisory/table locks and the exact-identity index.
 assert.equal((await db.query("select indexdef from pg_indexes where indexname='cos_unit_tracker_pending_add'")).rows[0].indexdef.includes('UNIQUE'),true);
});
test('inactive requests and explicit null address edits remain pending only; null is never interpreted as a no-op',async()=>{
 await enable();const {record}=await source();const before=await originals();const request=await queue(update(record,{changes:{placement:'INACTIVE',street:null,city:null,state:null,zip:null}}));
 assert.equal(request.request.proposed.street,null);assert.equal(request.request.before.street,'123 Main St');assert.equal(request.request.proposed.placement,'INACTIVE');assert.deepEqual(await originals(),before);
});

test('an additional source model variant is held instead of silently dropping an identity distinction',async()=>{
 await source({variant:'HDC4'});const snap=checkedTrackerSnapshot(await rpc('snapshot'));assert.equal(snap.sources.length,0);assert.equal(snap.sourcesHeld,1);
});
test('an older selected update remains discoverable and readable beyond the latest 100 request window',async()=>{
 await enable();const {record}=await source();
 const initial=await rpc('read',{...actor(),p_native_unit_id:record.nativeUnitId});assert.equal(initial.pendingRequestId,null);assert.equal(initial.pendingRequest,null);
 const original=(await queue(update(record))).request;
 for(let n=0;n<101;n++)await queue(add({identity:{family:'SOLAR POLES & SKIDS',fullVariant:'Solar Skid 72',unitLabel:String(200+n)}}));
 const snap=checkedTrackerSnapshot(await rpc('snapshot'));assert.equal(snap.requests.length,100);assert.equal(snap.requestsTruncated,true);assert.equal(snap.requests.some(r=>r.requestId===original.requestId),false);
 assert.equal(snap.sources.find(s=>s.unitId===record.nativeUnitId).pendingRequestId,original.requestId);
 const handler=createUnitTracker({actorPayload:actor(),rpc:(name,args)=>rpc(name.replace('cos_unit_tracker_',''),args)});
 const selected=await handler('/api/unit-tracker/'+record.nativeUnitId,'GET',null);
 assert.equal(selected.pendingRequestId,original.requestId);assert.deepEqual(selected.pendingRequest,original);
 assert.equal(selected.pendingRequest.identity.unitId,selected.unitId);assert.equal(await count(),102);
});
test('exact request read verifies author independently of the bounded recent list and returns explicit missing state',async()=>{
 await enable();const input=add(),saved=await queue(input,IT);assert.equal(saved.ownedByCurrentActor,true);
 const own=await rpc('request_read',{...actor(IT),p_request_id:input.requestId});assert.equal(own.ownedByCurrentActor,true);assert.deepEqual(own.request,saved.request);
 const other=await rpc('request_read',{...actor(),p_request_id:input.requestId});assert.equal(other.ownedByCurrentActor,false);assert.deepEqual(other.request,saved.request);
 const missing=await rpc('request_read',{...actor(),p_request_id:randomUUID()});assert.equal(missing.request,null);assert.equal(missing.ownedByCurrentActor,false);
 await assert.rejects(rpc('request_read',{...actor(SERVICE),p_request_id:input.requestId}),/required/);
});
test('merged FIELD updates cannot clear required address while nonfield updates preserve explicitly supplied intent',async()=>{
 await enable();const {record}=await source();
 for(const changes of [{street:null,state:null},{street:null},{state:null},{city:null,zip:null}])await assert.rejects(queue(update(record,{changes})),/field unit needs/);
 assert.equal(await count(),0);const pending=await queue(update(record,{changes:{placement:'SHOP'}}));assert.equal(pending.request.proposed.street,'123 Main St');assert.equal(pending.request.proposed.placement,'SHOP');
});
test('new SHOP and INACTIVE requests cannot carry a contradictory field address',async()=>{
 await enable();for(const placement of ['SHOP','INACTIVE'])await assert.rejects(queue(add({changes:{placement,street:'123 Main St',state:'TX',city:'Houston'}})),/must not include/);assert.equal(await count(),0);
});
test('real-shaped decimal labels survive exact source and request identities without collapsing into whole-number units',async()=>{
 await enable();const whole=await source({number:'029'}),decimal=await source({number:'029.2'}),second=await source({number:'023.1'});
 const snap=checkedTrackerSnapshot(await rpc('snapshot'));assert.deepEqual(snap.sources.map(row=>row.unitLabel).sort(),['023.1','029','029.2']);
 const a=await queue(update(whole.record)),b=await queue(update(decimal.record)),c=await queue(update(second.record));assert.equal(b.request.identity.unitLabel,'029.2');assert.equal(c.request.identity.unitLabel,'023.1');assert.notEqual(a.request.identity.sourceRecordId,b.request.identity.sourceRecordId);
 const pending=await queue(add({identity:{family:'SOLAR POLES & SKIDS',fullVariant:'Solar Pole 72',unitLabel:'030.2'},changes:{placement:'SHOP'}}));assert.equal(pending.request.identity.unitLabel,'030.2');
});
