import{test,before,after,beforeEach}from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{fixture,record,productRecord,review,admit,withdraw,state,reset,ORG,hash}from'./fixtures/support-admission-fixture.mjs';
import {fieldCameraHealth,isSupportEquipment,unitHealthLabel} from '../src/fieldCameraHealth.ts';
import {snapshot,now} from './fixtures/camera-evidence-fixtures.mjs';
import {readFile} from 'node:fs/promises';
import {creationIdentity} from '../scripts/product-creation-identity.mjs';
let db;before(async()=>{db=await fixture();});after(async()=>{await db?.close();});beforeEach(async()=>{await reset(db);});
const pole=()=>record({productId:'9000002',sourceLabel:'Solar Pole 902 72 (Hybrid solar stand)',kind:'solar_pole',number:'902',capacity:72,sourceCategory:'Solar Pole 72'});
test('dry-run has no rows, generated identifiers, source events or sequence effects',async()=>{
 const before=await state(db),seq=(await db.query('select last_value,is_called from app_private.cos_geocode_source_event_id_seq')).rows;
 const result=await admit(db,[record(),pole()],false);assert.equal(result.applied,false);assert.equal(result.records.length,2);assert.ok(result.records.every(r=>r.status==='would_admit'&&!r.trackerId));assert.deepEqual(await state(db),before);assert.deepEqual((await db.query('select last_value,is_called from app_private.cos_geocode_source_event_id_seq')).rows,seq);
});
test('creates distinct support targets sharing an address with honest provenance and current native guards',async()=>{
 const result=await admit(db,[record(),pole()]),saved=await state(db);assert.equal(saved.targets.length,2);assert.equal(saved.sources.length,2);assert.equal(saved.events.length,2);assert.equal(saved.equipment.length,0);assert.equal(saved.audits.length,0);
 assert.deepEqual(saved.targets.map(t=>t.unit_number).sort(),['ST 901','Solar Pole 72 902']);
 for(const t of saved.targets){assert.equal(t.source_name,'mHelpDesk product import');assert.equal(t.placement,'FIELD');for(const key of['latitude','longitude','coordinate_source','location_note'])assert.equal(t[key],null);}
 for(const a of saved.admissions){assert.equal(a.admitted_by,'postgres');assert.equal(a.target_snapshot.id,a.tracker_id);assert.equal(a.withdrawn_at,null);}
 for(const r of result.records){assert.equal(r.status,'admitted');assert.ok(r.trackerId);assert.ok(r.sourceRevision);}
 assert.equal((await db.query('select count(*)::int n from app_private.cos_geocode_sources s where native_guard_sha256=app_private.cos_source_native_guard(entity_kind,native_unit_id,tracker_id,unit_number,tracker_unit_number)')).rows[0].n,2);
});
test('exact retry preserves ProductId binding, source revision, target and event count',async()=>{const first=await admit(db),before=await state(db),replay=await admit(db);assert.equal(replay.records[0].status,'already_admitted');assert.equal(replay.records[0].trackerId,first.records[0].trackerId);assert.equal(replay.records[0].sourceRevision,first.records[0].sourceRevision);assert.deepEqual(await state(db),before);});
test('failure on the last record rolls back all previous inserts',async()=>{const before=await state(db);await assert.rejects(()=>admit(db,[record(),pole(),record({productId:'9000003',number:'903',sourceLabel:'ST 903',installation:{street:'123 Main Rd gate code 9999',city:'Example',state:'TX',zip:'77002'}})]),/Unreviewed address change/);assert.deepEqual(await state(db),before);});
test('duplicates, unsupported families, missing/invented identities and extra fields fail closed',async()=>{
 for(const rows of [[record(),record()],[record(),record({productId:'9000002'})],...[{productId:null},{productId:'0'},{productId:'9223372036854775808'},{sourceLabel:'ST 901 MISSING'},{sourceCategory:'camera_system'},{sourceLabel:'ST 902'},{capacity:72},{kind:null},{latitude:29},{actorUserId:randomUUID()},{placement:'SHOP'}].map(x=>[record(x)])]){await assert.rejects(()=>admit(db,rows));assert.equal((await state(db)).targets.length,0);}
});
test('fresh, complete and independent external inventories and deployed classifier are mandatory',async()=>{
 const normal=review(),bad=[null,{},review({classifierVerified:false}),review({reviewedAt:'2000-01-01T00:00:00Z'}),review({reviewedAt:'2999-01-01T00:00:00Z'}),review({sourceFileSha256:hash('wrong')}),review({inventories:normal.inventories.slice(0,3)})];
 for(const[key,value]of Object.entries({complete:false,conflicts:['archived'],readAt:'2000-01-01T00:00:00Z',sha256:null,kind:'unknown',rowCount:null}))bad.push(review({inventories:normal.inventories.map((r,i)=>i?r:{...r,[key]:value})}));
 for(const receipt of bad){await assert.rejects(()=>admit(db,[record()],true,receipt));assert.equal((await state(db)).targets.length,0);}
});
test('literal street-in-City repair preserves supplied text and rejects ambiguous/invented splits',async()=>{
 const original={street:'',city:'123 Example Rd Sample City',state:'TX',zip:'77002'},row=record({originalInstallation:original,installation:{street:'123 Example Rd',city:'Sample City',state:'TX',zip:'77002'},normalization:'street_in_city_literal_split'});
 await admit(db,[row]);assert.deepEqual((await state(db)).admissions[0].request.originalInstallation,original);await reset(db);
 for(const change of[{installation:{...row.installation,city:'Invented City'}},{installation:{...row.installation,zip:'77003'}},{originalInstallation:{...original,city:'123 Example Rd Sample St City'}},{normalization:'invented'}])await assert.rejects(()=>admit(db,[{...row,...change}]),/split|normalization/);
});
test('state case normalization preserves raw components and permits no other address change',async()=>{
 const row=productRecord(),original={...row.installation,state:'Tx'},input={...row,originalInstallation:original,normalization:'state_case_only'};
 await admit(db,[input]);assert.deepEqual((await state(db)).admissions[0].request.originalInstallation,original);await reset(db);
 for(const change of[{installation:{...row.installation,state:'CA'}},{installation:{...row.installation,zip:'77003'}},{installation:{...row.installation,street:'124 Example Rd'}},{originalInstallation:{...original,state:'Texas'}},{originalInstallation:{...original,state:'TX '}},{normalization:'none'}])await assert.rejects(()=>admit(db,[{...input,...change}]),/case change|address change/);
});
test('addresses/display text cannot contain credentials, contact data, notes or malformed components',async()=>{
 for(const field of['street','city','state','zip']){const installation={...record().installation,[field]:'password123'};await assert.rejects(()=>admit(db,[record({installation,originalInstallation:installation})]),/Unsafe/);}
 for(const street of['123 Example Rd 512-555-1234','123 Example Rd\n','123 Example Rd gate code 1234']){const installation={...record().installation,street};await assert.rejects(()=>admit(db,[record({installation,originalInstallation:installation})]),/Unsafe/);}
 for(const value of[{customer:'secret=abc'},{siteLabel:'https://example.test'}])await assert.rejects(()=>admit(db,[record(value)]),/Unsafe/);
});
for(const[name,query]of[
 ['retired native identity',"insert into public.equipment_units(id,organization_id,unit_number,status)values(gen_random_uuid(),$1,'STAND 0901','retired')"],
 ['tracker alias',"insert into app_private.vision_tracker_locations(id,organization_id,unit_number,family,placement)values(gen_random_uuid(),$1,'901','STANDS','SHOP')"],
 ['provider device',"insert into public.vision_vigilant_devices(organization_id,device_name)values($1,'ST901 Camera 1')"],
 ['camera match',"insert into public.vision_vigilant_unit_matches(organization_id,camera_key)values($1,'ST_901_1')"],
 ['camera registry',"insert into public.vision_cameras(organization_id,internal_name)values($1,'ST 901 camera')"],
 ['historical archived label',"insert into public.audit_events(organization_id,previous_value,new_value)values($1,'{\"unit_number\":\"ST 901\"}','{\"unit_number\":\"Archived rename\"}')"],
 ['Owner reservation',"insert into app_private.cos_owner_identity_claims(organization_id,native_unit_label)values($1,'MISSING Stand 901')"],
 ['Owner ProductId',"insert into app_private.cos_owner_identity_claims(organization_id,product_association)values($1,'{\"productId\":\"9000001\"}')"],
 ['source archive',"insert into app_private.vision_source_inventory_v1(organization_id,unit_label,unit_family)values($1,'DO NOT USE ST 901','STANDS')"],
 ['catalog ProductId',"insert into public.mhelpdesk_equipment_catalog(organization_id,product_id)values($1,9000001)"],
 ['source history',"insert into app_private.cos_geocode_source_events values(999,$1,'tracker',gen_random_uuid(),'9000001',gen_random_uuid(),'tombstone')"],
])test('complete collision guard rejects '+name,async()=>{await db.query(query,[ORG]);const before=await state(db);await assert.rejects(()=>admit(db),/Existing identity/);assert.deepEqual(await state(db),before);});
test('solar capacity/order/decorations are denial concerns; unrelated family numbers remain separate',async()=>{
 await db.query("insert into public.vision_vigilant_devices(organization_id,device_name)values($1,'ARCHIVED Solar Pole 72 902')",[ORG]);await assert.rejects(()=>admit(db,[pole()]),/Existing identity/);await reset(db);
 await db.query("insert into public.equipment_units(id,organization_id,unit_number)values(gen_random_uuid(),$1,'HELIOS 901HDC4')",[ORG]);await admit(db);
});
test('later GPS, placement, source, customer, Owner, provider and history changes block retry and withdrawal',async()=>{
 for(const query of["update app_private.vision_tracker_locations set placement='SHOP' where id=$1","update app_private.vision_tracker_locations set latitude=29,longitude=-95,coordinate_source='owner_gps' where id=$1","update app_private.vision_tracker_locations set customer='Later edit' where id=$1","update app_private.cos_geocode_sources set active=false,eligibility='tombstone' where native_unit_id=$1",`insert into public.audit_events(organization_id,entity_id)values('${ORG}',$1)`,`insert into public.equipment_unit_location_history(organization_id,equipment_unit_id)values('${ORG}',$1)`,`insert into public.vision_cameras(organization_id,equipment_unit_id)values('${ORG}',$1)`]){
  await reset(db);const[{productId,trackerId,sourceRevision}]=(await admit(db)).records;await db.query(query,[trackerId]);const before=await state(db);await assert.rejects(()=>admit(db));await assert.rejects(()=>withdraw(db,[{productId,trackerId,sourceRevision}]));assert.deepEqual(await state(db),before);
 }
});
test('changed source hashes, identity and ProductId cannot replace or resurrect reservations',async()=>{await admit(db);const before=await state(db);for(const r of[record({sourceRowSha256:hash('changed')}),record({sourceLabel:'ST 902',number:'902'}),record({productId:'9000002'})])await assert.rejects(()=>admit(db,[r]));assert.deepEqual(await state(db),before);});
test('withdrawal retains original data, reservations and tombstones, is idempotent and cannot reactivate',async()=>{
 await db.query("insert into public.equipment_units(id,organization_id,unit_number)values(gen_random_uuid(),$1,'UNRELATED 901')",[ORG]);const older=(await state(db)).equipment;
 const identities=(await admit(db,[record(),pole()])).records.map(({productId,trackerId,sourceRevision})=>({productId,trackerId,sourceRevision}));assert.ok((await withdraw(db,identities)).every(r=>r.status==='withdrawn'));const saved=await state(db);assert.deepEqual(saved.equipment,older);assert.equal(saved.targets.length,0);assert.ok(saved.sources.every(s=>!s.active&&s.eligibility==='tombstone'));assert.equal(saved.events.length,4);assert.ok(saved.admissions.every(a=>a.withdrawn_by==='postgres'&&a.withdrawn_at));assert.ok((await withdraw(db,identities)).every(r=>r.status==='already_withdrawn'));assert.deepEqual(await state(db),saved);await assert.rejects(()=>admit(db),/reactivated/);
});
test('stale withdrawal revision makes entire batch atomic',async()=>{const rows=(await admit(db,[record(),pole()])).records.map(({productId,trackerId,sourceRevision})=>({productId,trackerId,sourceRevision})),before=await state(db);rows[1].sourceRevision=randomUUID();await assert.rejects(()=>withdraw(db,rows),/reservation changed/);assert.deepEqual(await state(db),before);});
test('actual roles receive no new grants and cannot impersonate postgres',async()=>{
 const rows=(await db.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname like 'cos_support_%'")).rows;assert.equal(rows.length,5);
 for(const p of rows){assert.equal(p.prosecdef,false);assert.deepEqual(p.proconfig,['search_path=""']);assert.equal(p.anon,false);assert.equal(p.authenticated,false);assert.equal(p.service,false);}
 for(const role of['anon','authenticated','service_role']){await db.exec('set role '+role);try{await assert.rejects(()=>admit(db),/permission denied/);await assert.rejects(()=>withdraw(db,[]),/permission denied/);}finally{await db.exec('reset role');}}
 await assert.rejects(()=>admit(db,[record()],true,review(),randomUUID()),/administrator/);assert.equal((await db.query("select has_schema_privilege('service_role','app_private','USAGE') value")).rows[0].value,false);
 await db.exec('grant usage on schema app_private to service_role;grant execute on function app_private.cos_support_admit_reviewed(uuid,jsonb,jsonb,boolean) to service_role;set role service_role');try{await assert.rejects(()=>admit(db),/administrator/);}finally{await db.exec('reset role;revoke usage on schema app_private from service_role;revoke execute on function app_private.cos_support_admit_reviewed(uuid,jsonb,jsonb,boolean) from service_role');}
});
test('native model family supplies only denial context for a bare unit number',async()=>{
 const model=randomUUID();await db.query("insert into public.equipment_models values($1,'Stand')",[model]);await db.query("insert into public.equipment_units(id,organization_id,unit_number,model_id)values(gen_random_uuid(),$1,'901',$2)",[ORG,model]);await assert.rejects(()=>admit(db),/Existing identity/);
});
test('collapsed canonical provider labels and native ProductId metadata cannot evade negative guards',async()=>{
 await db.query("insert into public.vision_vigilant_devices(organization_id,device_name)values($1,'SolarPole72902')",[ORG]);await assert.rejects(()=>admit(db,[pole()]),/Existing identity/);await reset(db);
 await db.query("insert into public.equipment_units(id,organization_id,unit_number,metadata)values(gen_random_uuid(),$1,'RENAMED','{\"productId\":\"9000001\"}')",[ORG]);await assert.rejects(()=>admit(db),/Existing identity/);
});
test('runtime gate rejects a changed importer and non-current transaction snapshots',async()=>{
 await db.exec('begin isolation level repeatable read');try{await assert.rejects(()=>admit(db),/READ COMMITTED/);}finally{await db.exec('rollback');}
 await db.exec("begin;create or replace function app_private.cos_geocode_sources_admin_import_reviewed(p_organization_id uuid,p_records jsonb)returns jsonb language sql as 'select null::jsonb'");try{await assert.rejects(()=>admit(db),/importer changed/);}finally{await db.exec('rollback');}
});
for(const[name,query]of[
 ['camera collapsed canonical',"insert into public.vision_cameras(organization_id,internal_name)values($1,'SolarPole72902')"],
 ['camera collapsed reversed',"insert into public.vision_cameras(organization_id,camera_key)values($1,'SolarPole90272')"],
 ['historical collapsed canonical',"insert into public.audit_events(organization_id,previous_value)values($1,'{\"unit_number\":\"SolarPole72902\"}')"],
 ['tracker collapsed reversed',"insert into app_private.vision_tracker_locations(organization_id,unit_number,family,placement)values($1,'SolarPole90272','SOLAR POLES & SKIDS','SHOP')"],
])test('central concern parser denies '+name,async()=>{await db.query(query,[ORG]);await assert.rejects(()=>admit(db,[pole()]),/Existing identity/);});
for(const[name,query]of[
 ['native metadata',"insert into public.equipment_units(id,organization_id,unit_number,metadata)values(gen_random_uuid(),$1,'RENAMED','{\"productId\":\"9000010\",\"sourceProductId\":\"9000001\"}')"],
 ['source payload',"insert into app_private.vision_source_inventory_v1(organization_id,source_payload)values($1,'{\"productId\":\"9000010\",\"product_id\":\"9000001\"}')"],
 ['historical metadata',"insert into public.audit_events(organization_id,new_value)values($1,'{\"productId\":\"9000010\",\"product_id\":\"9000001\"}')"],
])test('every ProductId alias is checked independently in '+name,async()=>{await db.query(query,[ORG]);await assert.rejects(()=>admit(db),/Existing identity/);});
test('source observation is finite and display fields have explicit scalar types',async()=>{
 for(const change of[{sourceObservedAt:'-infinity'},{sourceObservedAt:'infinity'},{sourceObservedAt:'yesterday'},{sourceObservedAt:'2026-01-01'},{customer:{name:'Synthetic'}},{siteLabel:['Synthetic']},{productId:9000001}])await assert.rejects(()=>admit(db,[record(change)]));
 assert.equal((await state(db)).targets.length,0);
});
test('historical label and family aliases are evaluated independently',async()=>{
 for(const values of[{unit_number:'UNRELATED',unitNumber:'ST 901'},{unit_number:'UNRELATED',unit_label:'901',family:'Unknown',unit_family:'Stand'}]){
  await reset(db);await db.query('insert into public.audit_events(organization_id,previous_value)values($1,$2)',[ORG,JSON.stringify(values)]);await assert.rejects(()=>admit(db),/Existing identity/);
 }
});
test('unknown collapsed pole capacity is an ambiguity denial, not proof of a missing asset',async()=>{
 await db.query("insert into public.vision_cameras(organization_id,internal_name)values($1,'SolarPole96902')",[ORG]);await assert.rejects(()=>admit(db,[pole()]),/Existing identity/);
});
test('collapsed pole capacity tokens remain concerns with ordinary camera suffixes',async()=>{
 for(const label of['SolarPole72902_1','SolarPole90272 1','Solar Pole 96902 Camera 1']){
  await reset(db);await db.query('insert into public.vision_cameras(organization_id,camera_key)values($1,$2)',[ORG,label]);await assert.rejects(()=>admit(db,[pole()]),/Existing identity/);
 }
 await reset(db);await db.query("insert into public.vision_cameras(organization_id,camera_key)values($1,'Solar Pole 96 901')",[ORG]);await admit(db,[pole()]);
});
test('ordinary ST, Solar Stand and Solar Skid remain different explicit support families',async()=>{
 await db.query("insert into app_private.vision_tracker_locations(organization_id,unit_number,family,placement)values($1,'Solar Stand 72 901','SOLAR STANDS 72','FIELD'),($1,'Solar Skid 144 902','SOLAR POLES & SKIDS','FIELD')",[ORG]);await admit(db,[record(),pole()]);assert.equal((await state(db)).targets.length,4);
 await reset(db);await db.query("insert into public.vision_cameras(organization_id,camera_key)values($1,'ST901 Hybrid Solar Stand')",[ORG]);await assert.rejects(()=>admit(db),/Existing identity/);
});
test('a distinct solar phrase cannot conceal an explicit ordinary ST label or family alias',async()=>{
 await db.query("insert into public.vision_cameras(organization_id,camera_key)values($1,'Solar Stand 72 999 (ST 901)')",[ORG]);await assert.rejects(()=>admit(db),/Existing identity/);await reset(db);
 await db.query("insert into public.audit_events(organization_id,previous_value)values($1,'{\"unit_label\":\"901\",\"family\":\"Stand\",\"unit_family\":\"Solar Stand 72\"}')",[ORG]);await assert.rejects(()=>admit(db),/Existing identity/);
});
const productKinds=['wall_e','camv','sniper_2'];
test('typed absent ProductIds retain full families, independent pins and unknown camera health',async()=>{
 const rows=productKinds.map(kind=>productRecord(kind));
 const before=await state(db),dry=await admit(db,rows,false);assert.equal(dry.records.length,3);assert.deepEqual(await state(db),before);
 const result=await admit(db,rows),saved=await state(db);
 assert.deepEqual(saved.targets.map(t=>t.unit_number).sort(),['CAMV 901','Sniper 2 901','WA 901']);
 assert.deepEqual(saved.targets.map(t=>t.family).sort(),['CAM V & RSU','SNIPERS','WALL-E']);
 assert.equal(new Set(saved.targets.map(t=>t.id)).size,3);assert.equal(saved.sources.length,3);assert.equal(saved.events.length,3);assert.equal(saved.equipment.length,0);assert.equal(saved.audits.length,0);
 const fields=saved.targets.map(t=>({id:t.id,unitNumber:t.unit_number,modelName:t.family}));
 for(const unit of fields){const health=fieldCameraHealth(unit,fields,snapshot([]),now);assert.equal(isSupportEquipment(unit),false);assert.equal(health.state,'unknown');assert.equal(health.classification,null);assert.deepEqual(health.rows,[]);assert.doesNotMatch(unitHealthLabel(health),/0 CAMERAS|ONLINE|OFFLINE/);}
 for(const t of saved.targets){assert.equal(t.source_name,'mHelpDesk product import');assert.equal(t.placement,'FIELD');assert.equal(t.latitude,null);assert.equal(t.longitude,null);}
 for(const name of ['vision_vigilant_devices','vision_vigilant_unit_matches','vision_cameras'])assert.equal((await db.query(`select count(*)::int n from public.${name}`)).rows[0].n,0);
 assert.deepEqual((await admit(db,rows)).records.map(r=>r.trackerId),result.records.map(r=>r.trackerId));assert.deepEqual(await state(db),saved);
 const identities=result.records.map(({productId,trackerId,sourceRevision})=>({productId,trackerId,sourceRevision}));await withdraw(db,identities);const withdrawn=await state(db);assert.equal(withdrawn.targets.length,0);assert.ok(withdrawn.sources.every(s=>!s.active&&s.eligibility==='tombstone'));assert.equal(withdrawn.admissions.length,3);await assert.rejects(()=>admit(db,rows),/reactivated/);
});
test('creation rejects every missing discriminator, suffix, capacity and numeric token mismatch',async()=>{
 for(const kind of productKinds){const row=productRecord(kind);for(const change of[{sourceLabel:row.sourceLabel+' HD4'},{sourceLabel:row.sourceLabel+' 72'},{sourceLabel:row.sourceLabel+' / 902'},{sourceLabel:row.sourceLabel+' MISSING'},{sourceLabel:row.sourceLabel.replace('901','0901')},{sourceLabel:row.sourceLabel.replace('901','902')},{capacity:72},{number:'01'},{sourceCategory:'Stand'},{variant:'HD4'},{variant:null},{cameraCount:2},{providerId:'invented'}])await assert.rejects(()=>admit(db,[{...row,...change}]));}
 for(const label of['Sniper 901','Sniper 2901','Sniper 4-901','Sniper 2 901 4'])await assert.rejects(()=>admit(db,[productRecord('sniper_2',{sourceLabel:label})]));
 assert.equal((await state(db)).targets.length,0);
});
test('full-label aliases share one permanent family reservation without adopting another target',async()=>{
 for(const[kind,label]of[['wall_e','Wall-E 901'],['camv','CAM-V 901'],['sniper_2','Sniper 2 901']]){
  await reset(db);const row=productRecord(kind,{sourceLabel:label});await admit(db,[row]);await assert.rejects(()=>admit(db,[productRecord(kind)]),/cannot be changed/);await assert.rejects(()=>admit(db,[{...row,productId:'9000099'}]),/already reserved/);
 }
});
test('base, variant and capacity aliases fail closed across every native inventory',async()=>{
 const stores=[
  ['equipment_units',"insert into public.equipment_units(id,organization_id,unit_number,status)values(gen_random_uuid(),$1,$2,'retired')"],
  ['tracker',"insert into app_private.vision_tracker_locations(organization_id,unit_number,family,placement)values($1,$2,'Unknown','SHOP')"],
  ['provider',"insert into public.vision_vigilant_devices(organization_id,device_name)values($1,$2)"],
  ['provider match',"insert into public.vision_vigilant_unit_matches(organization_id,camera_key)values($1,$2)"],
  ['camera',"insert into public.vision_cameras(organization_id,internal_name)values($1,$2)"],
  ['Owner',"insert into app_private.cos_owner_identity_claims(organization_id,native_unit_label)values($1,$2)"],
  ['audit',"insert into public.audit_events(organization_id,previous_value)values($1,jsonb_build_object('unitNumber',$2::text))"],
  ['source inventory',"insert into app_private.vision_source_inventory_v1(organization_id,unit_label)values($1,$2)"],
  ['catalog',"insert into public.mhelpdesk_equipment_catalog(organization_id,product_model)values($1,$2)"]
 ];
 for(const kind of productKinds){const row=productRecord(kind);for(const[store,query]of stores){await reset(db);await db.query(query,[ORG,'MISSING '+row.sourceLabel+' HD4']);const before=await state(db);await assert.rejects(()=>admit(db,[row]),/Existing identity/,store+' '+kind);assert.deepEqual(await state(db),before);}}
 for(const[kind,labels]of [['wall_e',['WA901HD4','WallE72901','WAHD4901','WA 901 72']],['camv',['CAMV901HD4','CAMV72901','CAMVHD4901','CAM-V 901 72']],['sniper_2',['Sniper 901','Sniper 4-901','Sniper2901HD4','SniperHD42901','Sniper 2 0901 Camera 1']]])for(const label of labels){await reset(db);await db.query('insert into public.vision_cameras(organization_id,camera_key)values($1,$2)',[ORG,label]);await assert.rejects(()=>admit(db,[productRecord(kind)]),/Existing identity/,label);}
});
test('native family context and withdrawn source aliases remain denial-only evidence for typed creations',async()=>{
 for(const kind of productKinds)for(const label of ['901','72901','90172']){await reset(db);const row=productRecord(kind),model=randomUUID();await db.query('insert into public.equipment_models values($1,$2)',[model,row.sourceCategory+' HD4']);await db.query("insert into public.equipment_units(id,organization_id,unit_number,model_id)values(gen_random_uuid(),$1,$2,$3)",[ORG,label,model]);await assert.rejects(()=>admit(db,[row]),/Existing identity/);}
 await reset(db);const created=(await admit(db,[productRecord()])).records[0];await withdraw(db,[{productId:created.productId,trackerId:created.trackerId,sourceRevision:created.sourceRevision}]);await assert.rejects(()=>admit(db,[productRecord('wall_e',{productId:'9000099'})]),/reserved/);
});
test('full neighboring tags never collapse into a short requested tag, including decorated labels',async()=>{
 const examples=[['wall_e','003',['013','030','103','300']],['camv','014',['114','140']],['sniper_2','003',['013','030','103','300']]];
 for(const[kind,number,neighbors]of examples){
  const base=productRecord(kind),row={...base,number,sourceLabel:base.sourceLabel.replace('901',number)};
  for(const tag of neighbors)for(const suffix of ['', ' HD4',' Camera 1',' 72']){await reset(db);await db.query('insert into public.vision_cameras(organization_id,camera_key)values($1,$2)',[ORG,base.sourceLabel.replace('901',tag)+suffix]);await admit(db,[row]);}
  for(const suffix of ['', ' HD4',' Camera 1',' 72']){await reset(db);await db.query('insert into public.vision_cameras(organization_id,camera_key)values($1,$2)',[ORG,row.sourceLabel+suffix]);await assert.rejects(()=>admit(db,[row]),/Existing identity/);}
 }
});
test('known generation, hardware and camera-channel tokens never stand in for the asset tag',async()=>{
 for(const[kind,number,labels]of [['sniper_2','002',['Sniper 2 347','Sniper2-013','Sniper 2 347 HD4 Camera 2']],['sniper_2','004',['Sniper 4 347','Sniper2-013 HD4']],['wall_e','004',['WA 013 HD4','WAHD4013']],['camv','001',['CAMV 014 Camera 1']]]){
  const base=productRecord(kind),row={...base,number,sourceLabel:base.sourceLabel.replace('901',number)};
  for(const label of labels){await reset(db);await db.query('insert into public.vision_cameras(organization_id,camera_key)values($1,$2)',[ORG,label]);await admit(db,[row]);}
 }
});
test('typed creation shares administrator-only authorization and batch rollback',async()=>{
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);try{await assert.rejects(()=>admit(db,[productRecord()]),/permission denied/);}finally{await db.exec('reset role');}}
 await assert.rejects(()=>admit(db,[productRecord(),productRecord('camv'),productRecord('sniper_2',{sourceLabel:'Sniper 901'})]));assert.equal((await state(db)).targets.length,0);assert.equal((await state(db)).sources.length,0);
});
test('upgrade of the existing support artifact preserves original receipts and retry semantics',async()=>{
 const first=await admit(db),before=await state(db);await db.exec(await readFile(new URL('../db/support-source-admission.sql',import.meta.url),'utf8'));assert.deepEqual(await state(db),before);assert.equal((await admit(db)).records[0].trackerId,first.records[0].trackerId);await admit(db,[productRecord()]);
});
function legacyReceipt(row=productRecord('sniper_2')){
 const receipt=review(),legacy=receipt.inventories.find(r=>r.kind==='legacy'),identity=creationIdentity(row);
 return {...receipt,legacyGroups:[{productId:row.productId,identityKey:identity.identityKey,fullLabel:identity.unitNumber,variant:null,rosterSha256:legacy.sha256,readAt:legacy.readAt,complete:true,deviceIds:['9901'],devices:[{id:'9901',unitKey:identity.unitNumber.toUpperCase(),deviceName:identity.unitNumber,deviceType:row.sourceCategory,source:'2026_unit_tracker',organization:'TRACKER FIELD',activationState:'active',externalDeviceId:null,connectionRevision:0}],nativeAssociations:[],providerAssociations:[],ownerPlacementGpsConflicts:[],placementGpsReviewed:true}]};
}
test('fresh exact legacy inventory stub review permits creation without adopting its IDs or health',async()=>{
 for(const kind of productKinds){await reset(db);const row=productRecord(kind),receipt=legacyReceipt(row);receipt.legacyGroups[0].devices[0].organization='root';
  const result=await admit(db,[row],true,receipt),saved=await state(db);assert.equal(saved.targets.length,1);assert.notEqual(result.records[0].trackerId,'9901');assert.deepEqual(saved.admissions[0].review_receipt,receipt);assert.equal(saved.equipment.length,0);assert.equal(saved.audits.length,0);
  for(const name of ['vision_vigilant_devices','vision_vigilant_unit_matches','vision_cameras'])assert.equal((await db.query(`select count(*)::int n from public.${name}`)).rows[0].n,0);
 }
});
test('legacy review rejects unbound/incomplete/ambiguous groups, variants, provider links and authoritative history',async()=>{
 const row=productRecord('sniper_2'),normal=legacyReceipt(row),group=normal.legacyGroups[0];
 for(const patch of [{complete:false},{placementGpsReviewed:false},{ownerPlacementGpsConflicts:['Owner placement']},{nativeAssociations:['another target']},{providerAssociations:['provider binding']},{rosterSha256:hash('other roster')},{readAt:'2000-01-01T00:00:00Z'},{productId:'9000099'},{productId:Number(row.productId)},{identityKey:'Sniper|901'},{fullLabel:'Sniper 901'},{variant:'HD4'},{deviceIds:[]},{deviceIds:['9901','9901']},{deviceIds:['9902']},{deviceIds:[9901]},{devices:[]}])await assert.rejects(()=>admit(db,[row],true,{...normal,legacyGroups:[{...group,...patch}]}));
 for(const patch of [{source:'Vigilant'},{activationState:'inactive'},{externalDeviceId:'provider-1'},{connectionRevision:1},{deviceName:'Sniper 901'},{unitKey:'SNIPER 4 901'},{deviceType:'Sniper 4'},{deviceName:'Sniper 2 901 HD4'},{id:'9902'},{unexpected:true}])await assert.rejects(()=>admit(db,[row],true,{...normal,legacyGroups:[{...group,devices:[{...group.devices[0],...patch}]}]}));
 for(const id of ['9223372036854775808','9999999999999999999'])await assert.rejects(()=>admit(db,[row],true,{...normal,legacyGroups:[{...group,deviceIds:[id],devices:[{...group.devices[0],id}]}]}),/Ambiguous legacy device/);
 for(const groups of [null,[group,group],[{...group,productId:record().productId}]])await assert.rejects(()=>admit(db,groups?.[0]?.productId===record().productId?[record()]:[row],true,{...normal,legacyGroups:groups}));
 const other=productRecord('camv'),otherGroup=legacyReceipt(other).legacyGroups[0];await assert.rejects(()=>admit(db,[row,other],true,{...normal,legacyGroups:[group,{...otherGroup,readAt:group.readAt}]}),/multiple groups/);
 assert.equal((await state(db)).targets.length,0);
});
test('reviewed legacy stubs never excuse native provider or Owner conflicts',async()=>{
 const row=productRecord('sniper_2'),receipt=legacyReceipt(row);
 await db.query('insert into public.vision_vigilant_devices(organization_id,device_name)values($1,$2)',[ORG,row.sourceLabel]);await assert.rejects(()=>admit(db,[row],true,receipt),/Existing identity/);await reset(db);
 await db.query('insert into app_private.cos_owner_identity_claims(organization_id,native_unit_label)values($1,$2)',[ORG,row.sourceLabel]);await assert.rejects(()=>admit(db,[row],true,receipt),/Existing identity/);
 await reset(db);const bad={...receipt,inventories:receipt.inventories.map(r=>r.kind==='legacy'?{...r,conflicts:['ambiguous variant']}:r)};await assert.rejects(()=>admit(db,[row],true,bad),/conflicting/);
});
