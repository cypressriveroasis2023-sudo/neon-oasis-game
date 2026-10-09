import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,randomUUID} from 'node:crypto';
import {fixture as nativeFixture,record,admin,reset as nativeReset,sql,ORG,hash} from './fixtures/existing-tracker-source-v3-fixture.mjs';
import {rpc as nativeRPC,seed as seedV1} from './fixtures/geocode-sources-database-fixture.mjs';
import {fixture as legacyFixture,reset as legacyReset,OWNER} from './fixtures/geocodio-database-fixture.mjs';
import {createGeocodeSourcesHandler} from '../../supabase/functions/cos-geocode-sources/index.ts';
import {createSourceReader,checkedImportedSource,sourceIdentity} from '../../supabase/functions/camera-field-geocode/importedSources.ts';
import {processImportedGeocodes} from '../../supabase/functions/camera-field-geocode/importedGeocodeSweep.ts';
import {checkedImportedBinding,projectImportedSourceAddresses,projectImportedGeocodes} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
globalThis.crypto??=webcrypto;
let native,legacy;
before(async()=>{
 native=await nativeFixture();legacy=await legacyFixture({imported:true});
 await legacy.exec('alter table public.camera_inventory_audit add column created_at timestamptz,add column request_id uuid');
 for(const name of ['geocodio-tracker-source-v2.sql','source-precedence-contract.sql','geocodio-source-precedence.sql','geocodio-existing-tracker-source-v3.sql'])await legacy.exec(sql(name));
});
after(async()=>{await native?.close();await legacy?.close();});
beforeEach(async()=>{await nativeReset(native);await legacyReset(legacy);await legacy.exec('truncate app_private.cos_imported_precedence_reviews');});
const KEY='a'.repeat(64),response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
function serial(fn){let previous=Promise.resolve();return(...args)=>{const task=previous.then(()=>fn(...args));previous=task.catch(()=>{});return task;};}
function harness({censusMatch=false,onGeocodio}={}){
 const counts={census:0,geocodio:0};
 const rpc=serial(async(name,args)=>{
  await legacy.exec('set role service_role');try{return(await legacy.query('select public.'+name+'('+Object.keys(args).map((key,i)=>key+'=>$'+(i+1)).join(',')+') value',Object.values(args))).rows[0].value;}finally{await legacy.exec('reset role');}
 });
 const bridge=createGeocodeSourcesHandler({readKey:KEY,rpc:serial((name,args)=>nativeRPC(native,name.replace('cos_geocode_sources_',''),args))});
 const requestFetch=async(url,init)=>{
  const u=new URL(url);if(u.hostname==='tughscoxralhofrckvxy.supabase.co')return bridge(new Request(url,init));
  if(u.hostname==='geocoding.geo.census.gov'){counts.census++;return response({result:{addressMatches:censusMatch?[{matchedAddress:'123 Main St, Houston, TX 77002',coordinates:{x:-95,y:29}}]:[]}});}
  assert.equal(u.origin,'https://api.geocod.io');counts.geocodio++;await onGeocodio?.();
  return response({results:[{address_components:{number:'123',formatted_street:'Main St',city:'Houston',state_province:'TX',postal_code:'77002',country:'US'},formatted_address:'123 Main St, Houston, TX 77002',location:{lat:29,lng:-95},accuracy:1,accuracy_type:'range_interpolation',match_type:null}]});
 };
 return {rpc,counts,reader:createSourceReader(KEY,requestFetch),run:()=>processImportedGeocodes({rpc,fetch:requestFetch,sourceReadKey:KEY,geocodioApiKey:'synthetic-provider-key',deadlineMs:Date.now()+100000})};
}
async function project(h,sources,{audits=[],devices=[]}={}){
 const current=await nativeRPC(native,'map_projection',{p_organization_id:ORG,p_identities:sources.map(s=>({entityKind:s.entityKind,nativeUnitId:s.nativeUnitId}))});
 const rows=sources.map(s=>({id:s.nativeUnitId,unitNumber:s.unitNumber,readOnly:s.entityKind==='tracker',_sourceField:false,status:'available',currentLocationType:null,recordSource:'Native equipment registry',source:'native',hasUnitGps:false,latitude:null,longitude:null,customer:'Historical customer',site:'Historical site',address:'1 Historical Ave, Houston, TX 77002'}));
 const units=(await native.query('select id,organization_id,unit_number from public.equipment_units')).rows,context={nativeUnits:units,identity:{identityVersion:1,unitIdentities:[],identityWarnings:[]},currentSources:current};
 const map=await projectImportedSourceAddresses({items:[],inventoryItems:rows,summary:{}},current,audits,devices,[],context),bindings=(await Promise.all(map.items.map(r=>checkedImportedBinding(r.importedInstallation)))).filter(Boolean);
 const estimates=bindings.length?await h.rpc('cos_imported_geocode_read_many',{p_organization_id:ORG,p_bindings:bindings}):[];
 return projectImportedGeocodes(map,estimates,audits,devices,context);
}
for(const censusMatch of [true,false])test('actual SQL V3 sources traverse bridge, existing queue/cache, native map and frontend '+censusMatch,async()=>{
 const inputs=[];for(let n=1;n<=4;n++)inputs.push(await record(native,{family:'Helios',number:String(n).padStart(3,'0')+'HDC4',n}));
 const equipmentBefore=(await native.query('select to_jsonb(u) value from public.equipment_units u order by id')).rows,trackersBefore=(await native.query('select to_jsonb(t) value from app_private.vision_tracker_locations t order by id')).rows;
 const sources=await admin(native,inputs),h=harness({censusMatch}),result=await h.run();assert.equal(result.syncedSources,4);assert.deepEqual(h.counts,{census:1,geocodio:censusMatch?0:1});
 const current=await h.reader.currentMany(sources.map(sourceIdentity));assert.ok(current.every(s=>s.schemaVersion===3&&s.entityKind==='equipment_unit'&&!Object.hasOwn(s,'productId')));
 const map=await project(h,sources);assert.equal(map.items.length,4);
 for(const row of map.items){assert.equal(row.readOnly,false);assert.equal(row.recordSource,'Native equipment registry');assert.equal(row.addressSource,'Tracker imported installation address');assert.equal(row.customer,'Synthetic customer');assert.equal(row.site,'Synthetic site');assert.equal(row.hasUnitGps,false);assert.equal(row.latitude,null);assert.equal(row.longitude,null);assert.equal(row.placementAuditId,null);assert.equal(row.nativeSourceIdentity,undefined);assert.ok(await checkedAddressEstimate(row));}
 assert.deepEqual((await native.query('select to_jsonb(u) value from public.equipment_units u order by id')).rows,equipmentBefore);assert.deepEqual((await native.query('select to_jsonb(t) value from app_private.vision_tracker_locations t order by id')).rows,trackersBefore);
 assert.equal((await legacy.query('select count(*)::integer n from app_private.cos_imported_geocode_jobs where product_id is not null')).rows[0].n,0);
 assert.equal((await legacy.query('select count(*)::integer n from public.camera_inventory_audit')).rows[0].n,0);assert.equal((await legacy.query('select count(*)::integer n from public.camera_devices')).rows[0].n,0);
 assert.equal(Number((await legacy.query('select coalesce(sum(credits),0) n from app_private.cos_geocodio_daily_budget')).rows[0].n),censusMatch?0:1);
 await h.run();assert.deepEqual(h.counts,{census:1,geocodio:censusMatch?0:1});
});
test('mixed V1, V2 and V3 source events preserve prior types and reuse the shared ordinary cache',async()=>{
 const input=await record(native),[v3]=await admin(native,[input]),old=await seedV1(native,{label:'Helios 099HDC4',product:'887766'});
 const [v1]=(await native.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2) value',[ORG,[old]])).rows[0].value;
 const id=randomUUID(),full='Solar Pole 72|123';
 const v2record={entityKind:'tracker',nativeUnitId:id,trackerId:id,createTracker:true,sourceSystem:'google_sheet_tracker',sourceRecordId:'google_sheet:synthetic_sheet_123:12:'+full,sourceProvenance:{sheetId:'synthetic_sheet_123',tabId:'12',fullIdentity:full,sourceRange:'A1:L1'},unitNumber:full.replace('|',' '),trackerUnitNumber:full.replace('|',' '),family:'Solar Pole 72',trackerFamily:'SOLAR POLES & SKIDS',variant:null,sourceFileSha256:hash('synthetic file'),sourceRowSha256:hash('synthetic row'),installation:input.installation,addressSha256:input.addressSha256,previousSourceRevision:null,placement:'FIELD',siteLabel:'Synthetic site',customerLabel:'Synthetic customer'};
 const [v2]=(await native.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2) value',[ORG,[v2record]])).rows[0].value;
 const h=harness();await h.run();assert.deepEqual(h.counts,{census:1,geocodio:1});
 const current=await h.reader.currentMany([v1,v2,v3].map(sourceIdentity));assert.deepEqual(current.map(s=>s.schemaVersion),[1,2,3]);assert.equal(current[0].productId,v1.productId);assert.equal(current[1].entityKind,'tracker');assert.equal(current[2].entityKind,'equipment_unit');
 assert.deepEqual((await legacy.query('select source_system,entity_kind,count(*)::integer n from app_private.cos_imported_geocode_jobs group by 1,2 order by 1,2')).rows,[{source_system:'google_sheet_tracker',entity_kind:'equipment_unit',n:1},{source_system:'google_sheet_tracker',entity_kind:'tracker',n:1},{source_system:'mhelpdesk_product_import',entity_kind:'equipment_unit',n:1}]);
});
test('V3 tracker identity edits during a charged lookup invalidate publication while retaining the charged credit',async()=>{
 const input=await record(native),[source]=await admin(native,[input]),h=harness({onGeocodio:()=>native.query('update app_private.vision_tracker_locations set unit_number=$1 where id=$2',['Spotter 7',input.trackerId])});
 await h.run();assert.deepEqual(await h.reader.currentMany([sourceIdentity(source)]),[null]);assert.equal((await project(h,[source])).items.length,0);assert.equal(Number((await legacy.query('select sum(credits) n from app_private.cos_geocodio_daily_budget')).rows[0].n),1);
 await h.run();const job=(await legacy.query('select invalidated,source_system,source_record_id,product_id from app_private.cos_imported_geocode_jobs')).rows[0];assert.equal(job.invalidated,true);assert.equal(job.product_id,null);assert.equal(job.source_record_id,source.sourceRecordId);
});
test('V3 uses the existing 2400 shared cap and cannot enter historical V1 postal recovery',async()=>{
 const [source]=await admin(native,[await record(native)]);await legacy.exec("insert into app_private.cos_geocodio_daily_budget(budget_day,credits) values((clock_timestamp() at time zone 'America/New_York')::date,2400)");
 const h=harness();await h.run();assert.deepEqual(h.counts,{census:1,geocodio:0});await assert.rejects(()=>h.rpc('cos_imported_geocode_postal_retry_enroll',{p_organization_id:ORG,p_bindings:[source]}),/Historical postal cohort/);assert.equal(Number((await legacy.query('select sum(credits) n from app_private.cos_geocodio_daily_budget')).rows[0].n),2400);
});
test('actual V3 SHOP map record keeps exact proof and native provenance but carries no address estimate',async()=>{
 const input=await record(native);Object.assign(input,{placement:'SHOP',installation:null,addressSha256:null});const [source]=await admin(native,[input]),h=harness();await h.run();assert.deepEqual(h.counts,{census:0,geocodio:0});
 // The compact tombstone has no label; the guarded map projection supplies it.
 const original={...source,unitNumber:input.unitNumber},map=await project(h,[original]);assert.equal(map.items.length,0);assert.equal(map.inventoryItems[0].importedPlacement,'SHOP');assert.equal(map.inventoryItems[0].recordSource,'Native equipment registry');assert.equal(map.inventoryItems[0].address,null);assert.equal(map.inventoryItems[0].locationImportedGeocode,undefined);
});
test('actual V3 bindings reject identity substitutions in both TypeScript and legacy SQL',async()=>{
 const [source]=await admin(native,[await record(native)]),h=harness();
 for(const patch of [{schemaVersion:2},{entityKind:'tracker'},{productId:'1'},{sourceRecordId:source.sourceRecordId.replace('|007','|7')},{unitNumber:'Spotter 7'},{family:'Sniper'},{variant:'HDC4'}]){const bad={...source,...patch};assert.equal(await checkedImportedSource(bad),null);assert.equal(await checkedImportedBinding(bad),null);await assert.rejects(()=>h.rpc('cos_imported_geocode_read_many',{p_organization_id:ORG,p_bindings:[bad]}));}
});
for(const kind of ['legacy_root','owner_field'])test('actual V3 source does not supersede '+kind+' audit or infer a provider association',async()=>{
 const [source]=await admin(native,[await record(native)]),h=harness({censusMatch:true}),owner=kind==='owner_field',unitKey='SPOTTER 007';
 await legacy.query('insert into public.camera_devices values($1,$2)',[9001,unitKey]);
 const afterState=owner?{placement_contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD'}:{};
 await legacy.query('insert into public.camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state,created_at) values(901,$1,$2,$3,array[9001],$4,$5)',[OWNER,owner?'MOVE_TO_FIELD':'MOVE_TO_ROOT',unitKey,afterState,'2026-01-01T12:00:00Z']);
 const before=(await legacy.query('select to_jsonb(a) value from public.camera_inventory_audit a')).rows;
 await h.run();assert.deepEqual(h.counts,{census:0,geocodio:0});
 const audits=[{id:'901',unit_key:unitKey,device_ids:['9001'],action:owner?'MOVE_TO_FIELD':'MOVE_TO_ROOT',contract:owner?'COS_CAMERA_PLACEMENT_V2':null,created_at:'2026-01-01T12:00:00Z'}],devices=[{id:9001,unit_key:unitKey}];
 const map=await project(h,[source],{audits,devices});assert.equal(map.items.length,0);assert.equal(map.inventoryItems[0].importedPlacement,undefined);assert.equal(map.inventoryItems[0].nativeSourceIdentity,undefined);assert.equal(map.inventoryItems[0].unitIdentities,undefined);assert.equal(map.inventoryItems[0].locationImportedGeocode,undefined);
 assert.deepEqual((await legacy.query('select to_jsonb(a) value from public.camera_inventory_audit a')).rows,before);
});
test('actual V3 estimate is held after a new cross-label device audit without reassigning the native identity',async()=>{
 const [source]=await admin(native,[await record(native)]),h=harness({censusMatch:true}),unitKey='SPOTTER 007';
 await legacy.query('insert into public.camera_devices values($1,$2)',[9001,unitKey]);
 await h.run();assert.deepEqual(h.counts,{census:1,geocodio:0});assert.ok(await checkedAddressEstimate((await project(h,[source],{devices:[{id:9001,unit_key:unitKey}]})).items[0]));
 await legacy.query("insert into public.camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state,created_at) values(902,$1,'CHANGE_LABEL','SNIPER 007',array[9001],'{}',now())",[OWNER]);
 const audits=[{id:'902',unit_key:'SNIPER 007',device_ids:['9001'],action:'CHANGE_LABEL',contract:null}],devices=[{id:9001,unit_key:unitKey}],map=await project(h,[source],{audits,devices});
 assert.equal(map.items.length,0);assert.equal(map.inventoryItems[0].id,source.nativeUnitId);assert.equal(map.inventoryItems[0].unitNumber,source.unitNumber);assert.equal(map.inventoryItems[0].recordSource,'Native equipment registry');assert.equal(map.inventoryItems[0].locationImportedGeocode,undefined);assert.equal(map.inventoryItems[0].nativeSourceIdentity,undefined);
 await h.run();assert.deepEqual(h.counts,{census:1,geocodio:0});
});
