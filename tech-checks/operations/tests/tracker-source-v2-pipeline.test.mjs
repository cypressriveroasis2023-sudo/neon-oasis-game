import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto,randomUUID} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {fixture as nativeFixture,reset as nativeReset,seed as nativeSeed,install as installSource,rpc as nativeRPC,ORG,hash} from './fixtures/geocode-sources-database-fixture.mjs';
import {fixture as legacyFixture,reset as legacyReset,seed as legacySeed,OWNER} from './fixtures/geocodio-database-fixture.mjs';
import {createGeocodeSourcesHandler} from '../../supabase/functions/cos-geocode-sources/index.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {createSourceReader,checkedImportedSource,sourceIdentity,sourceAddress} from '../../supabase/functions/camera-field-geocode/importedSources.ts';
import {processImportedGeocodes} from '../../supabase/functions/camera-field-geocode/importedGeocodeSweep.ts';
import {validInstallation,matchesInstallation,censusInstallation} from '../../supabase/functions/camera-field-geocode/importedAddress.ts';
import {selectGeocodioInstallation} from '../../supabase/functions/camera-field-geocode/geocodioAddress.ts';
import {projectImportedSourceAddresses,projectImportedGeocodes,checkedImportedBinding,importedLegacyConcern} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
import {fixture as ownerIdentityFixture,key as ownerIdentityKey} from './owner-identity-fixtures.mjs';
import {audit as ownerPlacementAudit} from './native-placement-alias-fixtures.mjs';
import {ownerIdentityDigest,OWNER_IDENTITY_CONTRACT} from '../../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts';
let native,legacy;before(async()=>{native=await nativeFixture();legacy=await legacyFixture({imported:true});
 for(const file of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql'])await native.exec(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
 await native.exec('alter table app_private.vision_tracker_locations add column customer text');
 await native.exec('revoke usage on schema app_private from service_role');
 await legacy.exec(readFileSync(new URL('../db/geocodio-tracker-source-v2.sql',import.meta.url),'utf8'));
});after(async()=>{await native?.close();await legacy?.close();});
beforeEach(async()=>{await legacyReset(legacy);await nativeReset(native);});
const KEY='a'.repeat(64),response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function serial(fn){let previous=Promise.resolve();return (...args)=>{const task=previous.then(()=>fn(...args));previous=task.catch(()=>{});return task;};}
function harness({censusMatch=false,providerZip5=false,geocodioEmpty=false,onCensus,onGeocodio,now=Date.now}={}){
 const counts={census:0,geocodio:0,bridge:0,addresses:[]};
 const rpc=serial(async(name,args)=>{
  await legacy.exec('reset role;set role service_role');
  try{return (await legacy.query(`select public.${name}(${Object.keys(args).map((key,i)=>key+'=>$'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;}finally{await legacy.exec('reset role');}
 });
 const bridge=createGeocodeSourcesHandler({readKey:' '+KEY+'\n',rpc:serial(async(name,args)=>nativeRPC(native,name.replace('cos_geocode_sources_',''),args))});
 const fetch=async(url,init)=>{
  const u=new URL(url);
  if(u.hostname==='tughscoxralhofrckvxy.supabase.co'){counts.bridge++;assert.equal(init.headers['x-cos-geocode-source-key'],KEY);assert.equal(init.headers.Authorization,undefined);return bridge(new Request(url,init));}
  const street=u.searchParams.get('street'),city=u.searchParams.get('city')||'Houston',state=u.searchParams.get('state')||u.searchParams.get('state_province'),sourceZip=u.searchParams.get('zip')||u.searchParams.get('postal_code')||'77002',zip=providerZip5?sourceZip.slice(0,5):sourceZip;
  counts.addresses.push([...u.searchParams.keys()]);
  if(u.hostname==='geocoding.geo.census.gov'){counts.census++;await onCensus?.();return response({result:{addressMatches:censusMatch?[{matchedAddress:`${street}, ${city}, ${state} ${zip}`,coordinates:{x:-95,y:29}}]:[]}});}
  assert.equal(u.origin,'https://api.geocod.io');counts.geocodio++;await onGeocodio?.();if(geocodioEmpty)return response({results:[]});
  const [number,...words]=street.split(' ');return response({results:[{address_components:{number,formatted_street:words.join(' '),city,state_province:state,postal_code:zip,country:'US'},formatted_address:`${street}, ${city}, ${state} ${zip}`,location:{lat:29,lng:-95},accuracy:1,accuracy_type:'range_interpolation',match_type:null,source:'Never passed onward'}]});
 };
 return {rpc,fetch,counts,reader:createSourceReader(' '+KEY+'\n',fetch),run:()=>processImportedGeocodes({rpc,fetch,sourceReadKey:' '+KEY+'\n',geocodioApiKey:'fixture-only',deadlineMs:now()+100000,now})};
}
async function prepare({number=1,zip='77002-1234',placement='FIELD'}={}){
 const nativeId=randomUUID(),full=`Solar Pole 72|${String(number).padStart(3,'0')}`;
 const installation=placement==='FIELD'?{street:'123 Main St',city:'Houston',state:'TX',zip}:null;
 const record={entityKind:'tracker',nativeUnitId:nativeId,trackerId:nativeId,sourceSystem:'google_sheet_tracker',sourceRecordId:`google_sheet:synthetic_sheet_123:12:${full}`,sourceProvenance:{sheetId:'synthetic_sheet_123',tabId:'12',fullIdentity:full,sourceRange:`A${number}:L${number}`},createTracker:true,unitNumber:full.replace('|',' '),trackerUnitNumber:full.replace('|',' '),family:'Solar Pole 72',trackerFamily:'SOLAR POLES & SKIDS',variant:null,sourceFileSha256:hash('synthetic file'),sourceRowSha256:hash(String(number)),installation,addressSha256:installation?hash(`123 main st, houston, tx ${zip}`):null,previousSourceRevision:null,placement,siteLabel:'Synthetic site',customerLabel:'Synthetic customer'};
 const [source]=(await native.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2) value',[ORG,[record]])).rows[0].value;return {record,source};
}
const rawRow=source=>({id:source.nativeUnitId,unitNumber:source.unitNumber,readOnly:source.entityKind==='tracker',_sourceField:false,modelName:source.family,status:'available',currentLocationType:null,hasUnitGps:false,latitude:null,longitude:null,customer:'Historical customer',site:'Recorded site',address:'1 Historical Ave, Houston, TX 77002',addressSource:'Old tracker',recordSource:'Old tracker'});
async function projected(h,sources,audits=[],devices=[]){
 const rows=sources.map(rawRow),snapshot={items:[],inventoryItems:rows,summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:new Date().toISOString()};
 const sourceRows=await nativeRPC(native,'map_projection',{p_organization_id:ORG,p_identities:sources.map(s=>({entityKind:s.entityKind,nativeUnitId:s.nativeUnitId}))});
 const overlay=await projectImportedSourceAddresses(snapshot,sourceRows,audits,devices);
 const placed=await projectOwnerPlacement(overlay,audits,devices);
 const bindings=(await Promise.all(placed.items.map(row=>checkedImportedBinding(row.importedInstallation)))).filter(Boolean);
 const records=await h.rpc('cos_imported_geocode_read_many',{p_organization_id:ORG,p_bindings:bindings});
 return projectImportedGeocodes(placed,records,audits,devices);
}
for(const censusMatch of [true,false])test('eight typed tracker assets traverse bridge, existing queue/cache and honest frontend estimate '+censusMatch,async()=>{
 const sources=[];for(let n=1;n<=8;n++)sources.push((await prepare({number:n})).source);
 const h=harness({censusMatch,providerZip5:true}),result=await h.run();assert.equal(result.syncedSources,8);assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,censusMatch?0:1);
 const map=await projected(h,sources);assert.equal(map.items.length,8);
 for(const row of map.items){assert.equal(row.customer,'Synthetic customer');assert.equal(row.site,'Synthetic site');assert.equal(row.addressSource,'Tracker imported installation address');assert.equal(row.importedInstallation.schemaVersion,2);assert.equal(Object.hasOwn(row.importedInstallation,'productId'),false);assert.equal(row.hasUnitGps,false);assert.equal(row.latitude,null);assert.equal(row.placementAuditId,null);assert.ok(await checkedAddressEstimate(row));}
 assert.equal((await legacy.query('select count(*)::integer n from public.camera_inventory_audit')).rows[0].n,0);
 assert.equal((await legacy.query('select count(*)::integer n from public.camera_devices')).rows[0].n,0);
 assert.equal((await legacy.query('select count(*)::integer n from app_private.cos_imported_geocode_jobs where product_id is not null')).rows[0].n,0);
 assert.equal(Number((await legacy.query('select coalesce(sum(credits),0) n from app_private.cos_geocodio_daily_budget')).rows[0].n),censusMatch?0:1);
 await h.run();assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,censusMatch?0:1);
});
test('mixed V1 and V2 page shares ordinary cache, wraps cursor and retains V1 identity',async()=>{
 const v1=await nativeSeed(native,{label:'HELIOS 099HDC4'});const [old]=(await native.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2) value',[ORG,[v1]])).rows[0].value;
 const {source}=await prepare();const h=harness({providerZip5:true});await h.run();assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,1);
 const current=await h.reader.currentMany([sourceIdentity(old),sourceIdentity(source)]);assert.equal(current[0].schemaVersion,1);assert.equal(current[0].productId,old.productId);assert.equal(current[1].schemaVersion,2);
 assert.equal((await h.rpc('cos_imported_geocode_cursor_read',{p_organization_id:ORG})).eventId,'0');
});
test('tracker address edit during quota-charged request cancels publication and retains charged credit',async()=>{
 const {source}=await prepare();const h=harness({onGeocodio:()=>native.query("update app_private.vision_tracker_locations set address='124 Main St' where id=$1",[source.nativeUnitId])});await h.run();
 assert.deepEqual(await h.reader.currentMany([sourceIdentity(source)]),[null]);assert.equal((await projected(h,[source])).items.length,0);
 assert.equal(Number((await legacy.query('select sum(credits) n from app_private.cos_geocodio_daily_budget')).rows[0].n),1);
 await h.run();const job=(await legacy.query('select invalidated,source_system,source_record_id,product_id from app_private.cos_imported_geocode_jobs')).rows[0];assert.equal(job.invalidated,true);assert.equal(job.product_id,null);assert.equal(job.source_record_id,source.sourceRecordId);
});
test('shared 2400 cap defers V2 and never enrolls it into historical V1 postal recovery',async()=>{
 const {source}=await prepare();await legacy.exec("insert into app_private.cos_geocodio_daily_budget(budget_day,credits) values((clock_timestamp() at time zone 'America/New_York')::date,2400)");
 const h=harness();await h.run();assert.equal(h.counts.census,1);assert.equal(h.counts.geocodio,0);
 await assert.rejects(()=>h.rpc('cos_imported_geocode_postal_retry_enroll',{p_organization_id:ORG,p_bindings:[source]}),/Historical postal cohort/);
 assert.equal(Number((await legacy.query('select sum(credits) n from app_private.cos_geocodio_daily_budget')).rows[0].n),2400);
});
test('V2 identity forgery and product/system confusion fail across every reader',async()=>{
 const {source}=await prepare();const h=harness();for(const patch of [{productId:'123'}, {sourceSystem:'mhelpdesk_product_import'}, {schemaVersion:1}, {entityKind:'equipment_unit'}, {sourceRecordId:'004'}, {sourceRecordId:source.sourceRecordId+'<script>'}]){
  const bad={...source,...patch};assert.equal(await checkedImportedSource(bad),null);assert.equal(await checkedImportedBinding(bad),null);
  await assert.rejects(()=>h.rpc('cos_imported_geocode_read_many',{p_organization_id:ORG,p_bindings:[bad]}));
 }
 const wrong={...sourceIdentity(source),sourceRecordId:source.sourceRecordId.replace('|001','|002')};assert.deepEqual(await h.reader.currentMany([wrong]),[null]);
});
test('no V2 estimate crosses different postal address, Owner placement, GPS or native site guard',async()=>{
 const {source}=await prepare();const h=harness();await h.run();const map=await projected(h,[source]);assert.ok(await checkedAddressEstimate(map.items[0]));
 for(const patch of [{hasUnitGps:true},{locationVerification:'owner_verified',latitude:31,longitude:-96},{installedSiteId:randomUUID()},{placementSource:'owner',placementAuditId:'10'}]){
  const row={...rawRow(source),...patch};const overlay=await projectImportedSourceAddresses({items:[],inventoryItems:[row],summary:{}},[{...source,placement:'FIELD'}],[],[]);assert.deepEqual(overlay.inventoryItems[0],row);
 }
 const bad=structuredClone(map.items[0]);bad.locationImportedGeocode.matchedAddress='123 Main St, Houston, TX 77003';assert.equal(await checkedAddressEstimate(bad),null);
});
test('100 long typed identities retain the existing 32-KiB request limit and positional nulls',async()=>{
 const calls=[],key='a'.repeat(64),longId=`google_sheet:${'S'.repeat(128)}:123:${'F'.repeat(160)}|${'0'.repeat(40)}`;
 const sources=Array.from({length:100},()=>({entityKind:'tracker',nativeUnitId:randomUUID(),sourceSystem:'google_sheet_tracker',sourceRecordId:longId,sourceRevision:randomUUID()}));
 const handler=createGeocodeSourcesHandler({readKey:key,rpc:async(name,args)=>{assert.equal(name,'cos_geocode_sources_read_current_batch');calls.push(args.p_sources);return {sources:args.p_sources.map(()=>null)};}});
 const reader=createSourceReader(key,async(url,init)=>{assert.ok(new TextEncoder().encode(init.body).length<=32768);return handler(new Request(url,init));});
 assert.deepEqual(await reader.currentMany(sources),Array(100).fill(null));assert.equal(calls.length,2);assert.deepEqual(calls.flat(),sources);
});
test('native 160-character label boundary traverses every reader; 161 rolls back before source admission',async()=>{
 const {record:base}=await prepare(),family='F'.repeat(120),number='1'.repeat(39),full=family+'|'+number,id=randomUUID();
 const record={...base,nativeUnitId:id,trackerId:id,unitNumber:full.replace('|',' '),trackerUnitNumber:full.replace('|',' '),family,sourceRecordId:'google_sheet:synthetic_sheet_123:12:'+full,sourceProvenance:{...base.sourceProvenance,fullIdentity:full}};
 const [source]=(await native.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2) value',[ORG,[record]])).rows[0].value;
 assert.equal(source.unitNumber.length,160);const h=harness({censusMatch:true,providerZip5:true});await h.run();
 const [current]=await h.reader.currentMany([sourceIdentity(source)]);assert.equal(current.unitNumber.length,160);const map=await projected(h,[source]);assert.ok(await checkedAddressEstimate(map.items[0]));
 const counts=async()=>(await native.query('select (select count(*)::integer from app_private.vision_tracker_locations) trackers,(select count(*)::integer from app_private.cos_geocode_sources) sources,(select count(*)::integer from app_private.cos_geocode_source_events) events')).rows[0];
 const before=await counts(),badId=randomUUID(),long=family+'|'+number+'1',bad={...record,nativeUnitId:badId,trackerId:badId,unitNumber:long.replace('|',' '),trackerUnitNumber:long.replace('|',' '),sourceRecordId:'google_sheet:synthetic_sheet_123:12:'+long,sourceProvenance:{...record.sourceProvenance,fullIdentity:long}};
 assert.equal(bad.unitNumber.length,161);await assert.rejects(()=>native.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2)',[ORG,[bad]]),/cos_geocode_sources_.*unit_number_check/);assert.deepEqual(await counts(),before);
});
