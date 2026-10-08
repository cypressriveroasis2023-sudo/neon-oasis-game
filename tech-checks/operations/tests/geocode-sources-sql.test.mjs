import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,seed,install,read,events,rpc,ORG,hash} from './fixtures/geocode-sources-database-fixture.mjs';
let db;before(async()=>{db=await fixture();});after(async()=>db?.close());
beforeEach(async()=>{await db.exec('reset role;truncate app_private.cos_geocode_sources,app_private.cos_geocode_source_events,app_private.vision_tracker_locations,public.equipment_units;alter sequence app_private.cos_geocode_source_event_id_seq restart with 1;');});
test('reviewed binding emits exact redacted FIELD source and ordered events; no-op is idempotent',async()=>{
 const record=await seed(db);const [source]=await install(db,[record]);assert.equal(source.eligibility,'FIELD');assert.equal(source.eventId,'1');assert.equal(source.productId,record.productId);
 assert.deepEqual((await read(db,source)).source,source);assert.ok(!JSON.stringify(source).includes('historical'));assert.ok(!('trackerId' in source));
 assert.equal((await events(db)).events[0].sourceRevision,source.sourceRevision);
 const same=(await install(db,[{...record,previousSourceRevision:source.sourceRevision}]))[0];assert.equal(same.sourceRevision,source.sourceRevision);assert.equal((await events(db)).events.length,1);
});
test('source revisions, wrong stable IDs, missing and duplicate bindings fail closed',async()=>{
 const record=await seed(db);const [source]=await install(db,[record]);
 assert.equal((await read(db,{...source,sourceRevision:randomUUID()})).source,null);assert.equal((await read(db,{...source,productId:'9'})).source,null);
 await assert.rejects(install(db,[record]));await assert.rejects(install(db,[{...record,nativeUnitId:randomUUID()}]));
 const second=await seed(db,{label:'HELIOS 100HDC4',product:record.productId});await assert.rejects(install(db,[second]));
 await assert.rejects(install(db,[{...record,previousSourceRevision:source.sourceRevision},record]));assert.equal((await events(db)).events.length,1);
});
test('new file rotates revision without invalidating reusable address hash; stale reads suppressed',async()=>{
 const record=await seed(db);const [old]=await install(db,[record]);
 const [current]=await install(db,[{...record,previousSourceRevision:old.sourceRevision,sourceFileSha256:hash('new file')}]);
 assert.notEqual(current.sourceRevision,old.sourceRevision);assert.equal(current.addressSha256,old.addressSha256);assert.equal((await read(db,old)).source,null);
 assert.equal((await events(db,'1')).events[0].eventId,'2');
});
test('tracker Shop/address/site and native GPS/site/Shop invalidate immediately with tombstones',async()=>{
 const changes=["update app_private.vision_tracker_locations set placement='SHOP'","update app_private.vision_tracker_locations set address='changed'","update app_private.vision_tracker_locations set site='new site'","update public.equipment_units set gps_latitude=29,gps_longitude=-95","update public.equipment_units set installed_site_id='00000000-0000-4000-8000-000000000001'","update public.equipment_units set current_location_type='shop'"];
 for(const change of changes){await db.exec('truncate app_private.cos_geocode_sources,app_private.cos_geocode_source_events,app_private.vision_tracker_locations,public.equipment_units;alter sequence app_private.cos_geocode_source_event_id_seq restart with 1;');
  const record=await seed(db);const [source]=await install(db,[record]);await db.exec(change);assert.equal((await read(db,source)).source,null);
  const list=await events(db);assert.equal(list.events.length,1);assert.equal(list.events[0].kind,'tombstone');assert.equal((await db.query('select count(*)::int n from app_private.cos_geocode_source_events')).rows[0].n,2);const deleted=(await read(db,{...source,sourceRevision:list.events[0].sourceRevision})).source;assert.equal(deleted.eligibility,'tombstone');assert.ok(!('installation' in deleted));
 }
});
test('irrelevant native health and tracker notes never rotate geocoding sources',async()=>{
 const record=await seed(db);const [source]=await install(db,[record]);await db.exec("update public.equipment_units set health_last_seen=now();update app_private.vision_tracker_locations set location_note='private not exported'");
 assert.deepEqual((await read(db,source)).source,source);assert.equal((await events(db)).events.length,1);
});
test('tracker-only source is explicit; new equipment ambiguity invalidates it',async()=>{
 const record=await seed(db,{kind:'tracker'});const [source]=await install(db,[record]);assert.equal(source.entityKind,'tracker');
 await db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,$3,'available')",[randomUUID(),ORG,record.unitNumber]);assert.equal((await read(db,source)).source,null);assert.equal((await events(db)).events.at(-1).kind,'tombstone');
});
test('Shop is no-address bridge tombstone but typed native placement projection',async()=>{
 const record=await seed(db,{placement:'SHOP'});const [source]=await install(db,[record]);assert.equal(source.eligibility,'tombstone');assert.ok(!('installation' in source));
 const args={p_organization_id:ORG,p_identities:[{entityKind:record.entityKind,nativeUnitId:record.nativeUnitId}]};assert.deepEqual(await rpc(db,'read_many',args),[]);
 const map=await rpc(db,'map_projection',args);assert.equal(map[0].placement,'SHOP');assert.equal(map[0].installation,null);
 await db.exec("update public.equipment_units set gps_recorded_at=now()");assert.deepEqual(await rpc(db,'map_projection',args),[]);
});
test('batch read preserves order/nulls, rejects unbounded input and extra keys; role and tenant gates',async()=>{
 const record=await seed(db);const [source]=await install(db,[record]);const identity={entityKind:source.entityKind,nativeUnitId:source.nativeUnitId,productId:source.productId,sourceRevision:source.sourceRevision};
 const args={p_organization_id:ORG,p_sources:[identity,{...identity,sourceRevision:randomUUID()}]};assert.deepEqual((await rpc(db,'read_current_batch',args)).sources,[source,null]);
 await assert.rejects(rpc(db,'read_current_batch',{...args,p_sources:Array(101).fill(identity)}));await assert.rejects(rpc(db,'read_current_batch',{...args,p_sources:[{...identity,table:'profiles'}]}));
 await assert.rejects(rpc(db,'list_changes',{p_organization_id:randomUUID(),p_after_event_id:'0',p_limit:1}));await assert.rejects(events(db,'0',101));
 for(const role of ['anon','authenticated'])await assert.rejects(rpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:'0',p_limit:1},role));
});
test('unsafe fields, malformed address, fake SHA and changed guard rejected atomically',async()=>{
 const record=await seed(db);
 for(const bad of [{...record,notes:'private'},{...record,installation:{...record.installation,zip:'gate 1234'}},{...record,installation:{...record.installation,street:'123 gate code 9999'}},{...record,addressSha256:'0'.repeat(64)},{...record,nativeGuardSha256:'0'.repeat(64)}])await assert.rejects(install(db,[bad]));
 assert.deepEqual((await events(db)).events,[]);
});
test('native deletion emits tombstone; service cannot silently delete source provenance',async()=>{
 const record=await seed(db);const [source]=await install(db,[record]);await db.exec('delete from app_private.vision_tracker_locations');assert.equal((await read(db,source)).source,null);assert.equal((await events(db)).events.at(-1).kind,'tombstone');
 await db.exec('set role service_role');await assert.rejects(db.exec('delete from app_private.cos_geocode_sources'));await db.exec('reset role');
});
test('proven historical tracker estimates are preserved; unknown/manual coordinates stay excluded',async()=>{
 for(const coordinateSource of ['us_census_address_range_estimate','geocodio_reviewed_property_estimate','manual','unknown']){
  await db.exec('truncate app_private.cos_geocode_sources,app_private.cos_geocode_source_events,app_private.vision_tracker_locations,public.equipment_units;');
  const record=await seed(db);await db.query('update app_private.vision_tracker_locations set latitude=29,longitude=-95,coordinate_source=$1',[coordinateSource]);
  const guard=(await db.query('select app_private.cos_source_native_guard($1,$2,$3,$4,$5) value',[record.entityKind,record.nativeUnitId,record.trackerId,record.unitNumber,record.trackerUnitNumber])).rows[0].value;
  if(['manual','unknown'].includes(coordinateSource)){assert.equal(guard,null);await assert.rejects(install(db,[record]));}
  else{record.nativeGuardSha256=guard;const [source]=await install(db,[record]);assert.equal((await read(db,source)).source.eligibility,'FIELD');const t=(await db.query('select latitude,longitude,coordinate_source from app_private.vision_tracker_locations')).rows[0];assert.deepEqual(t,{latitude:29,longitude:-95,coordinate_source:coordinateSource});}
 }
});
test('broad concern collisions reject ambiguity but never positively bind decimal or variant identities',async()=>{
 const record=await seed(db,{label:'HELIOS 10.1 HDC4'});await db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'HELIOS 101 HDC4','available')",[randomUUID(),ORG]);await assert.rejects(install(db,[record]));
});
test('private contact and markup text cannot enter provenance address fields',async()=>{
 const record=await seed(db);
 for(const street of ['123 Main St contact Jim','123 Main St 555-555-1212','123 Main St john@example.com','123 Main St <private>','123 Main St; note private']){
  const installation={...record.installation,street};const value={...record,installation,addressSha256:hash(`${street}, Houston, TX 77002-1234`.toLowerCase())};await assert.rejects(install(db,[value]));
 }
 assert.equal((await events(db)).events.length,0);
});
test('city OR postal missing is preserved with exact supplied mask and canonical address digest',async()=>{
 for(const missing of ['city','zip']){
  await db.exec('truncate app_private.cos_geocode_sources,app_private.cos_geocode_source_events,app_private.vision_tracker_locations,public.equipment_units;');
  const record=await seed(db);record.installation[missing]=null;record.suppliedComponents={street:true,city:missing!=='city',state:true,zip:missing!=='zip'};
  record.addressSha256=hash(missing==='city'?'123 main st, tx 77002-1234':'123 main st, houston, tx');
  const [source]=await install(db,[record]);assert.deepEqual(source.suppliedComponents,record.suppliedComponents);assert.deepEqual(source.installation,record.installation);
  const value={...record,previousSourceRevision:source.sourceRevision,suppliedComponents:{...record.suppliedComponents,[missing]:true}};await assert.rejects(install(db,[value]));
 }
});
test('native SQL rejects credentials, secondary units and invalid states before storing address',async()=>{
 const record=await seed(db);
 for(const suffix of ['token abc','secret xyz','credential abc','pwd private','username private','customer private','code 1234','unit 12','suite 12','apt 12','floor 3']){
  const street='123 Main St '+suffix;await assert.rejects(install(db,[{...record,installation:{...record.installation,street},addressSha256:hash(`${street}, Houston, TX 77002-1234`.toLowerCase())}]));
 }
 await assert.rejects(install(db,[{...record,installation:{...record.installation,state:'ZZ'},addressSha256:hash('123 main st, houston, zz 77002-1234')} ]));
});
test('reviewed explicit revocation removes old unsafe source without inventing Shop or deleting evidence',async()=>{
 const record=await seed(db);const [source]=await install(db,[record]);const identity={entityKind:source.entityKind,nativeUnitId:source.nativeUnitId,productId:source.productId,sourceRevision:source.sourceRevision};
 const [withdrawn]=await rpc(db,'revoke_reviewed',{p_organization_id:ORG,p_sources:[identity]});assert.equal(withdrawn.eligibility,'tombstone');assert.equal((await read(db,source)).source,null);
 assert.deepEqual(await rpc(db,'map_projection',{p_organization_id:ORG,p_identities:[{entityKind:source.entityKind,nativeUnitId:source.nativeUnitId}]}),[]);
 assert.equal((await db.query('select placement from app_private.vision_tracker_locations')).rows[0].placement,'FIELD');assert.equal((await events(db)).events[0].kind,'tombstone');
 await assert.rejects(rpc(db,'revoke_reviewed',{p_organization_id:ORG,p_sources:[identity]}));
});
test('credential stems with suffixes never enter source provenance',async()=>{
 const record=await seed(db);for(const word of ['Mypassword123','Mytoken','password123','tokenABC','secret123','credentialABC','usernameABC','gatecode123']){
  const installation={...record.installation,street:'123 Main St '+word};await assert.rejects(install(db,[{...record,installation,addressSha256:hash((installation.street+', Houston, TX 77002-1234').toLowerCase())}]));
 }
 assert.deepEqual((await events(db)).events,[]);
});
test('sanitized site label is native-only and changes the source revision without reaching the bridge',async()=>{
 const record=await seed(db);const [source]=await install(db,[{...record,siteLabel:'Synthetic construction site'}]);assert.ok(!('siteLabel' in source));
 const projection=await rpc(db,'map_projection',{p_organization_id:ORG,p_identities:[{entityKind:source.entityKind,nativeUnitId:source.nativeUnitId}]});assert.equal(projection[0].siteLabel,'Synthetic construction site');
 const [next]=await install(db,[{...record,previousSourceRevision:source.sourceRevision,siteLabel:'New installation label'}]);assert.notEqual(next.sourceRevision,source.sourceRevision);assert.ok(!('siteLabel' in (await read(db,next)).source));
 await assert.rejects(install(db,[{...record,previousSourceRevision:next.sourceRevision,siteLabel:'password123'}]));
});
